import type { AgentState } from "@/features/agents/state/store";
import {
  buildReconcileTerminalPatch,
  resolveReconcileEligibility,
  resolveReconcileWaitOutcome,
} from "@/features/agents/operations/fleetLifecycleWorkflow";

type GatewayClientLike = {
  call: (method: string, params: unknown) => Promise<unknown>;
};

const callGateway = async <T>(
  client: GatewayClientLike,
  method: string,
  params: unknown
): Promise<T> => {
  const invoke = (
    client as unknown as { call?: (nextMethod: string, nextParams: unknown) => Promise<unknown> }
  ).call;
  if (typeof invoke !== "function") {
    throw new Error("Gateway call transport is unavailable.");
  }
  return (await invoke(method, params)) as T;
};

type ReconcileCommand =
  | { kind: "clearRunTracking"; runId: string }
  | { kind: "dispatchUpdateAgent"; agentId: string; patch: Partial<AgentState> }
  | { kind: "requestHistoryRefresh"; agentId: string }
  | { kind: "logInfo"; message: string }
  | { kind: "logWarn"; message: string; error: unknown };

type ReconcileDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

export const executeAgentReconcileCommands = (params: {
  commands: ReconcileCommand[];
  dispatch: (action: ReconcileDispatchAction) => void;
  clearRunTracking: (runId: string) => void;
  requestHistoryRefresh: (agentId: string) => void;
  logInfo: (message: string) => void;
  logWarn: (message: string, error: unknown) => void;
}) => {
  for (const command of params.commands) {
    if (command.kind === "clearRunTracking") {
      params.clearRunTracking(command.runId);
      continue;
    }
    if (command.kind === "dispatchUpdateAgent") {
      params.dispatch({
        type: "updateAgent",
        agentId: command.agentId,
        patch: command.patch,
      });
      continue;
    }
    if (command.kind === "requestHistoryRefresh") {
      params.requestHistoryRefresh(command.agentId);
      continue;
    }
    if (command.kind === "logInfo") {
      params.logInfo(command.message);
      continue;
    }
    if (command.kind === "logWarn") {
      params.logWarn(command.message, command.error);
    }
  }
};

export const runAgentReconcileOperation = async (params: {
  client: GatewayClientLike;
  agents: AgentState[];
  getLatestAgent: (agentId: string) => AgentState | null;
  claimRunId: (runId: string) => boolean;
  releaseRunId: (runId: string) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
}): Promise<ReconcileCommand[]> => {
  const commands: ReconcileCommand[] = [];

  for (const agent of params.agents) {
    const eligibility = resolveReconcileEligibility({
      status: agent.status,
      sessionCreated: agent.sessionCreated,
      runId: agent.runId,
    });
    if (!eligibility.shouldCheck) continue;

    const runId = agent.runId?.trim() ?? "";
    if (!runId) continue;

    if (!params.claimRunId(runId)) continue;

    try {
      const result = await callGateway<{ status?: unknown }>(params.client, "agent.wait", {
        runId,
        timeoutMs: 1,
      });
      const outcome = resolveReconcileWaitOutcome(result?.status);
      if (!outcome) {
        continue;
      }

      const latest = params.getLatestAgent(agent.agentId);
      if (!latest || latest.runId !== runId || latest.status !== "running") {
        continue;
      }

      commands.push({ kind: "clearRunTracking", runId });
      commands.push({
        kind: "dispatchUpdateAgent",
        agentId: agent.agentId,
        patch: buildReconcileTerminalPatch({ outcome }),
      });
      commands.push({
        kind: "logInfo",
        message: `[agent-reconcile] ${agent.agentId} run ${runId} resolved as ${outcome}.`,
      });
      commands.push({
        kind: "requestHistoryRefresh",
        agentId: agent.agentId,
      });
    } catch (err) {
      if (!params.isDisconnectLikeError(err)) {
        commands.push({
          kind: "logWarn",
          message: "Failed to reconcile running agent.",
          error: err,
        });
      }
    } finally {
      params.releaseRunId(runId);
    }
  }

  return commands;
};
