import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { syncGatewaySessionSettings } from "@/lib/gateway/session-settings-sync";
import { readConfigAgentList, updateGatewayAgentOverrides } from "@/lib/gateway/agentConfig";
import {
  createRuntimeWriteTransport,
  type RuntimeWriteTransport,
} from "@/features/agents/operations/runtimeWriteTransport";

type ExecutionRoleId = "conservative" | "collaborative" | "autonomous";
type CommandModeId = "off" | "ask" | "auto";

export type AgentPermissionsDraft = {
  commandMode: CommandModeId;
  webAccess: boolean;
  fileTools: boolean;
};

type ToolGroupState = {
  runtime: boolean | null;
  web: boolean | null;
  fs: boolean | null;
  usesAllow: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const coerceStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const resolveExecutionRoleFromAgent = (agent: {
  sessionExecSecurity?: "deny" | "allowlist" | "full";
  sessionExecAsk?: "off" | "on-miss" | "always";
}): ExecutionRoleId => {
  if (agent.sessionExecSecurity === "full" && agent.sessionExecAsk === "off") {
    return "autonomous";
  }
  if (
    agent.sessionExecSecurity === "allowlist" ||
    agent.sessionExecAsk === "always" ||
    agent.sessionExecAsk === "on-miss"
  ) {
    return "collaborative";
  }
  return "conservative";
};

export const resolveRoleForCommandMode = (mode: CommandModeId): ExecutionRoleId => {
  if (mode === "auto") return "autonomous";
  if (mode === "ask") return "collaborative";
  return "conservative";
};

export const resolveCommandModeFromRole = (role: ExecutionRoleId): CommandModeId => {
  if (role === "autonomous") return "auto";
  if (role === "collaborative") return "ask";
  return "off";
};

export const resolvePresetDefaultsForRole = (role: ExecutionRoleId): AgentPermissionsDraft => {
  const commandMode = resolveCommandModeFromRole(role);
  if (role === "conservative") {
    return {
      commandMode,
      webAccess: false,
      fileTools: false,
    };
  }
  return {
    commandMode,
    webAccess: true,
    fileTools: true,
  };
};

export const isPermissionsCustom = (params: {
  role: ExecutionRoleId;
  draft: AgentPermissionsDraft;
}): boolean => {
  const defaults = resolvePresetDefaultsForRole(params.role);
  return (
    defaults.commandMode !== params.draft.commandMode ||
    defaults.webAccess !== params.draft.webAccess ||
    defaults.fileTools !== params.draft.fileTools
  );
};

const resolveGroupState = (params: {
  group: "group:runtime" | "group:web" | "group:fs";
  allowed: Set<string>;
  denied: Set<string>;
}): boolean | null => {
  if (params.denied.has(params.group)) return false;
  if (params.allowed.has(params.group)) return true;
  return null;
};

export const resolveToolGroupStateFromConfigEntry = (existingTools: unknown): ToolGroupState => {
  const tools = isRecord(existingTools) ? existingTools : null;
  const existingAllow = coerceStringArray(tools?.allow);
  const existingAlsoAllow = coerceStringArray(tools?.alsoAllow);
  const existingDeny = coerceStringArray(tools?.deny) ?? [];
  const usesAllow = existingAllow !== null;
  const allowed = new Set(usesAllow ? existingAllow : existingAlsoAllow ?? []);
  const denied = new Set(existingDeny);

  return {
    runtime: resolveGroupState({ group: "group:runtime", allowed, denied }),
    web: resolveGroupState({ group: "group:web", allowed, denied }),
    fs: resolveGroupState({ group: "group:fs", allowed, denied }),
    usesAllow,
  };
};

export const resolveAgentPermissionsDraft = (params: {
  agent: {
    sessionExecSecurity?: "deny" | "allowlist" | "full";
    sessionExecAsk?: "off" | "on-miss" | "always";
  };
  existingTools: unknown;
}): AgentPermissionsDraft => {
  const role = resolveExecutionRoleFromAgent(params.agent);
  const defaults = resolvePresetDefaultsForRole(role);
  const groupState = resolveToolGroupStateFromConfigEntry(params.existingTools);

  return {
    commandMode: defaults.commandMode,
    webAccess: groupState.web ?? defaults.webAccess,
    fileTools: groupState.fs ?? defaults.fileTools,
  };
};

export function resolveToolGroupOverrides(params: {
  existingTools: unknown;
  runtimeEnabled: boolean;
  webEnabled: boolean;
  fsEnabled: boolean;
}): { tools: { allow?: string[]; alsoAllow?: string[]; deny?: string[] } } {
  const tools = isRecord(params.existingTools) ? params.existingTools : null;

  const existingAllow = coerceStringArray(tools?.allow);
  const existingAlsoAllow = coerceStringArray(tools?.alsoAllow);
  const existingDeny = coerceStringArray(tools?.deny) ?? [];

  const usesAllow = existingAllow !== null;
  const allowed = new Set(usesAllow ? existingAllow : existingAlsoAllow ?? []);
  const denied = new Set(existingDeny);

  const applyGroup = (group: "group:runtime" | "group:web" | "group:fs", enabled: boolean) => {
    if (enabled) {
      allowed.add(group);
      denied.delete(group);
      return;
    }
    allowed.delete(group);
    denied.add(group);
  };

  applyGroup("group:runtime", params.runtimeEnabled);
  applyGroup("group:web", params.webEnabled);
  applyGroup("group:fs", params.fsEnabled);

  const allowedList = Array.from(allowed);
  const denyList = Array.from(denied).filter((entry) => !allowed.has(entry));

  return {
    tools: usesAllow
      ? { allow: allowedList, deny: denyList }
      : { alsoAllow: allowedList, deny: denyList },
  };
}

export function resolveSessionExecSettingsForRole(params: {
  role: ExecutionRoleId;
  sandboxMode: string;
}): {
  execHost: "sandbox" | "gateway" | null;
  execSecurity: "deny" | "allowlist" | "full";
  execAsk: "off" | "always";
} {
  if (params.role === "conservative") {
    return { execHost: null, execSecurity: "deny", execAsk: "off" };
  }

  const normalizedMode = params.sandboxMode.trim().toLowerCase();
  const execHost = normalizedMode === "all" ? "sandbox" : "gateway";
  if (params.role === "autonomous") {
    return { execHost, execSecurity: "full", execAsk: "off" };
  }
  return { execHost, execSecurity: "allowlist", execAsk: "always" };
}

type AgentRuntimeConfigContext = {
  sandboxMode: string;
  tools: Record<string, unknown> | null;
};

const resolveAgentRuntimeConfigContext = async (params: {
  client: GatewayClient;
  agentId: string;
}): Promise<AgentRuntimeConfigContext> => {
  const snapshot = await params.client.call<{ config?: unknown }>("config.get", {});
  const baseConfig =
    snapshot.config && typeof snapshot.config === "object" && !Array.isArray(snapshot.config)
      ? (snapshot.config as Record<string, unknown>)
      : undefined;

  const list = readConfigAgentList(baseConfig);
  const configEntry = list.find((entry) => entry.id === params.agentId) ?? null;

  const sandboxRaw =
    configEntry && typeof (configEntry as Record<string, unknown>).sandbox === "object"
      ? ((configEntry as Record<string, unknown>).sandbox as unknown)
      : null;
  const sandbox =
    sandboxRaw && typeof sandboxRaw === "object" && !Array.isArray(sandboxRaw)
      ? (sandboxRaw as Record<string, unknown>)
      : null;
  const sandboxMode = typeof sandbox?.mode === "string" ? sandbox.mode.trim().toLowerCase() : "";

  const toolsRaw =
    configEntry && typeof (configEntry as Record<string, unknown>).tools === "object"
      ? ((configEntry as Record<string, unknown>).tools as unknown)
      : null;
  const tools =
    toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)
      ? (toolsRaw as Record<string, unknown>)
      : null;

  return {
    sandboxMode,
    tools,
  };
};

const upsertExecApprovalsPolicyForRole = async (params: {
  agentId: string;
  role: ExecutionRoleId;
  runtimeWriteTransport: RuntimeWriteTransport;
}) => {
  await params.runtimeWriteTransport.execApprovalsSet({
    agentId: params.agentId,
    role: params.role,
  });
};

export async function updateAgentPermissionsViaStudio(params: {
  client: GatewayClient;
  runtimeWriteTransport?: RuntimeWriteTransport;
  agentId: string;
  sessionKey: string;
  draft: AgentPermissionsDraft;
  loadAgents?: () => Promise<void>;
}): Promise<void> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    throw new Error("Agent id is required.");
  }
  const runtimeWriteTransport =
    params.runtimeWriteTransport ??
    createRuntimeWriteTransport({
      client: params.client,
      useDomainIntents: false,
    });

  if (runtimeWriteTransport.useDomainIntents === true) {
    await runtimeWriteTransport.agentPermissionsUpdate({
      agentId,
      sessionKey: params.sessionKey,
      commandMode: params.draft.commandMode,
      webAccess: params.draft.webAccess,
      fileTools: params.draft.fileTools,
    });
    if (params.loadAgents) {
      await params.loadAgents();
    }
    return;
  }

  const role = resolveRoleForCommandMode(params.draft.commandMode);
  const runtimeConfigContext = await resolveAgentRuntimeConfigContext({
    client: params.client,
    agentId,
  });

  const toolOverrides = resolveToolGroupOverrides({
    existingTools: runtimeConfigContext.tools,
    runtimeEnabled: role !== "conservative",
    webEnabled: params.draft.webAccess,
    fsEnabled: params.draft.fileTools,
  });

  await updateGatewayAgentOverrides({
    client: params.client,
    agentId,
    overrides: toolOverrides,
  });

  const execSettings = resolveSessionExecSettingsForRole({
    role,
    sandboxMode: runtimeConfigContext.sandboxMode,
  });
  await syncGatewaySessionSettings({
    client: params.client,
    sessionKey: params.sessionKey,
    execHost: execSettings.execHost,
    execSecurity: execSettings.execSecurity,
    execAsk: execSettings.execAsk,
  });
  await upsertExecApprovalsPolicyForRole({
    agentId,
    role,
    runtimeWriteTransport,
  });

  if (params.loadAgents) {
    await params.loadAgents();
  }
}
