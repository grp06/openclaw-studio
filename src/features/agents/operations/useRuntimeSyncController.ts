import { useCallback, useEffect, useRef } from "react";

import {
  executeAgentReconcileCommands,
  runAgentReconcileOperation,
} from "@/features/agents/operations/agentReconcileOperation";
import { resolveSummarySnapshotIntent } from "@/features/agents/operations/fleetLifecycleWorkflow";
import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
} from "@/features/agents/operations/historySyncOperation";
import {
  RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT,
  RUNTIME_SYNC_MAX_HISTORY_LIMIT,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncFocusedHistoryPollingIntent,
  resolveRuntimeSyncGapRecoveryIntent,
  resolveRuntimeSyncLoadMoreHistoryLimit,
  resolveRuntimeSyncReconcilePollingIntent,
  shouldRuntimeSyncContinueFocusedHistoryPolling,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";
import {
  buildDomainHistoryRunStatePatch,
  type DomainHistoryActiveRun,
  buildSummarySnapshotPatches,
  type SummaryPreviewSnapshot,
  type SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import { TRANSCRIPT_V2_ENABLED, logTranscriptDebugMetric } from "@/features/agents/state/transcript";
import type { ControlPlaneOutboxEntry } from "@/lib/controlplane/contracts";
import { randomUUID } from "@/lib/uuid";
import { fetchJson } from "@/lib/http";

type RuntimeSyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type GatewayClientLike = {
  call: <T = unknown>(method: string, params: unknown) => Promise<T>;
  onGap?: (handler: (info: { expected: number; received: number }) => void) => () => void;
};

type UseRuntimeSyncControllerParams = {
  client: GatewayClientLike;
  status: "disconnected" | "connecting" | "connected";
  agents: AgentState[];
  focusedAgentId: string | null;
  focusedAgentRunning: boolean;
  dispatch: (action: RuntimeSyncDispatchAction) => void;
  clearRunTracking: (runId: string) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  useDomainApiReads: boolean;
  ingestDomainOutboxEntries: (entries: ControlPlaneOutboxEntry[]) => void;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (
    agentId: string,
    options?: { limit?: number; beforeOutboxId?: number }
  ) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

type DomainAgentHistoryResponse = {
  view?: unknown;
  entries?: unknown[];
  hasMore?: unknown;
  nextBeforeOutboxId?: unknown;
  semanticTurnsIncluded?: unknown;
  windowTruncated?: unknown;
  activeRun?: unknown;
};

type DomainHistoryView = "raw" | "semantic";

const DOMAIN_SEMANTIC_TURN_LIMIT = 50;
const DOMAIN_SEMANTIC_SCAN_LIMIT = 800;
const MAX_DOMAIN_HISTORY_DEDUPE_KEYS = 20_000;
const MAX_DOMAIN_ACTIVE_RUN_BACKGROUND_PAGES = 6;

const resolveDomainOutboxDedupeKey = (entry: ControlPlaneOutboxEntry): string | null => {
  const entryId = typeof entry?.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
  if (entryId === null) return null;
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt.trim() : "";
  return `${entryId}:${createdAt}`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

type DomainGatewayEvent = {
  name: string;
  payload: Record<string, unknown> | null;
};

const resolveDomainGatewayEvent = (
  entry: ControlPlaneOutboxEntry
): DomainGatewayEvent | null => {
  if (entry.event.type !== "gateway.event") return null;
  if (typeof entry.event.event !== "string") return null;
  return {
    name: entry.event.event.trim().toLowerCase(),
    payload: asRecord(entry.event.payload),
  };
};

const resolveRunIdFromDomainEntry = (entry: ControlPlaneOutboxEntry): string | null => {
  const gatewayEvent = resolveDomainGatewayEvent(entry);
  if (!gatewayEvent?.payload) return null;
  const runId = gatewayEvent.payload.runId;
  if (typeof runId !== "string") return null;
  const normalized = runId.trim();
  return normalized || null;
};

const resolveDomainChatRole = (payload: Record<string, unknown>): string | null => {
  const message = asRecord(payload.message);
  const role = message?.role ?? payload.role;
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return normalized || null;
};

const isTerminalDomainEntryForRun = (
  entry: ControlPlaneOutboxEntry,
  runId: string
): boolean => {
  const gatewayEvent = resolveDomainGatewayEvent(entry);
  if (!gatewayEvent?.payload) return false;
  const entryRunId = resolveRunIdFromDomainEntry(entry);
  if (!entryRunId || entryRunId !== runId) return false;

  if (gatewayEvent.name === "chat") {
    const state = gatewayEvent.payload.state;
    if (typeof state === "string") {
      const normalized = state.trim().toLowerCase();
      const role = resolveDomainChatRole(gatewayEvent.payload);
      if (role === "user") {
        return false;
      }
      return normalized === "final" || normalized === "aborted" || normalized === "error";
    }
    return false;
  }

  if (gatewayEvent.name !== "agent") return false;
  const stream = gatewayEvent.payload.stream;
  if (typeof stream !== "string" || stream.trim().toLowerCase() !== "lifecycle") {
    return false;
  }
  const data = asRecord(gatewayEvent.payload.data);
  const phase = data?.phase;
  if (typeof phase !== "string") return false;
  const normalizedPhase = phase.trim().toLowerCase();
  return normalizedPhase === "end" || normalizedPhase === "error";
};

const isLifecycleStartDomainEntryForRun = (
  entry: ControlPlaneOutboxEntry,
  runId: string
): boolean => {
  const gatewayEvent = resolveDomainGatewayEvent(entry);
  if (!gatewayEvent?.payload || gatewayEvent.name !== "agent") return false;
  const entryRunId = resolveRunIdFromDomainEntry(entry);
  if (!entryRunId || entryRunId !== runId) return false;
  const stream = gatewayEvent.payload.stream;
  if (typeof stream !== "string" || stream.trim().toLowerCase() !== "lifecycle") {
    return false;
  }
  const data = asRecord(gatewayEvent.payload.data);
  const phase = data?.phase;
  return typeof phase === "string" && phase.trim().toLowerCase() === "start";
};

const resolveDomainHistoryActiveRun = (value: unknown): DomainHistoryActiveRun | null => {
  const record = asRecord(value);
  if (!record) return null;
  const statusRaw = record.status;
  const status =
    statusRaw === "running" || statusRaw === "idle" || statusRaw === "error"
      ? statusRaw
      : null;
  if (!status) return null;
  const runIdRaw = record.runId;
  const runId =
    typeof runIdRaw === "string" ? (runIdRaw.trim() || null) : runIdRaw === null ? null : null;
  const complete = record.complete === true;
  return { runId, status, complete };
};

export function useRuntimeSyncController(
  params: UseRuntimeSyncControllerParams
): RuntimeSyncController {
  const {
    client,
    status,
    agents,
    focusedAgentId,
    focusedAgentRunning,
    dispatch,
    clearRunTracking,
    isDisconnectLikeError,
    useDomainApiReads,
    ingestDomainOutboxEntries,
  } = params;
  const agentsRef = useRef(agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());
  const domainHistoryCursorByAgentRef = useRef<Map<string, number | null>>(new Map());
  const activeRunBackfillInFlightByAgentRef = useRef<Set<string>>(new Set());
  const seenDomainOutboxKeysRef = useRef<Set<string>>(new Set());
  const seenDomainOutboxKeyOrderRef = useRef<string[]>([]);

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const clearHistoryInFlight = useCallback((sessionKey: string) => {
    const key = sessionKey.trim();
    if (!key) return;
    historyInFlightRef.current.delete(key);
  }, []);

  const loadSummarySnapshot = useCallback(async () => {
    if (useDomainApiReads) {
      try {
        await fetchJson<{ summary?: unknown; freshness?: unknown }>("/api/runtime/summary", {
          cache: "no-store",
        });
      } catch (error) {
        if (!isDisconnectLikeError(error)) {
          console.error("Failed to load domain runtime summary.", error);
        }
      }
      return;
    }
    const snapshotAgents = agentsRef.current;
    const summaryIntent = resolveSummarySnapshotIntent({
      agents: snapshotAgents,
      maxKeys: 64,
    });
    if (summaryIntent.kind === "skip") return;
    const activeAgents = snapshotAgents.filter((agent) => agent.sessionCreated);
    try {
      const [statusSummary, previewResult] = await Promise.all([
        client.call<SummaryStatusSnapshot>("status", {}),
        client.call<SummaryPreviewSnapshot>("sessions.preview", {
          keys: summaryIntent.keys,
          limit: summaryIntent.limit,
      maxChars: summaryIntent.maxChars,
        }),
      ]);
      for (const entry of buildSummarySnapshotPatches({
        agents: activeAgents,
        statusSummary,
        previewResult,
      })) {
        dispatch({
          type: "updateAgent",
          agentId: entry.agentId,
          patch: entry.patch,
        });
      }
    } catch (error) {
      if (!isDisconnectLikeError(error)) {
        console.error("Failed to load summary snapshot.", error);
      }
    }
  }, [client, dispatch, isDisconnectLikeError, useDomainApiReads]);

  const ingestUnseenDomainEntries = useCallback(
    (entries: ControlPlaneOutboxEntry[]) => {
      const unseen: ControlPlaneOutboxEntry[] = [];
      for (const entry of entries) {
        const dedupeKey = resolveDomainOutboxDedupeKey(entry);
        if (!dedupeKey) continue;
        if (seenDomainOutboxKeysRef.current.has(dedupeKey)) continue;
        seenDomainOutboxKeysRef.current.add(dedupeKey);
        seenDomainOutboxKeyOrderRef.current.push(dedupeKey);
        unseen.push(entry);
      }
      if (seenDomainOutboxKeyOrderRef.current.length > MAX_DOMAIN_HISTORY_DEDUPE_KEYS) {
        const overflow =
          seenDomainOutboxKeyOrderRef.current.length - MAX_DOMAIN_HISTORY_DEDUPE_KEYS;
        const dropped = seenDomainOutboxKeyOrderRef.current.splice(0, overflow);
        for (const key of dropped) {
          seenDomainOutboxKeysRef.current.delete(key);
        }
      }
      if (unseen.length > 0) {
        ingestDomainOutboxEntries(unseen);
      }
    },
    [ingestDomainOutboxEntries]
  );

  const loadAgentHistoryViaDomainApi = useCallback(
    async (agentId: string, limit: number, beforeOutboxId?: number) => {
      const normalizedAgentId = agentId.trim();
      const encodedAgentId = encodeURIComponent(normalizedAgentId);
      if (!encodedAgentId) return;
      const fetchPage = async (params: {
        cursor?: number;
        view: DomainHistoryView;
        turnLimit?: number;
        scanLimit?: number;
      }): Promise<{
        entries: ControlPlaneOutboxEntry[];
        hasMore: boolean;
        nextBeforeOutboxId: number | null;
        semanticTurnsIncluded: number | null;
        windowTruncated: boolean;
        activeRun: DomainHistoryActiveRun | null;
      }> => {
        const query = new URLSearchParams();
        query.set("limit", String(limit));
        query.set("view", params.view);
        if (params.view === "semantic") {
          query.set("turnLimit", String(params.turnLimit ?? DOMAIN_SEMANTIC_TURN_LIMIT));
          query.set("scanLimit", String(params.scanLimit ?? DOMAIN_SEMANTIC_SCAN_LIMIT));
        }
        if (
          typeof params.cursor === "number" &&
          Number.isFinite(params.cursor) &&
          params.cursor > 0
        ) {
          query.set("beforeOutboxId", String(Math.floor(params.cursor)));
        }
        const result = await fetchJson<DomainAgentHistoryResponse>(
          `/api/runtime/agents/${encodedAgentId}/history?${query.toString()}`,
          { cache: "no-store" }
        );
        const entries = Array.isArray(result.entries)
          ? (result.entries as ControlPlaneOutboxEntry[])
          : [];
        const hasMore = result.hasMore === true;
        const nextBeforeOutboxId =
          typeof result.nextBeforeOutboxId === "number" &&
          Number.isFinite(result.nextBeforeOutboxId) &&
          result.nextBeforeOutboxId > 0
            ? Math.floor(result.nextBeforeOutboxId)
            : null;
        const semanticTurnsIncluded =
          typeof result.semanticTurnsIncluded === "number" &&
          Number.isFinite(result.semanticTurnsIncluded) &&
          result.semanticTurnsIncluded >= 0
            ? Math.floor(result.semanticTurnsIncluded)
            : null;
        const windowTruncated =
          result.windowTruncated === true ? true : result.hasMore === true;
        const activeRun = resolveDomainHistoryActiveRun(result.activeRun);
        return {
          entries,
          hasMore,
          nextBeforeOutboxId,
          semanticTurnsIncluded,
          windowTruncated,
          activeRun,
        };
      };

      const explicitBeforeOutboxId =
        typeof beforeOutboxId === "number" &&
        Number.isFinite(beforeOutboxId) &&
        beforeOutboxId > 0
          ? Math.floor(beforeOutboxId)
          : undefined;
      const shouldUseSemanticWindow =
        explicitBeforeOutboxId === undefined;
      const firstPage = await fetchPage({
        cursor: explicitBeforeOutboxId,
        view: shouldUseSemanticWindow ? "semantic" : "raw",
        turnLimit: DOMAIN_SEMANTIC_TURN_LIMIT,
        scanLimit: DOMAIN_SEMANTIC_SCAN_LIMIT,
      });

      ingestUnseenDomainEntries(firstPage.entries);
      if (normalizedAgentId) {
        domainHistoryCursorByAgentRef.current.set(
          normalizedAgentId,
          firstPage.nextBeforeOutboxId
        );
      }
      if (shouldUseSemanticWindow) {
        logTranscriptDebugMetric("domain_history_semantic_window", {
          agentId: normalizedAgentId,
          turns: firstPage.semanticTurnsIncluded,
          entries: firstPage.entries.length,
          truncated: firstPage.windowTruncated,
        });
      }
      const latestAgent =
        agentsRef.current.find((entry) => entry.agentId === normalizedAgentId) ?? null;
      const domainRunStatePatch =
        shouldUseSemanticWindow && firstPage.activeRun
          ? buildDomainHistoryRunStatePatch({
              activeRun: firstPage.activeRun,
              currentStatus: latestAgent?.status ?? "idle",
              currentRunId: latestAgent?.runId ?? null,
            })
          : null;
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          historyLoadedAt: Date.now(),
          historyFetchLimit: limit,
          historyFetchedCount:
            shouldUseSemanticWindow && typeof firstPage.semanticTurnsIncluded === "number"
              ? firstPage.semanticTurnsIncluded
              : firstPage.entries.length,
          historyMaybeTruncated: firstPage.windowTruncated,
          ...(domainRunStatePatch ?? {}),
        },
      });

      if (!shouldUseSemanticWindow) {
        return;
      }
      const runToBackfill = firstPage.activeRun;
      if (!runToBackfill || runToBackfill.status !== "running" || !runToBackfill.runId) {
        return;
      }
      if (runToBackfill.complete) {
        return;
      }
      if (!firstPage.hasMore || firstPage.nextBeforeOutboxId === null) {
        return;
      }
      if (activeRunBackfillInFlightByAgentRef.current.has(normalizedAgentId)) {
        return;
      }
      activeRunBackfillInFlightByAgentRef.current.add(normalizedAgentId);
      logTranscriptDebugMetric("domain_history_active_run_backfill_start", {
        agentId: normalizedAgentId,
        runId: runToBackfill.runId,
        cursor: firstPage.nextBeforeOutboxId,
      });

      void (async () => {
        let reason = "completed";
        let pagesFetched = 0;
        let cursor = firstPage.nextBeforeOutboxId;
        try {
          while (pagesFetched < MAX_DOMAIN_ACTIVE_RUN_BACKGROUND_PAGES) {
            if (typeof cursor !== "number" || !Number.isFinite(cursor) || cursor <= 0) {
              reason = "cursor-exhausted";
              break;
            }
            const previousCursor = cursor;
            const page = await fetchPage({
              cursor,
              view: "raw",
            });
            pagesFetched += 1;

            ingestUnseenDomainEntries(page.entries);
            if (normalizedAgentId) {
              domainHistoryCursorByAgentRef.current.set(
                normalizedAgentId,
                page.nextBeforeOutboxId
              );
            }

            if (page.entries.some((entry) => isLifecycleStartDomainEntryForRun(entry, runToBackfill.runId!))) {
              reason = "found-lifecycle-start";
              break;
            }
            if (page.entries.some((entry) => isTerminalDomainEntryForRun(entry, runToBackfill.runId!))) {
              reason = "found-terminal-entry";
              break;
            }

            if (page.activeRun && page.activeRun.runId === runToBackfill.runId && page.activeRun.status !== "running") {
              const latest =
                agentsRef.current.find((entry) => entry.agentId === normalizedAgentId) ?? null;
              const patch = buildDomainHistoryRunStatePatch({
                activeRun: page.activeRun,
                currentStatus: latest?.status ?? "idle",
                currentRunId: latest?.runId ?? null,
              });
              if (patch) {
                dispatch({
                  type: "updateAgent",
                  agentId: normalizedAgentId,
                  patch,
                });
              }
              reason = "terminal-metadata";
              break;
            }

            if (!page.hasMore || page.nextBeforeOutboxId === null) {
              reason = "no-more-history";
              break;
            }
            if (page.nextBeforeOutboxId >= previousCursor) {
              reason = "cursor-no-progress";
              break;
            }
            cursor = page.nextBeforeOutboxId;
          }
          if (pagesFetched >= MAX_DOMAIN_ACTIVE_RUN_BACKGROUND_PAGES && reason === "completed") {
            reason = "page-cap";
          }
        } catch (error) {
          reason = "error";
          if (!isDisconnectLikeError(error)) {
            console.error("Failed to backfill active run domain history.", error);
          }
        } finally {
          activeRunBackfillInFlightByAgentRef.current.delete(normalizedAgentId);
          logTranscriptDebugMetric("domain_history_active_run_backfill_stop", {
            agentId: normalizedAgentId,
            runId: runToBackfill.runId,
            pagesFetched,
            reason,
          });
        }
      })();
    },
    [dispatch, ingestUnseenDomainEntries, isDisconnectLikeError]
  );

  const loadAgentHistory = useCallback(
    async (agentId: string, options?: { limit?: number; beforeOutboxId?: number }) => {
      if (useDomainApiReads) {
        const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        const limit =
          typeof options?.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : agent?.historyFetchLimit ?? defaultHistoryLimit;
        const beforeOutboxId =
          typeof options?.beforeOutboxId === "number" && Number.isFinite(options.beforeOutboxId)
            ? Math.max(1, Math.floor(options.beforeOutboxId))
            : undefined;
        try {
          await loadAgentHistoryViaDomainApi(agentId, limit, beforeOutboxId);
        } catch (error) {
          if (!isDisconnectLikeError(error)) {
            console.error("Failed to load domain runtime history.", error);
          }
        }
        return;
      }
      const commands = await runHistorySyncOperation({
        client,
        agentId,
        requestedLimit: options?.limit,
        getAgent: (targetAgentId) =>
          agentsRef.current.find((entry) => entry.agentId === targetAgentId) ?? null,
        inFlightSessionKeys: historyInFlightRef.current,
        requestId: randomUUID(),
        loadedAt: Date.now(),
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
        transcriptV2Enabled: TRANSCRIPT_V2_ENABLED,
      });
      executeHistorySyncCommands({
        commands,
        dispatch,
        logMetric: (metric, meta) => logTranscriptDebugMetric(metric, meta),
        isDisconnectLikeError,
        logError: (message, error) => console.error(message, error),
      });
    },
    [
      client,
      defaultHistoryLimit,
      dispatch,
      isDisconnectLikeError,
      loadAgentHistoryViaDomainApi,
      maxHistoryLimit,
      useDomainApiReads,
    ]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      if (useDomainApiReads) {
        const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        const limit = agent?.historyFetchLimit ?? defaultHistoryLimit;
        const beforeOutboxId = domainHistoryCursorByAgentRef.current.get(agentId) ?? null;
        if (beforeOutboxId === null) return;
        void loadAgentHistory(agentId, { limit, beforeOutboxId });
        return;
      }
      const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: agent?.historyFetchLimit ?? null,
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
      });
      void loadAgentHistory(agentId, { limit: nextLimit });
    },
    [defaultHistoryLimit, loadAgentHistory, maxHistoryLimit, useDomainApiReads]
  );

  const reconcileRunningAgents = useCallback(async () => {
    if (status !== "connected") return;
    if (useDomainApiReads) return;
    const commands = await runAgentReconcileOperation({
      client,
      agents: agentsRef.current,
      getLatestAgent: (agentId) =>
        agentsRef.current.find((entry) => entry.agentId === agentId) ?? null,
      claimRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return false;
        if (reconcileRunInFlightRef.current.has(normalized)) return false;
        reconcileRunInFlightRef.current.add(normalized);
        return true;
      },
      releaseRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return;
        reconcileRunInFlightRef.current.delete(normalized);
      },
      isDisconnectLikeError,
    });
    executeAgentReconcileCommands({
      commands,
      dispatch,
      clearRunTracking,
      requestHistoryRefresh: (agentId) => {
        void loadAgentHistory(agentId);
      },
      logInfo: (message) => console.info(message),
      logWarn: (message, error) => console.warn(message, error),
    });
  }, [
    clearRunTracking,
    client,
    dispatch,
    isDisconnectLikeError,
    loadAgentHistory,
    status,
    useDomainApiReads,
  ]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    const reconcileIntent = resolveRuntimeSyncReconcilePollingIntent({
      status,
    });
    if (reconcileIntent.kind === "stop") return;
    void reconcileRunningAgents();
    const timer = window.setInterval(() => {
      void reconcileRunningAgents();
    }, reconcileIntent.intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [reconcileRunningAgents, status]);

  useEffect(() => {
    const bootstrapAgentIds = resolveRuntimeSyncBootstrapHistoryAgentIds({
      status,
      agents,
    });
    for (const agentId of bootstrapAgentIds) {
      void loadAgentHistory(agentId);
    }
  }, [agents, loadAgentHistory, status]);

  useEffect(() => {
    const pollingIntent = resolveRuntimeSyncFocusedHistoryPollingIntent({
      status,
      focusedAgentId,
      focusedAgentRunning,
    });
    if (pollingIntent.kind === "stop") return;
    void loadAgentHistory(pollingIntent.agentId);
    const timer = window.setInterval(() => {
      const shouldContinue = shouldRuntimeSyncContinueFocusedHistoryPolling({
        agentId: pollingIntent.agentId,
        agents: agentsRef.current,
      });
      if (!shouldContinue) return;
      void loadAgentHistory(pollingIntent.agentId);
    }, pollingIntent.intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [focusedAgentId, focusedAgentRunning, loadAgentHistory, status]);

  useEffect(() => {
    if (useDomainApiReads) return;
    if (!client.onGap) return;
    return client.onGap((info) => {
      const recoveryIntent = resolveRuntimeSyncGapRecoveryIntent();
      console.warn(`Gateway event gap expected ${info.expected}, received ${info.received}.`);
      if (recoveryIntent.refreshSummarySnapshot) {
        void loadSummarySnapshot();
      }
      if (recoveryIntent.reconcileRunningAgents) {
        void reconcileRunningAgents();
      }
    });
  }, [client, loadSummarySnapshot, reconcileRunningAgents, useDomainApiReads]);

  return {
    loadSummarySnapshot,
    loadAgentHistory,
    loadMoreAgentHistory,
    reconcileRunningAgents,
    clearHistoryInFlight,
  };
}
