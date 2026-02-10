import { syncGatewaySessionSettings, type GatewayClient } from "@/lib/gateway/GatewayClient";
import { buildAgentInstruction } from "@/lib/text/message-extract";
import type { AgentState } from "@/features/agents/state/store";

type SendDispatchAction =
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | { type: "appendOutput"; agentId: string; line: string };

type SendDispatch = (action: SendDispatchAction) => void;

type GatewayClientLike = {
  call: (method: string, params: unknown) => Promise<unknown>;
};

export async function sendChatMessageViaStudio(params: {
  client: GatewayClientLike;
  dispatch: SendDispatch;
  getAgent: (agentId: string) => AgentState | null;
  agentId: string;
  sessionKey: string;
  message: string;
  clearRunTracking?: (runId: string) => void;
  now?: () => number;
  generateRunId?: () => string;
}): Promise<void> {
  const trimmed = params.message.trim();
  if (!trimmed) return;

  const generateRunId = params.generateRunId ?? (() => crypto.randomUUID());
  const now = params.now ?? (() => Date.now());

  const agentId = params.agentId;
  const runId = generateRunId();

  params.clearRunTracking?.(runId);

  const agent = params.getAgent(agentId);
  if (!agent) {
    params.dispatch({
      type: "appendOutput",
      agentId,
      line: "Error: Agent not found.",
    });
    return;
  }

  const isResetCommand = /^\/(reset|new)(\s|$)/i.test(trimmed);
  if (isResetCommand) {
    params.dispatch({
      type: "updateAgent",
      agentId,
      patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null },
    });
  }

  params.dispatch({
    type: "updateAgent",
    agentId,
    patch: {
      status: "running",
      runId,
      streamText: "",
      thinkingTrace: null,
      draft: "",
      lastUserMessage: trimmed,
      lastActivityAt: now(),
    },
  });
  params.dispatch({
    type: "appendOutput",
    agentId,
    line: `> ${trimmed}`,
  });

  try {
    if (!params.sessionKey) {
      throw new Error("Missing session key for agent.");
    }

    let createdSession = agent.sessionCreated;
    if (!agent.sessionSettingsSynced) {
      await syncGatewaySessionSettings({
        client: params.client as unknown as GatewayClient,
        sessionKey: params.sessionKey,
        model: agent.model ?? null,
        thinkingLevel: agent.thinkingLevel ?? null,
      });
      createdSession = true;
      params.dispatch({
        type: "updateAgent",
        agentId,
        patch: { sessionSettingsSynced: true, sessionCreated: true },
      });
    }

    await params.client.call("chat.send", {
      sessionKey: params.sessionKey,
      message: buildAgentInstruction({ message: trimmed }),
      deliver: false,
      idempotencyKey: runId,
    });

    if (!createdSession) {
      params.dispatch({
        type: "updateAgent",
        agentId,
        patch: { sessionCreated: true },
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gateway error";
    params.dispatch({
      type: "updateAgent",
      agentId,
      patch: { status: "error", runId: null, streamText: null, thinkingTrace: null },
    });
    params.dispatch({
      type: "appendOutput",
      agentId,
      line: `Error: ${msg}`,
    });
  }
}
