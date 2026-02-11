import { GatewayResponseError, type GatewayClient } from "@/lib/gateway/GatewayClient";

export type AgentHeartbeatActiveHours = {
  start: string;
  end: string;
};

export type AgentHeartbeat = {
  every: string;
  target: string;
  includeReasoning: boolean;
  ackMaxChars?: number | null;
  activeHours?: AgentHeartbeatActiveHours | null;
};

export type AgentHeartbeatResult = {
  heartbeat: AgentHeartbeat;
  hasOverride: boolean;
};

export type AgentHeartbeatUpdatePayload = {
  override: boolean;
  heartbeat: AgentHeartbeat;
};

export type AgentHeartbeatSummary = {
  id: string;
  agentId: string;
  source: "override" | "default";
  enabled: boolean;
  heartbeat: AgentHeartbeat;
};

export type HeartbeatListResult = {
  heartbeats: AgentHeartbeatSummary[];
};

export type HeartbeatWakeResult = { ok: true } | { ok: false };

export type GatewayConfigSnapshot = {
  config?: Record<string, unknown>;
  hash?: string;
  exists?: boolean;
};

type HeartbeatBlock = Record<string, unknown> | null | undefined;

const DEFAULT_EVERY = "30m";
const DEFAULT_TARGET = "last";
const DEFAULT_ACK_MAX_CHARS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export type ConfigAgentEntry = Record<string, unknown> & { id: string };

export const readConfigAgentList = (
  config: Record<string, unknown> | undefined
): ConfigAgentEntry[] => {
  if (!config) return [];
  const agents = isRecord(config.agents) ? config.agents : null;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  return list.filter((entry): entry is ConfigAgentEntry => {
    if (!isRecord(entry)) return false;
    if (typeof entry.id !== "string") return false;
    return entry.id.trim().length > 0;
  });
};

export const writeConfigAgentList = (
  config: Record<string, unknown>,
  list: ConfigAgentEntry[]
): Record<string, unknown> => {
  const agents = isRecord(config.agents) ? { ...config.agents } : {};
  return { ...config, agents: { ...agents, list } };
};

export const upsertConfigAgentEntry = (
  list: ConfigAgentEntry[],
  agentId: string,
  updater: (entry: ConfigAgentEntry) => ConfigAgentEntry
): { list: ConfigAgentEntry[]; entry: ConfigAgentEntry } => {
  let updatedEntry: ConfigAgentEntry | null = null;
  const nextList = list.map((entry) => {
    if (entry.id !== agentId) return entry;
    const next = updater({ ...entry, id: agentId });
    updatedEntry = next;
    return next;
  });
  if (!updatedEntry) {
    updatedEntry = updater({ id: agentId });
    nextList.push(updatedEntry);
  }
  return { list: nextList, entry: updatedEntry };
};

const slugifyName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error("Name produced an empty folder name.");
  }
  return slug;
};

const coerceString = (value: unknown) => (typeof value === "string" ? value : undefined);
const coerceBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;
const coerceNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const coerceActiveHours = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const start = coerceString(value.start);
  const end = coerceString(value.end);
  if (!start || !end) return undefined;
  return { start, end };
};

const mergeHeartbeat = (defaults: HeartbeatBlock, override: HeartbeatBlock) => {
  const merged = {
    ...(defaults ?? {}),
    ...(override ?? {}),
  } as Record<string, unknown>;
  if (override && typeof override === "object" && "activeHours" in override) {
    merged.activeHours = (override as Record<string, unknown>).activeHours;
  } else if (defaults && typeof defaults === "object" && "activeHours" in defaults) {
    merged.activeHours = (defaults as Record<string, unknown>).activeHours;
  }
  return merged;
};

const normalizeHeartbeat = (
  defaults: HeartbeatBlock,
  override: HeartbeatBlock
): AgentHeartbeatResult => {
  const resolved = mergeHeartbeat(defaults, override);
  const every = coerceString(resolved.every) ?? DEFAULT_EVERY;
  const target = coerceString(resolved.target) ?? DEFAULT_TARGET;
  const includeReasoning = coerceBoolean(resolved.includeReasoning) ?? false;
  const ackMaxChars = coerceNumber(resolved.ackMaxChars) ?? DEFAULT_ACK_MAX_CHARS;
  const activeHours = coerceActiveHours(resolved.activeHours) ?? null;
  return {
    heartbeat: {
      every,
      target,
      includeReasoning,
      ackMaxChars,
      activeHours,
    },
    hasOverride: Boolean(override && typeof override === "object"),
  };
};

const readHeartbeatDefaults = (config: Record<string, unknown>): HeartbeatBlock => {
  const agents = isRecord(config.agents) ? config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  return (defaults?.heartbeat ?? null) as HeartbeatBlock;
};

const buildHeartbeatOverride = (payload: AgentHeartbeat): Record<string, unknown> => {
  const nextHeartbeat: Record<string, unknown> = {
    every: payload.every,
    target: payload.target,
    includeReasoning: payload.includeReasoning,
  };
  if (payload.ackMaxChars !== undefined && payload.ackMaxChars !== null) {
    nextHeartbeat.ackMaxChars = payload.ackMaxChars;
  }
  if (payload.activeHours) {
    nextHeartbeat.activeHours = {
      start: payload.activeHours.start,
      end: payload.activeHours.end,
    };
  }
  return nextHeartbeat;
};

export const resolveHeartbeatSettings = (
  config: Record<string, unknown>,
  agentId: string
): AgentHeartbeatResult => {
  const list = readConfigAgentList(config);
  const entry = list.find((item) => item.id === agentId) ?? null;
  const defaults = readHeartbeatDefaults(config);
  const override =
    entry && typeof entry === "object"
      ? ((entry as Record<string, unknown>).heartbeat as HeartbeatBlock)
      : null;
  return normalizeHeartbeat(defaults, override);
};

type GatewayStatusHeartbeatAgent = {
  agentId?: string;
  enabled?: boolean;
  every?: string;
  everyMs?: number | null;
};

type GatewayStatusSnapshot = {
  heartbeat?: {
    agents?: GatewayStatusHeartbeatAgent[];
  };
};

const resolveHeartbeatAgentId = (agentId: string) => {
  const trimmed = agentId.trim();
  if (!trimmed) {
    throw new Error("Agent id is required.");
  }
  return trimmed;
};

const resolveStatusHeartbeatAgent = (
  status: GatewayStatusSnapshot,
  agentId: string
): GatewayStatusHeartbeatAgent | null => {
  const list = Array.isArray(status.heartbeat?.agents) ? status.heartbeat?.agents : [];
  for (const entry of list) {
    if (!entry || typeof entry.agentId !== "string") continue;
    if (entry.agentId.trim() !== agentId) continue;
    return entry;
  }
  return null;
};

export const listHeartbeatsForAgent = async (
  client: GatewayClient,
  agentId: string
): Promise<HeartbeatListResult> => {
  const resolvedAgentId = resolveHeartbeatAgentId(agentId);
  const [snapshot, status] = await Promise.all([
    client.call<GatewayConfigSnapshot>("config.get", {}),
    client.call<GatewayStatusSnapshot>("status", {}),
  ]);
  const config = isRecord(snapshot.config) ? snapshot.config : {};
  const resolved = resolveHeartbeatSettings(config, resolvedAgentId);
  const statusHeartbeat = resolveStatusHeartbeatAgent(status, resolvedAgentId);
  const enabled = Boolean(statusHeartbeat?.enabled);
  const every = typeof statusHeartbeat?.every === "string" ? statusHeartbeat.every.trim() : "";
  const heartbeat = every ? { ...resolved.heartbeat, every } : resolved.heartbeat;
  if (!enabled && !resolved.hasOverride) {
    return { heartbeats: [] };
  }
  return {
    heartbeats: [
      {
        id: resolvedAgentId,
        agentId: resolvedAgentId,
        source: resolved.hasOverride ? "override" : "default",
        enabled,
        heartbeat,
      },
    ],
  };
};

export const triggerHeartbeatNow = async (
  client: GatewayClient,
  agentId: string
): Promise<HeartbeatWakeResult> => {
  const resolvedAgentId = resolveHeartbeatAgentId(agentId);
  return client.call<HeartbeatWakeResult>("wake", {
    mode: "now",
    text: `OpenClaw Studio heartbeat trigger (${resolvedAgentId}).`,
  });
};

const shouldRetryConfigPatch = (err: unknown) => {
  if (!(err instanceof GatewayResponseError)) return false;
  return /re-run config\.get|config changed since last load/i.test(err.message);
};

const applyGatewayConfigPatch = async (params: {
  client: GatewayClient;
  patch: Record<string, unknown>;
  baseHash?: string | null;
  exists?: boolean;
  sessionKey?: string;
  attempt?: number;
}): Promise<void> => {
  const attempt = params.attempt ?? 0;
  const requiresBaseHash = params.exists !== false;
  const baseHash = requiresBaseHash ? params.baseHash?.trim() : undefined;
  if (requiresBaseHash && !baseHash) {
    throw new Error("Gateway config hash unavailable; re-run config.get.");
  }
  const payload: Record<string, unknown> = {
    raw: JSON.stringify(params.patch, null, 2),
  };
  if (baseHash) payload.baseHash = baseHash;
  try {
    await params.client.call("config.patch", payload);
  } catch (err) {
    if (attempt < 1 && shouldRetryConfigPatch(err)) {
      const snapshot = await params.client.call<GatewayConfigSnapshot>("config.get", {});
      return applyGatewayConfigPatch({
        ...params,
        baseHash: snapshot.hash ?? undefined,
        exists: snapshot.exists,
        attempt: attempt + 1,
      });
    }
    throw err;
  }
};

type GatewayConfigMutationResult<T> =
  | {
      shouldPatch: true;
      patch: Record<string, unknown>;
      result: T;
    }
  | {
      shouldPatch: false;
      result: T;
    };

const withGatewayConfigMutation = async <T>(params: {
  client: GatewayClient;
  sessionKey?: string;
  mutate: (input: {
    snapshot: GatewayConfigSnapshot;
    baseConfig: Record<string, unknown>;
    list: ConfigAgentEntry[];
  }) => GatewayConfigMutationResult<T>;
}): Promise<T> => {
  const snapshot = await params.client.call<GatewayConfigSnapshot>("config.get", {});
  const baseConfig = isRecord(snapshot.config) ? snapshot.config : {};
  const list = readConfigAgentList(baseConfig);
  const mutation = params.mutate({ snapshot, baseConfig, list });
  if (mutation.shouldPatch) {
    await applyGatewayConfigPatch({
      client: params.client,
      patch: mutation.patch,
      baseHash: snapshot.hash ?? undefined,
      exists: snapshot.exists,
      sessionKey: params.sessionKey,
    });
  }
  return mutation.result;
};

export const renameGatewayAgent = async (params: {
  client: GatewayClient;
  agentId: string;
  name: string;
  sessionKey?: string;
}) => {
  const trimmed = params.name.trim();
  if (!trimmed) {
    throw new Error("Agent name is required.");
  }
  return withGatewayConfigMutation({
    client: params.client,
    sessionKey: params.sessionKey,
    mutate: ({ list }) => {
      const { list: nextList, entry } = upsertConfigAgentEntry(
        list,
        params.agentId,
        (entry: ConfigAgentEntry) => ({
          ...entry,
          name: trimmed,
        })
      );
      return {
        shouldPatch: true,
        patch: { agents: { list: nextList } },
        result: entry,
      };
    },
  });
};

const createUniqueAgentId = (name: string, list: ConfigAgentEntry[]) => {
  const base = slugifyName(name);
  const existing = new Set(list.map((entry) => entry.id));
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique agent ID.");
};

export const createGatewayAgent = async (params: {
  client: GatewayClient;
  name: string;
  sessionKey?: string;
}): Promise<ConfigAgentEntry> => {
  const trimmed = params.name.trim();
  if (!trimmed) {
    throw new Error("Agent name is required.");
  }
  return withGatewayConfigMutation({
    client: params.client,
    sessionKey: params.sessionKey,
    mutate: ({ list }) => {
      const id = createUniqueAgentId(trimmed, list);
      const entry: ConfigAgentEntry = { id, name: trimmed };
      const nextList = [...list, entry];
      return {
        shouldPatch: true,
        patch: { agents: { list: nextList } },
        result: entry,
      };
    },
  });
};

export const deleteGatewayAgent = async (params: {
  client: GatewayClient;
  agentId: string;
  sessionKey?: string;
}) => {
  return withGatewayConfigMutation({
    client: params.client,
    sessionKey: params.sessionKey,
    mutate: ({ baseConfig, list }) => {
      const nextList = list.filter((entry) => entry.id !== params.agentId);
      const bindings = Array.isArray(baseConfig.bindings) ? baseConfig.bindings : [];
      const nextBindings = bindings.filter((binding) => {
        if (!binding || typeof binding !== "object") return true;
        const agentId = (binding as Record<string, unknown>).agentId;
        return agentId !== params.agentId;
      });
      const patch: Record<string, unknown> = {};
      if (nextList.length !== list.length) {
        patch.agents = { list: nextList };
      }
      if (nextBindings.length !== bindings.length) {
        patch.bindings = nextBindings;
      }
      const shouldPatch = Object.keys(patch).length > 0;
      if (!shouldPatch) {
        return {
          shouldPatch: false,
          result: {
            removed: false,
            removedBindings: 0,
          },
        };
      }
      return {
        shouldPatch: true,
        patch,
        result: {
          removed: nextList.length !== list.length,
          removedBindings: bindings.length - nextBindings.length,
        },
      };
    },
  });
};

export const updateGatewayHeartbeat = async (params: {
  client: GatewayClient;
  agentId: string;
  payload: AgentHeartbeatUpdatePayload;
  sessionKey?: string;
}): Promise<AgentHeartbeatResult> => {
  return withGatewayConfigMutation({
    client: params.client,
    sessionKey: params.sessionKey,
    mutate: ({ baseConfig, list }) => {
      const { list: nextList } = upsertConfigAgentEntry(
        list,
        params.agentId,
        (entry: ConfigAgentEntry) => {
          const next = { ...entry };
          if (params.payload.override) {
            next.heartbeat = buildHeartbeatOverride(params.payload.heartbeat);
          } else if ("heartbeat" in next) {
            delete next.heartbeat;
          }
          return next;
        }
      );
      const nextConfig = writeConfigAgentList(baseConfig, nextList);
      return {
        shouldPatch: true,
        patch: { agents: { list: nextList } },
        result: resolveHeartbeatSettings(nextConfig, params.agentId),
      };
    },
  });
};

export const removeGatewayHeartbeatOverride = async (params: {
  client: GatewayClient;
  agentId: string;
  sessionKey?: string;
}): Promise<AgentHeartbeatResult> => {
  return withGatewayConfigMutation({
    client: params.client,
    sessionKey: params.sessionKey,
    mutate: ({ baseConfig, list }) => {
      const nextList = list.map((entry) => {
        if (entry.id !== params.agentId) return entry;
        if (!("heartbeat" in entry)) return entry;
        const next = { ...entry };
        delete next.heartbeat;
        return next;
      });
      const changed = nextList.some((entry, index) => entry !== list[index]);
      if (!changed) {
        return {
          shouldPatch: false,
          result: resolveHeartbeatSettings(baseConfig, params.agentId),
        };
      }
      return {
        shouldPatch: true,
        patch: { agents: { list: nextList } },
        result: resolveHeartbeatSettings(writeConfigAgentList(baseConfig, nextList), params.agentId),
      };
    },
  });
};
