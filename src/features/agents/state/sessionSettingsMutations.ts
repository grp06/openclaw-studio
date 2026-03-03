import {
  type GatewayClient,
} from "@/lib/gateway/GatewayClient";
import { isWebchatSessionMutationBlockedError } from "@/lib/gateway/gateway-disconnect";
import {
  syncGatewaySessionSettings,
  type GatewaySessionsPatchResult,
} from "@/lib/gateway/session-settings-sync";
import type { RuntimeWriteTransport } from "@/features/agents/operations/runtimeWriteTransport";

type SessionSettingField = "model" | "thinkingLevel";

type AgentSessionState = {
  agentId: string;
  sessionCreated: boolean;
  model?: string | null;
  thinkingLevel?: string | null;
};

type SessionSettingsDispatchAction =
  | {
      type: "updateAgent";
      agentId: string;
      patch: {
        model?: string | null;
        thinkingLevel?: string | null;
        sessionSettingsSynced?: boolean;
        sessionCreated?: boolean;
      };
    }
  | {
      type: "appendOutput";
      agentId: string;
      line: string;
    };

type SessionSettingsDispatch = (action: SessionSettingsDispatchAction) => void;

type ApplySessionSettingMutationParams = {
  agents: AgentSessionState[];
  dispatch: SessionSettingsDispatch;
  client: GatewayClient;
  runtimeWriteTransport?: RuntimeWriteTransport;
  agentId: string;
  sessionKey: string;
  field: SessionSettingField;
  value: string | null;
};

const buildFallbackError = (field: SessionSettingField) =>
  field === "model" ? "Failed to set model." : "Failed to set thinking level.";

const buildErrorPrefix = (field: SessionSettingField) =>
  field === "model" ? "Model update failed" : "Thinking update failed";

const buildWebchatBlockedMessage = (field: SessionSettingField) =>
  field === "model"
    ? "Model update not applied: this gateway blocks sessions.patch for WebChat clients; message sending still works."
    : "Thinking level update not applied: this gateway blocks sessions.patch for WebChat clients; message sending still works.";

export const applySessionSettingMutation = async ({
  agents,
  dispatch,
  client,
  runtimeWriteTransport,
  agentId,
  sessionKey,
  field,
  value,
}: ApplySessionSettingMutationParams) => {
  const targetAgent = agents.find((candidate) => candidate.agentId === agentId) ?? null;
  const previousModel = targetAgent?.model ?? null;
  const previousThinkingLevel = targetAgent?.thinkingLevel ?? null;
  dispatch({
    type: "updateAgent",
    agentId,
    patch: {
      [field]: value,
      sessionSettingsSynced: false,
    },
  });
  try {
    const result = (runtimeWriteTransport
      ? await runtimeWriteTransport.sessionSettingsSync({
          sessionKey,
          ...(field === "model" ? { model: value ?? null } : { thinkingLevel: value ?? null }),
        })
      : await syncGatewaySessionSettings({
          client,
          sessionKey,
          ...(field === "model" ? { model: value ?? null } : { thinkingLevel: value ?? null }),
        })) as GatewaySessionsPatchResult;
    const patch: {
      model?: string | null;
      thinkingLevel?: string | null;
      sessionSettingsSynced: boolean;
      sessionCreated: boolean;
    } = { sessionSettingsSynced: true, sessionCreated: true };
    if (field === "model") {
      const resolvedModel = resolveModelFromPatchResult(result);
      if (resolvedModel !== undefined) {
        patch.model = resolvedModel;
      }
    } else {
      const nextThinkingLevel =
        typeof result.entry?.thinkingLevel === "string" ? result.entry.thinkingLevel : undefined;
      if (nextThinkingLevel !== undefined) {
        patch.thinkingLevel = nextThinkingLevel;
      }
    }
    dispatch({
      type: "updateAgent",
      agentId,
      patch,
    });
  } catch (err) {
    if (isWebchatSessionMutationBlockedError(err)) {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          ...(field === "model"
            ? { model: previousModel }
            : { thinkingLevel: previousThinkingLevel }),
          sessionSettingsSynced: true,
          sessionCreated: true,
        },
      });
      dispatch({
        type: "appendOutput",
        agentId,
        line: buildWebchatBlockedMessage(field),
      });
      return;
    }
    const msg = err instanceof Error ? err.message : buildFallbackError(field);
    dispatch({
      type: "appendOutput",
      agentId,
      line: `${buildErrorPrefix(field)}: ${msg}`,
    });
  }
};

const resolveModelFromPatchResult = (result: GatewaySessionsPatchResult): string | null | undefined => {
  const provider =
    typeof result.resolved?.modelProvider === "string" ? result.resolved.modelProvider.trim() : "";
  const model = typeof result.resolved?.model === "string" ? result.resolved.model.trim() : "";
  if (!provider || !model) return undefined;
  return `${provider}/${model}`;
};
