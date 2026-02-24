import type { AgentState } from "@/features/agents/state/store";

export type RuntimeSyncStatus = "disconnected" | "connecting" | "connected";

export const RUNTIME_SYNC_RECONCILE_INTERVAL_MS = 3000;
export const RUNTIME_SYNC_FOCUSED_HISTORY_INTERVAL_MS = 4500;
export const RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT = 200;
export const RUNTIME_SYNC_MAX_HISTORY_LIMIT = 5000;

const RUNTIME_SYNC_MIN_LOAD_MORE_HISTORY_LIMIT = 400;

type RuntimeSyncHistoryBootstrapAgent = Pick<
  AgentState,
  "agentId" | "sessionCreated" | "historyLoadedAt"
>;

type RuntimeSyncFocusedPollingAgent = Pick<AgentState, "agentId" | "status">;

export type RuntimeSyncReconcilePollingIntent =
  | { kind: "start"; intervalMs: number; runImmediately: true }
  | { kind: "stop"; reason: "not-connected" };

export type RuntimeSyncFocusedHistoryPollingIntent =
  | { kind: "start"; agentId: string; intervalMs: number; runImmediately: true }
  | {
      kind: "stop";
      reason: "not-connected" | "missing-focused-agent" | "focused-not-running";
    };

export const resolveRuntimeSyncReconcilePollingIntent = (params: {
  status: RuntimeSyncStatus;
}): RuntimeSyncReconcilePollingIntent => {
  if (params.status !== "connected") {
    return { kind: "stop", reason: "not-connected" };
  }
  return {
    kind: "start",
    intervalMs: RUNTIME_SYNC_RECONCILE_INTERVAL_MS,
    runImmediately: true,
  };
};

export const resolveRuntimeSyncBootstrapHistoryAgentIds = (params: {
  status: RuntimeSyncStatus;
  agents: RuntimeSyncHistoryBootstrapAgent[];
}): string[] => {
  if (params.status !== "connected") return [];
  const ids: string[] = [];
  for (const agent of params.agents) {
    if (!agent.sessionCreated) continue;
    if (agent.historyLoadedAt !== null) continue;
    const agentId = agent.agentId.trim();
    if (!agentId) continue;
    ids.push(agentId);
  }
  return ids;
};

export const resolveRuntimeSyncFocusedHistoryPollingIntent = (params: {
  status: RuntimeSyncStatus;
  focusedAgentId: string | null;
  focusedAgentRunning: boolean;
}): RuntimeSyncFocusedHistoryPollingIntent => {
  if (params.status !== "connected") {
    return { kind: "stop", reason: "not-connected" };
  }
  const focusedAgentId = params.focusedAgentId?.trim() ?? "";
  if (!focusedAgentId) {
    return { kind: "stop", reason: "missing-focused-agent" };
  }
  if (!params.focusedAgentRunning) {
    return { kind: "stop", reason: "focused-not-running" };
  }
  return {
    kind: "start",
    agentId: focusedAgentId,
    intervalMs: RUNTIME_SYNC_FOCUSED_HISTORY_INTERVAL_MS,
    runImmediately: true,
  };
};

export const shouldRuntimeSyncContinueFocusedHistoryPolling = (params: {
  agentId: string;
  agents: RuntimeSyncFocusedPollingAgent[];
}): boolean => {
  const target = params.agentId.trim();
  if (!target) return false;
  const agent = params.agents.find((entry) => entry.agentId === target) ?? null;
  if (!agent) return false;
  return agent.status === "running";
};

export const resolveRuntimeSyncLoadMoreHistoryLimit = (params: {
  currentLimit: number | null;
  defaultLimit: number;
  maxLimit: number;
}): number => {
  const currentLimit =
    typeof params.currentLimit === "number" && Number.isFinite(params.currentLimit)
      ? params.currentLimit
      : params.defaultLimit;
  const nextLimit = Math.max(RUNTIME_SYNC_MIN_LOAD_MORE_HISTORY_LIMIT, currentLimit * 2);
  return Math.min(params.maxLimit, nextLimit);
};

export const resolveRuntimeSyncGapRecoveryIntent = () => {
  return {
    refreshSummarySnapshot: true,
    reconcileRunningAgents: true,
  } as const;
};
