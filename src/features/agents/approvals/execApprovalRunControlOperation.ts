import type {
  ExecApprovalDecision,
  PendingExecApproval,
} from "@/features/agents/approvals/types";
import type {
  ExecApprovalIngressCommand,
  ExecApprovalPendingSnapshot,
} from "@/features/agents/approvals/execApprovalControlLoopWorkflow";
import { resolveExecApprovalViaStudio } from "@/features/agents/approvals/execApprovalResolveOperation";
import {
  planApprovalIngressRunControl,
  planAutoResumeRunControl,
  planPauseRunControl,
} from "@/features/agents/approvals/execApprovalRunControlWorkflow";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";
import type { AgentState } from "@/features/agents/state/store";
import type { EventFrame } from "@/lib/gateway/GatewayClient";
import { EXEC_APPROVAL_AUTO_RESUME_MARKER } from "@/lib/text/message-extract";

type GatewayClientLike = {
  call: (method: string, params: unknown) => Promise<unknown>;
};

type RunControlDispatchAction =
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | { type: "appendOutput"; agentId: string; line: string; transcript?: Record<string, unknown> }
  | { type: "markActivity"; agentId: string; at?: number };

type RunControlDispatch = (action: RunControlDispatchAction) => void;

type SetState<T> = (next: T | ((current: T) => T)) => void;

const AUTO_RESUME_FOLLOW_UP_MESSAGE = `${EXEC_APPROVAL_AUTO_RESUME_MARKER}\nContinue where you left off and finish the task.`;
export const EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS = 3_000;

export async function runPauseRunForExecApprovalOperation(params: {
  status: string;
  client: GatewayClientLike;
  approval: PendingExecApproval;
  preferredAgentId?: string | null;
  getAgents: () => AgentState[];
  pausedRunIdByAgentId: Map<string, string>;
  isDisconnectLikeError: (error: unknown) => boolean;
  logWarn?: (message: string, error: unknown) => void;
}): Promise<void> {
  if (params.status !== "connected") return;

  const plan = planPauseRunControl({
    approval: params.approval,
    preferredAgentId: params.preferredAgentId ?? null,
    agents: params.getAgents(),
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
  });
  for (const agentId of plan.stalePausedAgentIds) {
    params.pausedRunIdByAgentId.delete(agentId);
  }
  if (plan.pauseIntent.kind !== "pause") {
    return;
  }

  params.pausedRunIdByAgentId.set(plan.pauseIntent.agentId, plan.pauseIntent.runId);
  try {
    await params.client.call("chat.abort", {
      sessionKey: plan.pauseIntent.sessionKey,
    });
  } catch (error) {
    params.pausedRunIdByAgentId.delete(plan.pauseIntent.agentId);
    if (!params.isDisconnectLikeError(error)) {
      (params.logWarn ?? ((message, err) => console.warn(message, err)))(
        "Failed to pause run for pending exec approval.",
        error
      );
    }
  }
}

export async function runExecApprovalAutoResumeOperation(params: {
  client: GatewayClientLike;
  dispatch: RunControlDispatch;
  approval: PendingExecApproval;
  targetAgentId: string;
  getAgents: () => AgentState[];
  getPendingState: () => ExecApprovalPendingSnapshot;
  pausedRunIdByAgentId: Map<string, string>;
  isDisconnectLikeError: (error: unknown) => boolean;
  logWarn?: (message: string, error: unknown) => void;
  clearRunTracking?: (runId: string) => void;
  sendChatMessage?: typeof sendChatMessageViaStudio;
  now?: () => number;
}): Promise<void> {
  const sendChatMessage = params.sendChatMessage ?? sendChatMessageViaStudio;
  const pendingState = params.getPendingState();
  const prePlan = planAutoResumeRunControl({
    approval: params.approval,
    targetAgentId: params.targetAgentId,
    pendingState,
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
    agents: params.getAgents(),
  });
  if (prePlan.preWaitIntent.kind !== "resume") {
    return;
  }

  const preWaitIntent = prePlan.preWaitIntent;
  params.pausedRunIdByAgentId.delete(preWaitIntent.targetAgentId);
  params.dispatch({
    type: "updateAgent",
    agentId: preWaitIntent.targetAgentId,
    patch: {
      status: "running",
      runId: preWaitIntent.pausedRunId,
      lastActivityAt: (params.now ?? (() => Date.now()))(),
    },
  });

  try {
    await params.client.call("agent.wait", {
      runId: preWaitIntent.pausedRunId,
      timeoutMs: EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (!params.isDisconnectLikeError(error)) {
      (params.logWarn ?? ((message, err) => console.warn(message, err)))(
        "Failed waiting for paused run before auto-resume.",
        error
      );
    }
  }

  const postPlan = planAutoResumeRunControl({
    approval: params.approval,
    targetAgentId: preWaitIntent.targetAgentId,
    pendingState,
    pausedRunIdByAgentId: new Map([[preWaitIntent.targetAgentId, preWaitIntent.pausedRunId]]),
    agents: params.getAgents(),
  });
  if (postPlan.postWaitIntent.kind !== "resume") {
    return;
  }

  await sendChatMessage({
    client: params.client,
    dispatch: params.dispatch,
    getAgent: (agentId) => params.getAgents().find((entry) => entry.agentId === agentId) ?? null,
    agentId: postPlan.postWaitIntent.targetAgentId,
    sessionKey: postPlan.postWaitIntent.sessionKey,
    message: AUTO_RESUME_FOLLOW_UP_MESSAGE,
    clearRunTracking: params.clearRunTracking,
    echoUserMessage: false,
  });
}

export async function runResolveExecApprovalOperation(params: {
  client: GatewayClientLike;
  approvalId: string;
  decision: ExecApprovalDecision;
  getAgents: () => AgentState[];
  getPendingState: () => ExecApprovalPendingSnapshot;
  setPendingExecApprovalsByAgentId: SetState<Record<string, PendingExecApproval[]>>;
  setUnscopedPendingExecApprovals: SetState<PendingExecApproval[]>;
  requestHistoryRefresh: (agentId: string) => Promise<void> | void;
  pausedRunIdByAgentId: Map<string, string>;
  dispatch: RunControlDispatch;
  isDisconnectLikeError: (error: unknown) => boolean;
  logWarn?: (message: string, error: unknown) => void;
  clearRunTracking?: (runId: string) => void;
  resolveExecApproval?: typeof resolveExecApprovalViaStudio;
  runAutoResume?: typeof runExecApprovalAutoResumeOperation;
}): Promise<void> {
  const resolveExecApproval = params.resolveExecApproval ?? resolveExecApprovalViaStudio;
  const runAutoResume = params.runAutoResume ?? runExecApprovalAutoResumeOperation;

  await resolveExecApproval({
    client: params.client,
    approvalId: params.approvalId,
    decision: params.decision,
    getAgents: params.getAgents,
    getLatestAgent: (agentId) =>
      params.getAgents().find((entry) => entry.agentId === agentId) ?? null,
    getPendingState: params.getPendingState,
    setPendingExecApprovalsByAgentId: params.setPendingExecApprovalsByAgentId,
    setUnscopedPendingExecApprovals: params.setUnscopedPendingExecApprovals,
    requestHistoryRefresh: params.requestHistoryRefresh,
    onAllowed: async ({ approval, targetAgentId }) => {
      await runAutoResume({
        client: params.client,
        dispatch: params.dispatch,
        approval,
        targetAgentId,
        getAgents: params.getAgents,
        getPendingState: params.getPendingState,
        pausedRunIdByAgentId: params.pausedRunIdByAgentId,
        isDisconnectLikeError: params.isDisconnectLikeError,
        logWarn: params.logWarn,
        clearRunTracking: params.clearRunTracking,
      });
    },
    isDisconnectLikeError: params.isDisconnectLikeError,
    logWarn: params.logWarn,
  });
}

export function executeExecApprovalIngressCommands(params: {
  commands: ExecApprovalIngressCommand[];
  replacePendingState: (nextPendingState: ExecApprovalPendingSnapshot) => void;
  pauseRunForApproval: (
    approval: PendingExecApproval,
    preferredAgentId: string | null
  ) => Promise<void> | void;
  dispatch: RunControlDispatch;
  recordCronDedupeKey: (dedupeKey: string) => void;
}): void {
  for (const command of params.commands) {
    if (command.kind === "replacePendingState") {
      params.replacePendingState(command.pendingState);
      continue;
    }
    if (command.kind === "pauseRunForApproval") {
      void params.pauseRunForApproval(command.approval, command.preferredAgentId);
      continue;
    }
    if (command.kind === "markActivity") {
      params.dispatch({
        type: "markActivity",
        agentId: command.agentId,
      });
      continue;
    }
    if (command.kind === "recordCronDedupeKey") {
      params.recordCronDedupeKey(command.dedupeKey);
      continue;
    }

    const intent = command.intent;
    params.dispatch({
      type: "appendOutput",
      agentId: intent.agentId,
      line: intent.line,
      transcript: {
        source: "runtime-agent",
        role: "assistant",
        kind: "assistant",
        sessionKey: intent.sessionKey,
        timestampMs: intent.timestampMs,
        entryId: intent.dedupeKey,
        confirmed: true,
      },
    });
    params.dispatch({
      type: "markActivity",
      agentId: intent.agentId,
      at: intent.activityAtMs ?? undefined,
    });
  }
}

export function runGatewayEventIngressOperation(params: {
  event: EventFrame;
  getAgents: () => AgentState[];
  getPendingState: () => ExecApprovalPendingSnapshot;
  pausedRunIdByAgentId: ReadonlyMap<string, string>;
  seenCronDedupeKeys: ReadonlySet<string>;
  nowMs: number;
  replacePendingState: (nextPendingState: ExecApprovalPendingSnapshot) => void;
  pauseRunForApproval: (
    approval: PendingExecApproval,
    preferredAgentId: string | null
  ) => Promise<void> | void;
  dispatch: RunControlDispatch;
  recordCronDedupeKey: (dedupeKey: string) => void;
}): ExecApprovalIngressCommand[] {
  const commands = planApprovalIngressRunControl({
    event: params.event,
    agents: params.getAgents(),
    pendingState: params.getPendingState(),
    pausedRunIdByAgentId: params.pausedRunIdByAgentId,
    seenCronDedupeKeys: params.seenCronDedupeKeys,
    nowMs: params.nowMs,
  });
  executeExecApprovalIngressCommands({
    commands,
    replacePendingState: params.replacePendingState,
    pauseRunForApproval: params.pauseRunForApproval,
    dispatch: params.dispatch,
    recordCronDedupeKey: params.recordCronDedupeKey,
  });
  return commands;
}
