import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  planAutoResumeIntent,
  planIngressCommands,
  planPausedRunMapCleanup,
  planPauseRunIntent,
  type ExecApprovalIngressCommand,
  type ExecApprovalPendingSnapshot,
} from "@/features/agents/approvals/execApprovalControlLoopWorkflow";
import type { AgentState } from "@/features/agents/state/store";

type GatewayEventFrame = Parameters<typeof planIngressCommands>[0]["event"];

export type PauseRunControlPlan = {
  stalePausedAgentIds: string[];
  pauseIntent: ReturnType<typeof planPauseRunIntent>;
};

export type AutoResumeRunControlPlan = {
  preWaitIntent: ReturnType<typeof planAutoResumeIntent>;
  postWaitIntent: ReturnType<typeof planAutoResumeIntent>;
};

export function planPauseRunControl(params: {
  approval: PendingExecApproval;
  preferredAgentId: string | null;
  agents: AgentState[];
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
}): PauseRunControlPlan {
  return {
    stalePausedAgentIds: planPausedRunMapCleanup({
      pausedRunIdByAgentId: params.pausedRunIdByAgentId,
      agents: params.agents,
    }),
    pauseIntent: planPauseRunIntent({
      approval: params.approval,
      preferredAgentId: params.preferredAgentId,
      agents: params.agents,
      pausedRunIdByAgentId: params.pausedRunIdByAgentId,
    }),
  };
}

export function planAutoResumeRunControl(params: {
  approval: PendingExecApproval;
  targetAgentId: string;
  pendingState: ExecApprovalPendingSnapshot;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  agents: AgentState[];
}): AutoResumeRunControlPlan {
  const preWaitIntent = planAutoResumeIntent({
    approval: params.approval,
    targetAgentId: params.targetAgentId,
    pendingState: params.pendingState,
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
    agents: params.agents,
  });
  if (preWaitIntent.kind !== "resume") {
    return {
      preWaitIntent,
      postWaitIntent: preWaitIntent,
    };
  }

  return {
    preWaitIntent,
    postWaitIntent: planAutoResumeIntent({
      approval: params.approval,
      targetAgentId: preWaitIntent.targetAgentId,
      pendingState: params.pendingState,
      pausedRunIdByAgentId: new Map([
        [preWaitIntent.targetAgentId, preWaitIntent.pausedRunId],
      ]),
      agents: params.agents,
    }),
  };
}

export function planApprovalIngressRunControl(params: {
  event: GatewayEventFrame;
  agents: AgentState[];
  pendingState: ExecApprovalPendingSnapshot;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  seenCronDedupeKeys: ReadonlySet<string>;
  nowMs: number;
}): ExecApprovalIngressCommand[] {
  return planIngressCommands({
    event: params.event,
    agents: params.agents,
    pendingState: params.pendingState,
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
    seenCronDedupeKeys: params.seenCronDedupeKeys,
    nowMs: params.nowMs,
  });
}
