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
  buildSummarySnapshotPatches,
  type SummaryPreviewSnapshot,
  type SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import { TRANSCRIPT_V2_ENABLED, logTranscriptDebugMetric } from "@/features/agents/state/transcript";
import { randomUUID } from "@/lib/uuid";

type RuntimeSyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type GatewayClientLike = {
  call: <T = unknown>(method: string, params: unknown) => Promise<T>;
  onGap: (handler: (info: { expected: number; received: number }) => void) => () => void;
};

export type UseRuntimeSyncControllerParams = {
  client: GatewayClientLike;
  status: "disconnected" | "connecting" | "connected";
  agents: AgentState[];
  focusedAgentId: string | null;
  focusedAgentRunning: boolean;
  dispatch: (action: RuntimeSyncDispatchAction) => void;
  clearRunTracking: (runId: string) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

export type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (agentId: string, options?: { limit?: number }) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

export function useRuntimeSyncController(
  params: UseRuntimeSyncControllerParams
): RuntimeSyncController {
  const agentsRef = useRef(params.agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

  useEffect(() => {
    agentsRef.current = params.agents;
  }, [params.agents]);

  const clearHistoryInFlight = useCallback((sessionKey: string) => {
    const key = sessionKey.trim();
    if (!key) return;
    historyInFlightRef.current.delete(key);
  }, []);

  const loadSummarySnapshot = useCallback(async () => {
    const snapshotAgents = agentsRef.current;
    const summaryIntent = resolveSummarySnapshotIntent({
      agents: snapshotAgents,
      maxKeys: 64,
    });
    if (summaryIntent.kind === "skip") return;
    const activeAgents = snapshotAgents.filter((agent) => agent.sessionCreated);
    try {
      const [statusSummary, previewResult] = await Promise.all([
        params.client.call<SummaryStatusSnapshot>("status", {}),
        params.client.call<SummaryPreviewSnapshot>("sessions.preview", {
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
        params.dispatch({
          type: "updateAgent",
          agentId: entry.agentId,
          patch: entry.patch,
        });
      }
    } catch (error) {
      if (!params.isDisconnectLikeError(error)) {
        console.error("Failed to load summary snapshot.", error);
      }
    }
  }, [params.client, params.dispatch, params.isDisconnectLikeError]);

  const loadAgentHistory = useCallback(
    async (agentId: string, options?: { limit?: number }) => {
      const commands = await runHistorySyncOperation({
        client: params.client,
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
        dispatch: params.dispatch,
        logMetric: (metric, meta) => logTranscriptDebugMetric(metric, meta),
        isDisconnectLikeError: params.isDisconnectLikeError,
        logError: (message, error) => console.error(message, error),
      });
    },
    [
      defaultHistoryLimit,
      maxHistoryLimit,
      params.client,
      params.dispatch,
      params.isDisconnectLikeError,
    ]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: agent?.historyFetchLimit ?? null,
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
      });
      void loadAgentHistory(agentId, { limit: nextLimit });
    },
    [defaultHistoryLimit, loadAgentHistory, maxHistoryLimit]
  );

  const reconcileRunningAgents = useCallback(async () => {
    if (params.status !== "connected") return;
    const commands = await runAgentReconcileOperation({
      client: params.client,
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
      isDisconnectLikeError: params.isDisconnectLikeError,
    });
    executeAgentReconcileCommands({
      commands,
      dispatch: params.dispatch,
      clearRunTracking: params.clearRunTracking,
      requestHistoryRefresh: (agentId) => {
        void loadAgentHistory(agentId);
      },
      logInfo: (message) => console.info(message),
      logWarn: (message, error) => console.warn(message, error),
    });
  }, [
    loadAgentHistory,
    params.clearRunTracking,
    params.client,
    params.dispatch,
    params.isDisconnectLikeError,
    params.status,
  ]);

  useEffect(() => {
    if (params.status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, params.status]);

  useEffect(() => {
    const reconcileIntent = resolveRuntimeSyncReconcilePollingIntent({
      status: params.status,
    });
    if (reconcileIntent.kind === "stop") return;
    void reconcileRunningAgents();
    const timer = window.setInterval(() => {
      void reconcileRunningAgents();
    }, reconcileIntent.intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [params.status, reconcileRunningAgents]);

  useEffect(() => {
    const bootstrapAgentIds = resolveRuntimeSyncBootstrapHistoryAgentIds({
      status: params.status,
      agents: params.agents,
    });
    for (const agentId of bootstrapAgentIds) {
      void loadAgentHistory(agentId);
    }
  }, [loadAgentHistory, params.agents, params.status]);

  useEffect(() => {
    const pollingIntent = resolveRuntimeSyncFocusedHistoryPollingIntent({
      status: params.status,
      focusedAgentId: params.focusedAgentId,
      focusedAgentRunning: params.focusedAgentRunning,
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
  }, [loadAgentHistory, params.focusedAgentId, params.focusedAgentRunning, params.status]);

  useEffect(() => {
    return params.client.onGap((info) => {
      const recoveryIntent = resolveRuntimeSyncGapRecoveryIntent();
      console.warn(`Gateway event gap expected ${info.expected}, received ${info.received}.`);
      if (recoveryIntent.refreshSummarySnapshot) {
        void loadSummarySnapshot();
      }
      if (recoveryIntent.reconcileRunningAgents) {
        void reconcileRunningAgents();
      }
    });
  }, [loadSummarySnapshot, params.client, reconcileRunningAgents]);

  return {
    loadSummarySnapshot,
    loadAgentHistory,
    loadMoreAgentHistory,
    reconcileRunningAgents,
    clearHistoryInFlight,
  };
}
