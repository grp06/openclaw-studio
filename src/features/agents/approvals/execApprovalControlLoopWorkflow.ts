import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  applyApprovalIngressEffects,
  deriveAwaitingUserInputPatches,
  derivePendingApprovalPruneDelayMs,
  prunePendingApprovalState,
  resolveApprovalAutoResumeDispatch,
  resolveApprovalAutoResumePreflight,
  type ApprovalPendingState,
  type AwaitingUserInputPatch,
} from "@/features/agents/approvals/execApprovalRuntimeCoordinator";
import { shouldPauseRunForPendingExecApproval } from "@/features/agents/approvals/execApprovalPausePolicy";
import {
  resolveGatewayEventIngressDecision,
  type CronTranscriptIntent,
} from "@/features/agents/state/gatewayEventIngressWorkflow";
import type { AgentState } from "@/features/agents/state/store";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

export type ExecApprovalPendingSnapshot = ApprovalPendingState;

export type ExecApprovalIngressCommand =
  | { kind: "replacePendingState"; pendingState: ApprovalPendingState }
  | {
      kind: "pauseRunForApproval";
      approval: PendingExecApproval;
      preferredAgentId: string | null;
    }
  | { kind: "markActivity"; agentId: string }
  | { kind: "recordCronDedupeKey"; dedupeKey: string }
  | { kind: "appendCronTranscript"; intent: CronTranscriptIntent };

export type PauseRunIntent =
  | { kind: "skip"; reason: string }
  | { kind: "pause"; agentId: string; sessionKey: string; runId: string };

export type AutoResumeIntent =
  | { kind: "skip"; reason: string }
  | { kind: "resume"; targetAgentId: string; pausedRunId: string; sessionKey: string };

const resolvePauseTargetAgent = (params: {
  approval: PendingExecApproval;
  preferredAgentId: string | null | undefined;
  agents: AgentState[];
}): AgentState | null => {
  const preferredAgentId = params.preferredAgentId?.trim() ?? "";
  if (preferredAgentId) {
    const match =
      params.agents.find((agent) => agent.agentId === preferredAgentId) ?? null;
    if (match) return match;
  }

  const approvalSessionKey = params.approval.sessionKey?.trim() ?? "";
  if (!approvalSessionKey) return null;

  return (
    params.agents.find((agent) => agent.sessionKey.trim() === approvalSessionKey) ??
    null
  );
};

export const planPausedRunMapCleanup = (params: {
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  agents: AgentState[];
}): string[] => {
  const staleAgentIds: string[] = [];
  for (const [agentId, trackedRunId] of params.pausedRunIdByAgentId.entries()) {
    const trackedAgent = params.agents.find((agent) => agent.agentId === agentId) ?? null;
    const currentRunId = trackedAgent?.runId?.trim() ?? "";
    if (!currentRunId || currentRunId !== trackedRunId) {
      staleAgentIds.push(agentId);
    }
  }
  return staleAgentIds;
};

export const planPauseRunIntent = (params: {
  approval: PendingExecApproval;
  preferredAgentId?: string | null;
  agents: AgentState[];
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
}): PauseRunIntent => {
  const agent = resolvePauseTargetAgent({
    approval: params.approval,
    preferredAgentId: params.preferredAgentId,
    agents: params.agents,
  });
  if (!agent) {
    return { kind: "skip", reason: "missing-agent" };
  }

  const runId = agent.runId?.trim() ?? "";
  if (!runId) {
    return { kind: "skip", reason: "missing-run-id" };
  }

  const pausedRunId = params.pausedRunIdByAgentId.get(agent.agentId) ?? null;
  const shouldPause = shouldPauseRunForPendingExecApproval({
    agent,
    approval: params.approval,
    pausedRunId,
  });
  if (!shouldPause) {
    return { kind: "skip", reason: "pause-policy-denied" };
  }

  const sessionKey = agent.sessionKey.trim();
  if (!sessionKey) {
    return { kind: "skip", reason: "missing-session-key" };
  }

  return {
    kind: "pause",
    agentId: agent.agentId,
    sessionKey,
    runId,
  };
};

export const planAutoResumeIntent = (params: {
  approval: PendingExecApproval;
  targetAgentId: string;
  pendingState: ApprovalPendingState;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  agents: AgentState[];
}): AutoResumeIntent => {
  const preflight = resolveApprovalAutoResumePreflight({
    approval: params.approval,
    targetAgentId: params.targetAgentId,
    pendingState: params.pendingState,
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
  });

  if (preflight.kind !== "resume") {
    return { kind: "skip", reason: preflight.reason };
  }

  const dispatchIntent = resolveApprovalAutoResumeDispatch({
    targetAgentId: preflight.targetAgentId,
    pausedRunId: preflight.pausedRunId,
    agents: params.agents,
  });

  if (dispatchIntent.kind !== "resume") {
    return { kind: "skip", reason: dispatchIntent.reason };
  }

  return {
    kind: "resume",
    targetAgentId: dispatchIntent.targetAgentId,
    pausedRunId: dispatchIntent.pausedRunId,
    sessionKey: dispatchIntent.sessionKey,
  };
};

export const planIngressCommands = (params: {
  event: EventFrame;
  agents: AgentState[];
  pendingState: ApprovalPendingState;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  seenCronDedupeKeys: ReadonlySet<string>;
  nowMs: number;
}): ExecApprovalIngressCommand[] => {
  const ingressDecision = resolveGatewayEventIngressDecision({
    event: params.event,
    agents: params.agents,
    seenCronDedupeKeys: params.seenCronDedupeKeys,
    nowMs: params.nowMs,
  });

  const approvalIngress = applyApprovalIngressEffects({
    pendingState: params.pendingState,
    approvalEffects: ingressDecision.approvalEffects,
    agents: params.agents,
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
  });

  const commands: ExecApprovalIngressCommand[] = [];
  if (
    approvalIngress.pendingState.approvalsByAgentId !== params.pendingState.approvalsByAgentId ||
    approvalIngress.pendingState.unscopedApprovals !== params.pendingState.unscopedApprovals
  ) {
    commands.push({
      kind: "replacePendingState",
      pendingState: approvalIngress.pendingState,
    });
  }

  for (const pauseRequest of approvalIngress.pauseRequests) {
    commands.push({
      kind: "pauseRunForApproval",
      approval: pauseRequest.approval,
      preferredAgentId: pauseRequest.preferredAgentId,
    });
  }

  for (const agentId of approvalIngress.markActivityAgentIds) {
    commands.push({ kind: "markActivity", agentId });
  }

  if (ingressDecision.cronDedupeKeyToRecord) {
    commands.push({
      kind: "recordCronDedupeKey",
      dedupeKey: ingressDecision.cronDedupeKeyToRecord,
    });
  }

  if (ingressDecision.cronTranscriptIntent) {
    commands.push({
      kind: "appendCronTranscript",
      intent: ingressDecision.cronTranscriptIntent,
    });
  }

  return commands;
};

export const planPendingPruneDelay = (params: {
  pendingState: ApprovalPendingState;
  nowMs: number;
  graceMs: number;
}): number | null => {
  return derivePendingApprovalPruneDelayMs(params);
};

export const planPrunedPendingState = (params: {
  pendingState: ApprovalPendingState;
  nowMs: number;
  graceMs: number;
}): ApprovalPendingState => {
  return prunePendingApprovalState(params).pendingState;
};

export const planAwaitingUserInputPatches = (params: {
  agents: AgentState[];
  approvalsByAgentId: Record<string, PendingExecApproval[]>;
}): AwaitingUserInputPatch[] => {
  return deriveAwaitingUserInputPatches(params);
};
