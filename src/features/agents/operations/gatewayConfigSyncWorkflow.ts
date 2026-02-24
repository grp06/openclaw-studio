import { readConfigAgentList } from "@/lib/gateway/agentConfig";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";

export type GatewayConnectionStatus = "disconnected" | "connecting" | "connected";

type RecordLike = Record<string, unknown>;

const asRecord = (value: unknown): RecordLike | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RecordLike;
};

export const resolveGatewayConfigRecord = (
  snapshot: GatewayModelPolicySnapshot | null
): RecordLike | null => {
  return asRecord(snapshot?.config ?? null);
};

export const resolveSandboxRepairAgentIds = (
  snapshot: GatewayModelPolicySnapshot | null
): string[] => {
  const baseConfig = resolveGatewayConfigRecord(snapshot);
  if (!baseConfig) return [];

  const list = readConfigAgentList(baseConfig);
  return list
    .filter((entry) => {
      const sandbox = asRecord(entry.sandbox);
      const mode = typeof sandbox?.mode === "string" ? sandbox.mode.trim().toLowerCase() : "";
      if (mode !== "all") return false;

      const tools = asRecord(entry.tools);
      const sandboxBlock = asRecord(tools?.sandbox);
      const sandboxTools = asRecord(sandboxBlock?.tools);
      const allow = sandboxTools?.allow;
      return Array.isArray(allow) && allow.length === 0;
    })
    .map((entry) => entry.id);
};

export type SandboxRepairIntent =
  | { kind: "skip"; reason: "not-connected" | "already-attempted" | "no-eligible-agents" }
  | { kind: "repair"; agentIds: string[] };

export const resolveSandboxRepairIntent = (params: {
  status: GatewayConnectionStatus;
  attempted: boolean;
  snapshot: GatewayModelPolicySnapshot | null;
}): SandboxRepairIntent => {
  if (params.status !== "connected") {
    return { kind: "skip", reason: "not-connected" };
  }
  if (params.attempted) {
    return { kind: "skip", reason: "already-attempted" };
  }

  const agentIds = resolveSandboxRepairAgentIds(params.snapshot);
  if (agentIds.length === 0) {
    return { kind: "skip", reason: "no-eligible-agents" };
  }

  return { kind: "repair", agentIds };
};

export const shouldRefreshGatewayConfigForSettingsRoute = (params: {
  status: GatewayConnectionStatus;
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
}): boolean => {
  if (!params.settingsRouteActive) return false;
  if (!params.inspectSidebarAgentId) return false;
  if (params.status !== "connected") return false;
  return true;
};

export type GatewayModelsSyncIntent = { kind: "clear" } | { kind: "load" };

export const resolveGatewayModelsSyncIntent = (params: {
  status: GatewayConnectionStatus;
}): GatewayModelsSyncIntent => {
  if (params.status !== "connected") {
    return { kind: "clear" };
  }
  return { kind: "load" };
};
