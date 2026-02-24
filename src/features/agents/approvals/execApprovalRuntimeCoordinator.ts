import type { ExecApprovalEventEffects } from "@/features/agents/approvals/execApprovalLifecycleWorkflow";
import { shouldPauseRunForPendingExecApproval } from "@/features/agents/approvals/execApprovalPausePolicy";
import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  nextPendingApprovalPruneDelayMs,
  pruneExpiredPendingApprovals,
  pruneExpiredPendingApprovalsMap,
  removePendingApprovalById,
  removePendingApprovalByIdMap,
  removePendingApprovalEverywhere,
  upsertPendingApproval,
} from "@/features/agents/approvals/pendingStore";
import type { AgentState } from "@/features/agents/state/store";

export type ApprovalPendingState = {
  approvalsByAgentId: Record<string, PendingExecApproval[]>;
  unscopedApprovals: PendingExecApproval[];
};

export type ApprovalPauseRequest = {
  approval: PendingExecApproval;
  preferredAgentId: string | null;
};

export type ApprovalIngressResult = {
  pendingState: ApprovalPendingState;
  pauseRequests: ApprovalPauseRequest[];
  markActivityAgentIds: string[];
};

export type AwaitingUserInputPatch = {
  agentId: string;
  awaitingUserInput: boolean;
};

export type AutoResumePreflightIntent =
  | { kind: "skip"; reason: "missing-paused-run" | "blocking-pending-approvals" }
  | { kind: "resume"; targetAgentId: string; pausedRunId: string };

export type AutoResumeDispatchIntent =
  | { kind: "skip"; reason: "missing-paused-run" | "missing-agent" | "run-replaced" | "missing-session-key" }
  | { kind: "resume"; targetAgentId: string; pausedRunId: string; sessionKey: string };

const resolveAgentForPauseRequest = (params: {
  approval: PendingExecApproval;
  preferredAgentId: string | null;
  agents: AgentState[];
}): AgentState | null => {
  const preferredAgentId = params.preferredAgentId?.trim() ?? "";
  if (preferredAgentId) {
    const match = params.agents.find((agent) => agent.agentId === preferredAgentId) ?? null;
    if (match) return match;
  }
  const approvalSessionKey = params.approval.sessionKey?.trim() ?? "";
  if (!approvalSessionKey) return null;
  return (
    params.agents.find((agent) => agent.sessionKey.trim() === approvalSessionKey) ?? null
  );
};

const shouldQueuePauseRequest = (params: {
  approval: PendingExecApproval;
  preferredAgentId: string | null;
  agents: AgentState[];
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
}): boolean => {
  const agent = resolveAgentForPauseRequest(params);
  if (!agent) return false;
  const pausedRunId = params.pausedRunIdByAgentId.get(agent.agentId) ?? null;
  return shouldPauseRunForPendingExecApproval({
    agent,
    approval: params.approval,
    pausedRunId,
  });
};

export const applyApprovalIngressEffects = (params: {
  pendingState: ApprovalPendingState;
  approvalEffects: ExecApprovalEventEffects | null;
  agents: AgentState[];
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
}): ApprovalIngressResult => {
  const effects = params.approvalEffects;
  if (!effects) {
    return {
      pendingState: params.pendingState,
      pauseRequests: [],
      markActivityAgentIds: [],
    };
  }

  let approvalsByAgentId = params.pendingState.approvalsByAgentId;
  let unscopedApprovals = params.pendingState.unscopedApprovals;
  const pauseRequests: ApprovalPauseRequest[] = [];

  for (const approvalId of effects.removals) {
    const removed = removePendingApprovalEverywhere({
      approvalsByAgentId,
      unscopedApprovals,
      approvalId,
    });
    approvalsByAgentId = removed.approvalsByAgentId;
    unscopedApprovals = removed.unscopedApprovals;
  }

  for (const scopedUpsert of effects.scopedUpserts) {
    approvalsByAgentId = removePendingApprovalByIdMap(
      approvalsByAgentId,
      scopedUpsert.approval.id
    );
    const existing = approvalsByAgentId[scopedUpsert.agentId] ?? [];
    const upserted = upsertPendingApproval(existing, scopedUpsert.approval);
    if (upserted !== existing) {
      approvalsByAgentId = {
        ...approvalsByAgentId,
        [scopedUpsert.agentId]: upserted,
      };
    }
    unscopedApprovals = removePendingApprovalById(
      unscopedApprovals,
      scopedUpsert.approval.id
    );
    if (
      shouldQueuePauseRequest({
        approval: scopedUpsert.approval,
        preferredAgentId: scopedUpsert.agentId,
        agents: params.agents,
        pausedRunIdByAgentId: params.pausedRunIdByAgentId,
      })
    ) {
      pauseRequests.push({
        approval: scopedUpsert.approval,
        preferredAgentId: scopedUpsert.agentId,
      });
    }
  }

  for (const unscopedUpsert of effects.unscopedUpserts) {
    approvalsByAgentId = removePendingApprovalByIdMap(
      approvalsByAgentId,
      unscopedUpsert.id
    );
    const withoutExisting = removePendingApprovalById(
      unscopedApprovals,
      unscopedUpsert.id
    );
    unscopedApprovals = upsertPendingApproval(withoutExisting, unscopedUpsert);
    if (
      shouldQueuePauseRequest({
        approval: unscopedUpsert,
        preferredAgentId: null,
        agents: params.agents,
        pausedRunIdByAgentId: params.pausedRunIdByAgentId,
      })
    ) {
      pauseRequests.push({
        approval: unscopedUpsert,
        preferredAgentId: null,
      });
    }
  }

  return {
    pendingState: {
      approvalsByAgentId,
      unscopedApprovals,
    },
    pauseRequests,
    markActivityAgentIds: effects.markActivityAgentIds,
  };
};

export const deriveAwaitingUserInputPatches = (params: {
  agents: AgentState[];
  approvalsByAgentId: Record<string, PendingExecApproval[]>;
}): AwaitingUserInputPatch[] => {
  const pendingCountsByAgentId = new Map<string, number>();
  for (const [agentId, approvals] of Object.entries(params.approvalsByAgentId)) {
    if (approvals.length <= 0) continue;
    pendingCountsByAgentId.set(agentId, approvals.length);
  }

  const patches: AwaitingUserInputPatch[] = [];
  for (const agent of params.agents) {
    const awaitingUserInput = (pendingCountsByAgentId.get(agent.agentId) ?? 0) > 0;
    if (agent.awaitingUserInput === awaitingUserInput) continue;
    patches.push({
      agentId: agent.agentId,
      awaitingUserInput,
    });
  }
  return patches;
};

export const derivePendingApprovalPruneDelayMs = (params: {
  pendingState: ApprovalPendingState;
  nowMs: number;
  graceMs: number;
}): number | null => {
  return nextPendingApprovalPruneDelayMs({
    approvalsByAgentId: params.pendingState.approvalsByAgentId,
    unscopedApprovals: params.pendingState.unscopedApprovals,
    nowMs: params.nowMs,
    graceMs: params.graceMs,
  });
};

export const prunePendingApprovalState = (params: {
  pendingState: ApprovalPendingState;
  nowMs: number;
  graceMs: number;
}): { pendingState: ApprovalPendingState } => {
  return {
    pendingState: {
      approvalsByAgentId: pruneExpiredPendingApprovalsMap(
        params.pendingState.approvalsByAgentId,
        {
          nowMs: params.nowMs,
          graceMs: params.graceMs,
        }
      ),
      unscopedApprovals: pruneExpiredPendingApprovals(
        params.pendingState.unscopedApprovals,
        {
          nowMs: params.nowMs,
          graceMs: params.graceMs,
        }
      ),
    },
  };
};

export const resolveApprovalAutoResumePreflight = (params: {
  approval: PendingExecApproval;
  targetAgentId: string;
  pendingState: ApprovalPendingState;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
}): AutoResumePreflightIntent => {
  const pausedRunId = params.pausedRunIdByAgentId.get(params.targetAgentId)?.trim() ?? "";
  if (!pausedRunId) {
    return { kind: "skip", reason: "missing-paused-run" };
  }

  const scopedPending = (
    params.pendingState.approvalsByAgentId[params.targetAgentId] ?? []
  ).some((pendingApproval) => pendingApproval.id !== params.approval.id);

  const targetSessionKey = params.approval.sessionKey?.trim() ?? "";
  const unscopedPending = params.pendingState.unscopedApprovals.some((pendingApproval) => {
    if (pendingApproval.id === params.approval.id) return false;
    const pendingAgentId = pendingApproval.agentId?.trim() ?? "";
    if (pendingAgentId && pendingAgentId === params.targetAgentId) return true;
    if (!targetSessionKey) return false;
    return (pendingApproval.sessionKey?.trim() ?? "") === targetSessionKey;
  });

  if (scopedPending || unscopedPending) {
    return { kind: "skip", reason: "blocking-pending-approvals" };
  }

  return {
    kind: "resume",
    targetAgentId: params.targetAgentId,
    pausedRunId,
  };
};

export const resolveApprovalAutoResumeDispatch = (params: {
  targetAgentId: string;
  pausedRunId: string;
  agents: AgentState[];
}): AutoResumeDispatchIntent => {
  const pausedRunId = params.pausedRunId.trim();
  if (!pausedRunId) {
    return { kind: "skip", reason: "missing-paused-run" };
  }

  const latest =
    params.agents.find((agent) => agent.agentId === params.targetAgentId) ?? null;
  if (!latest) {
    return { kind: "skip", reason: "missing-agent" };
  }

  const latestRunId = latest.runId?.trim() ?? "";
  if (latest.status === "running" && latestRunId && latestRunId !== pausedRunId) {
    return { kind: "skip", reason: "run-replaced" };
  }

  const sessionKey = latest.sessionKey.trim();
  if (!sessionKey) {
    return { kind: "skip", reason: "missing-session-key" };
  }

  return {
    kind: "resume",
    targetAgentId: params.targetAgentId,
    pausedRunId,
    sessionKey,
  };
};
