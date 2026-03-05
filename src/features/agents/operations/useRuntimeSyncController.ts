import { useCallback, useEffect, useRef } from "react";

import { hydrateDomainHistoryWindow } from "@/features/agents/operations/domainHistoryHydration";
import {
  RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT,
  RUNTIME_SYNC_MAX_HISTORY_LIMIT,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncLoadMoreHistoryLimit,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";
import type { AgentState } from "@/features/agents/state/store";
import { logTranscriptDebugMetric } from "@/features/agents/state/transcript";
import {
  loadDomainAgentHistoryWindow,
  loadDomainAgentPreviewWindow,
  type DomainAgentHistoryResult,
} from "@/lib/controlplane/domain-runtime-client";
import { fetchJson } from "@/lib/http";
import { randomUUID } from "@/lib/uuid";

type RuntimeSyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type HistoryLoadReason = "bootstrap" | "load-more" | "refresh";

type UseRuntimeSyncControllerParams = {
  status: "disconnected" | "connecting" | "connected";
  agents: AgentState[];
  focusedAgentId: string | null;
  dispatch: (action: RuntimeSyncDispatchAction) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (
    agentId: string,
    options?: { limit?: number; reason?: HistoryLoadReason }
  ) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

type HistoryCacheEntry = {
  requestedLimit: number;
  fetchedAt: number;
  history: DomainAgentHistoryResult;
};

type HistoryRequestContext = {
  agentId: string;
  sessionKey: string;
  sessionEpoch: number;
  requestId: string;
  controller: AbortController;
  reason: HistoryLoadReason;
};

const normalizeSessionEpoch = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && (error as { name?: unknown }).name === "AbortError") return true;
  if (
    "cause" in error &&
    (error as { cause?: unknown }).cause &&
    typeof (error as { cause?: unknown }).cause === "object" &&
    "name" in ((error as { cause?: unknown }).cause as Record<string, unknown>) &&
    ((error as { cause?: unknown }).cause as Record<string, unknown>).name === "AbortError"
  ) {
    return true;
  }
  return false;
};

const resolveScanLimitForReason = (params: {
  reason: HistoryLoadReason;
  requestedLimit: number;
  maxHistoryLimit: number;
}): number => {
  const floor =
    params.reason === "bootstrap" ? 200 : params.reason === "load-more" ? 400 : 300;
  return Math.min(params.maxHistoryLimit, Math.max(floor, params.requestedLimit * 3));
};

const FOCUSED_PREVIEW_LIMIT = 50;
const FOCUSED_PREVIEW_MAX_CHARS = 480;
const FOCUSED_PREVIEW_MIN_ITEMS = 4;
const BOOTSTRAP_HISTORY_LIMIT = 12;

const buildPreviewBootstrapKey = (agent: Pick<AgentState, "sessionKey" | "sessionEpoch">): string =>
  `${agent.sessionKey.trim()}:${normalizeSessionEpoch(agent.sessionEpoch)}`;

export function useRuntimeSyncController(
  params: UseRuntimeSyncControllerParams
): RuntimeSyncController {
  const { status, agents, focusedAgentId, dispatch, isDisconnectLikeError } = params;
  const agentsRef = useRef(agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const historyAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const historyRequestContextRef = useRef<Map<string, HistoryRequestContext>>(new Map());
  const historyCacheRef = useRef<Map<string, HistoryCacheEntry>>(new Map());
  const previewInFlightRef = useRef<Set<string>>(new Set());
  const previewBootstrapAttemptedRef = useRef<Set<string>>(new Set());

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const clearHistoryInFlight = useCallback((sessionKey: string) => {
    const key = sessionKey.trim();
    if (!key) return;
    const controller = historyAbortControllersRef.current.get(key) ?? null;
    if (controller) {
      controller.abort();
      historyAbortControllersRef.current.delete(key);
    }
    historyRequestContextRef.current.delete(key);
    historyInFlightRef.current.delete(key);
    historyCacheRef.current.delete(key);
  }, []);

  const loadSummarySnapshot = useCallback(async () => {
    try {
      await fetchJson<{ summary?: unknown; freshness?: unknown }>("/api/runtime/summary", {
        cache: "no-store",
      });
    } catch (error) {
      if (!isDisconnectLikeError(error)) {
        console.error("Failed to load domain runtime summary.", error);
      }
    }
  }, [isDisconnectLikeError]);

  const loadFocusedAgentPreview = useCallback(
    async (
      agentId: string,
      options?: {
        limit?: number;
        maxChars?: number;
      }
    ) => {
      const targetAgent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      if (!targetAgent || !targetAgent.sessionCreated) return;
      const sessionKey = targetAgent.sessionKey.trim();
      if (!sessionKey) return;
      if (previewInFlightRef.current.has(sessionKey)) return;

      const requestedLimitRaw =
        typeof options?.limit === "number" && Number.isFinite(options.limit)
          ? Math.floor(options.limit)
          : FOCUSED_PREVIEW_LIMIT;
      const requestedLimit = Math.max(1, Math.min(FOCUSED_PREVIEW_LIMIT, requestedLimitRaw));
      const requestedMaxCharsRaw =
        typeof options?.maxChars === "number" && Number.isFinite(options.maxChars)
          ? Math.floor(options.maxChars)
          : FOCUSED_PREVIEW_MAX_CHARS;
      const requestedMaxChars = Math.max(40, Math.min(2000, requestedMaxCharsRaw));
      const requestStartedAt = Date.now();
      const sessionEpoch = normalizeSessionEpoch(targetAgent.sessionEpoch);

      previewInFlightRef.current.add(sessionKey);
      logTranscriptDebugMetric("preview_load_start", {
        agentId,
        sessionKey,
        requestedLimit,
        requestedMaxChars,
      });

      try {
        const preview = await loadDomainAgentPreviewWindow({
          agentId,
          sessionKey,
          limit: requestedLimit,
          maxChars: requestedMaxChars,
        });
        const latest = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        if (!latest) return;
        if (latest.sessionKey.trim() !== sessionKey) return;
        if (normalizeSessionEpoch(latest.sessionEpoch) !== sessionEpoch) return;
        const nextPreviewItems = Array.isArray(preview.items) ? preview.items : [];
        if (nextPreviewItems.length === 0) return;
        const existingPreviewCount = Array.isArray(latest.previewItems) ? latest.previewItems.length : 0;
        if (nextPreviewItems.length < existingPreviewCount) return;

        const lastAssistant = [...nextPreviewItems]
          .reverse()
          .find((item) => item.role === "assistant");
        const lastUser = [...nextPreviewItems].reverse().find((item) => item.role === "user");
        dispatch({
          type: "updateAgent",
          agentId,
          patch: {
            previewItems: nextPreviewItems,
            ...(lastAssistant?.text ? { latestPreview: lastAssistant.text } : {}),
            ...(lastUser?.text ? { lastUserMessage: lastUser.text } : {}),
          },
        });
        logTranscriptDebugMetric("preview_load_finish", {
          agentId,
          sessionKey,
          requestedLimit,
          requestedMaxChars,
          previewItemCount: nextPreviewItems.length,
          totalDurationMs: Date.now() - requestStartedAt,
        });
      } catch (error) {
        if (!isDisconnectLikeError(error)) {
          console.error("Failed to load focused session preview.", error);
        }
      } finally {
        previewInFlightRef.current.delete(sessionKey);
      }
    },
    [dispatch, isDisconnectLikeError]
  );

  const loadAgentHistory = useCallback(
    async (
      agentId: string,
      options?: { limit?: number; reason?: HistoryLoadReason }
    ) => {
      const targetAgent =
        agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      if (!targetAgent || !targetAgent.sessionCreated) return;
      const sessionKey = targetAgent.sessionKey.trim();
      if (!sessionKey) return;
      if (historyInFlightRef.current.has(sessionKey)) return;

      const reason = options?.reason ?? "refresh";
      const requestedLimitRaw =
        typeof options?.limit === "number" && Number.isFinite(options.limit)
          ? Math.floor(options.limit)
          : defaultHistoryLimit;
      const requestedLimit = Math.max(1, Math.min(maxHistoryLimit, requestedLimitRaw));
      const includeTraceHistory = targetAgent.showThinkingTraces === true;

      if (
        reason === "load-more" &&
        targetAgent.historyGatewayCapReached &&
        typeof targetAgent.historyFetchLimit === "number" &&
        requestedLimit <= targetAgent.historyFetchLimit
      ) {
        logTranscriptDebugMetric("history_load_skipped_gateway_cap", {
          agentId,
          sessionKey,
          reason,
          requestedLimit,
        });
        return;
      }

      historyInFlightRef.current.add(sessionKey);
      const requestId = randomUUID();
      const loadedAt = Date.now();
      const requestStartedAt = Date.now();
      const sessionEpoch = normalizeSessionEpoch(targetAgent.sessionEpoch);
      const abortController = new AbortController();
      historyAbortControllersRef.current.set(sessionKey, abortController);
      historyRequestContextRef.current.set(sessionKey, {
        agentId,
        sessionKey,
        sessionEpoch,
        requestId,
        controller: abortController,
        reason,
      });
      logTranscriptDebugMetric("history_load_start", {
        agentId,
        sessionKey,
        reason,
        requestedLimit,
        includeTraceHistory,
        requestId,
      });

      try {
        let history: DomainAgentHistoryResult;
        let fromCache = false;
        let fetchDurationMs = 0;

        const cached = historyCacheRef.current.get(sessionKey);
        const canUseCache =
          reason !== "refresh" &&
          cached &&
          cached.requestedLimit >= requestedLimit;

        if (canUseCache) {
          history = cached.history;
          fromCache = true;
        } else {
          const fetchStartedAt = Date.now();
          history = await loadDomainAgentHistoryWindow({
            agentId,
            sessionKey,
            view: "semantic",
            turnLimit: requestedLimit,
            scanLimit: resolveScanLimitForReason({
              reason,
              requestedLimit,
              maxHistoryLimit,
            }),
            includeThinking: includeTraceHistory,
            includeTools: includeTraceHistory,
            signal: abortController.signal,
          });
          fetchDurationMs = Date.now() - fetchStartedAt;
          historyCacheRef.current.set(sessionKey, {
            requestedLimit,
            fetchedAt: Date.now(),
            history,
          });
        }

        const latest =
          agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        if (!latest) return;
        if (latest.sessionKey.trim() !== sessionKey) {
          logTranscriptDebugMetric("history_load_stale_ignored", {
            agentId,
            sessionKey,
            requestId,
            reason,
            staleCause: "session-key-changed",
          });
          return;
        }
        if (normalizeSessionEpoch(latest.sessionEpoch) !== sessionEpoch) {
          logTranscriptDebugMetric("history_load_stale_ignored", {
            agentId,
            sessionKey,
            requestId,
            reason,
            staleCause: "session-epoch-changed",
          });
          return;
        }

        const hydrateStartedAt = Date.now();
        const patch = hydrateDomainHistoryWindow({
          agent: latest,
          history,
          loadedAt,
          requestId,
          requestedLimit,
          view: "semantic",
          reason,
        });
        const hydrateDurationMs = Date.now() - hydrateStartedAt;

        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });

        logTranscriptDebugMetric("history_load_finish", {
          agentId,
          sessionKey,
          reason,
          requestedLimit,
          requestId,
          fromCache,
          fetchDurationMs,
          hydrateDurationMs,
          totalDurationMs: Date.now() - requestStartedAt,
          messageCount: history.messages.length,
          includeTraceHistory,
          semanticTurnsIncluded: history.semanticTurnsIncluded,
          windowTruncated: history.windowTruncated,
          gatewayLimit: history.gatewayLimit,
          gatewayCapped: history.gatewayCapped,
        });
      } catch (error) {
        if (isAbortError(error)) {
          logTranscriptDebugMetric("history_load_aborted", {
            agentId,
            sessionKey,
            reason,
            requestId,
            requestedLimit,
            totalDurationMs: Date.now() - requestStartedAt,
          });
          return;
        }
        if (!isDisconnectLikeError(error)) {
          console.error("Failed to load domain runtime history.", error);
        }
      } finally {
        const activeContext = historyRequestContextRef.current.get(sessionKey) ?? null;
        const isActiveRequest = activeContext?.requestId === requestId;
        const activeController = historyAbortControllersRef.current.get(sessionKey) ?? null;
        const ownsActiveController =
          activeController !== null && activeContext?.controller === activeController;

        if (isActiveRequest) {
          historyRequestContextRef.current.delete(sessionKey);
          historyInFlightRef.current.delete(sessionKey);
        }
        if (ownsActiveController && activeContext?.controller === abortController) {
          historyAbortControllersRef.current.delete(sessionKey);
        }
      }
    },
    [defaultHistoryLimit, dispatch, isDisconnectLikeError, maxHistoryLimit]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      if (!agent?.historyMaybeTruncated) return;
      if (agent.historyGatewayCapReached) return;

      const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: agent.historyFetchLimit,
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
      });

      if (
        typeof agent.historyFetchLimit === "number" &&
        nextLimit <= agent.historyFetchLimit &&
        agent.historyFetchLimit >= maxHistoryLimit
      ) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: {
            historyGatewayCapReached: true,
          },
        });
        logTranscriptDebugMetric("history_load_more_skipped_reached_max_limit", {
          agentId,
          currentLimit: agent.historyFetchLimit,
          maxHistoryLimit,
        });
        return;
      }

      void loadAgentHistory(agentId, {
        limit: nextLimit,
        reason: "load-more",
      });
    },
    [defaultHistoryLimit, dispatch, loadAgentHistory, maxHistoryLimit]
  );

  const reconcileRunningAgents = useCallback(async () => {
    return;
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    const normalizedFocusedAgentId = focusedAgentId?.trim() ?? "";
    for (const [sessionKey, context] of historyRequestContextRef.current.entries()) {
      const controller = historyAbortControllersRef.current.get(sessionKey) ?? null;
      if (!controller) continue;
      const agent =
        agents.find((entry) => entry.agentId === context.agentId) ?? null;
      const agentSessionKey = agent?.sessionKey.trim() ?? "";
      const agentSessionEpoch = normalizeSessionEpoch(agent?.sessionEpoch);
      const focusChanged =
        normalizedFocusedAgentId.length > 0 && context.agentId !== normalizedFocusedAgentId;
      const sessionInvalid =
        !agent ||
        agentSessionKey !== context.sessionKey ||
        agentSessionEpoch !== context.sessionEpoch;
      if (!focusChanged && !sessionInvalid) continue;

      controller.abort();
      historyAbortControllersRef.current.delete(sessionKey);
      historyRequestContextRef.current.delete(sessionKey);
      historyInFlightRef.current.delete(sessionKey);
      logTranscriptDebugMetric("history_load_cancelled_stale", {
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        requestId: context.requestId,
        reason: context.reason,
        staleCause: sessionInvalid ? "session-invalidated" : "focus-changed",
      });
    }
  }, [agents, focusedAgentId]);

  useEffect(() => {
    const controllers = historyAbortControllersRef.current;
    const contexts = historyRequestContextRef.current;
    const inFlight = historyInFlightRef.current;
    const previewInFlight = previewInFlightRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      contexts.clear();
      inFlight.clear();
      previewInFlight.clear();
    };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    const normalizedFocusedAgentId = focusedAgentId?.trim() ?? "";
    if (!normalizedFocusedAgentId) return;
    const focusedAgent =
      agents.find((entry) => entry.agentId === normalizedFocusedAgentId) ?? null;
    if (!focusedAgent || !focusedAgent.sessionCreated) return;
    if (focusedAgent.historyLoadedAt !== null) return;

    const previewItemCount = Array.isArray(focusedAgent.previewItems)
      ? focusedAgent.previewItems.length
      : 0;
    if (previewItemCount >= FOCUSED_PREVIEW_MIN_ITEMS) return;

    const previewBootstrapKey = buildPreviewBootstrapKey(focusedAgent);
    if (!previewBootstrapKey) return;
    if (previewBootstrapAttemptedRef.current.has(previewBootstrapKey)) return;
    previewBootstrapAttemptedRef.current.add(previewBootstrapKey);
    void loadFocusedAgentPreview(normalizedFocusedAgentId, {
      limit: FOCUSED_PREVIEW_LIMIT,
      maxChars: FOCUSED_PREVIEW_MAX_CHARS,
    });
  }, [agents, focusedAgentId, loadFocusedAgentPreview, status]);

  useEffect(() => {
    const bootstrapAgentIds = resolveRuntimeSyncBootstrapHistoryAgentIds({
      status,
      agents,
    });
    const normalizedFocusedAgentId = focusedAgentId?.trim() ?? "";
    if (!normalizedFocusedAgentId) return;
    if (!bootstrapAgentIds.includes(normalizedFocusedAgentId)) return;
    void loadAgentHistory(normalizedFocusedAgentId, {
      reason: "bootstrap",
      limit: Math.min(defaultHistoryLimit, BOOTSTRAP_HISTORY_LIMIT),
    });
  }, [agents, defaultHistoryLimit, focusedAgentId, loadAgentHistory, status]);

  return {
    loadSummarySnapshot,
    loadAgentHistory,
    loadMoreAgentHistory,
    reconcileRunningAgents,
    clearHistoryInFlight,
  };
}
