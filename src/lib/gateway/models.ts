export type GatewayModelChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

type GatewayModelAliasEntry = {
  alias?: string;
};

type GatewayModelDefaults = {
  model?: string | { primary?: string; fallbacks?: string[] };
  models?: Record<string, GatewayModelAliasEntry>;
};

export type GatewayModelPolicySnapshot = {
  config?: {
    agents?: {
      defaults?: GatewayModelDefaults;
      list?: Array<{
        id?: string;
        model?: string | { primary?: string; fallbacks?: string[] };
      }>;
    };
  };
};

export const resolveConfiguredModelKey = (
  raw: string,
  models?: Record<string, GatewayModelAliasEntry>
) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) return trimmed;
  if (models) {
    const target = Object.entries(models).find(
      ([, entry]) => entry?.alias?.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (target?.[0]) return target[0];
  }
  return `anthropic/${trimmed}`;
};

export const buildAllowedModelKeys = (snapshot: GatewayModelPolicySnapshot | null) => {
  const allowedList: string[] = [];
  const allowedSet = new Set<string>();
  const defaults = snapshot?.config?.agents?.defaults;
  const modelDefaults = defaults?.model;
  const modelAliases = defaults?.models;
  const pushKey = (raw?: string | null) => {
    if (!raw) return;
    const resolved = resolveConfiguredModelKey(raw, modelAliases);
    if (!resolved) return;
    if (allowedSet.has(resolved)) return;
    allowedSet.add(resolved);
    allowedList.push(resolved);
  };
  if (typeof modelDefaults === "string") {
    pushKey(modelDefaults);
  } else if (modelDefaults && typeof modelDefaults === "object") {
    pushKey(modelDefaults.primary ?? null);
    for (const fallback of modelDefaults.fallbacks ?? []) {
      pushKey(fallback);
    }
  }
  if (modelAliases) {
    for (const key of Object.keys(modelAliases)) {
      pushKey(key);
    }
  }
  return allowedList;
};

// Only curate known text IDs advertised by the connected gateway. Never synthesize
// routes or replace its metadata, explicit allowlist, or saved session selection.
const minimaxTextId = (entry: GatewayModelChoice): string | null => {
  const provider = entry.provider.toLowerCase();
  const id = entry.id.toLowerCase();
  if (["minimax", "minimax-cn", "minimax-portal", "minimax-portal-cn"].includes(provider)) {
    return id;
  }
  if (provider === "openrouter" && id.startsWith("minimax/")) {
    return id.slice("minimax/".length);
  }
  if (provider === "opencode" && id.startsWith("minimax-")) return id;
  return null;
};

const currentMinimaxRank = (entry: GatewayModelChoice): number | null => {
  const id = minimaxTextId(entry);
  if (id === "minimax-m3") return 1;
  const flashId = entry.provider.toLowerCase() === "openrouter"
    ? "minimax-m3.1-flash:free"
    : entry.provider.toLowerCase() === "opencode"
      ? "minimax-m3.1-flash-free"
      : "minimax-m3.1-flash";
  return id === flashId ? 0 : null;
};

const curateUnconfiguredCatalog = (catalog: GatewayModelChoice[]) => {
  const filtered = catalog.filter((entry) => {
    const id = minimaxTextId(entry);
    return id === null || !/^minimax-(?:text-01|m1(?:-40k|-80k)?|m2(?:\.1|\.5|\.7)?(?:-highspeed|-lightning)?)(?::free|-free)?$/.test(id);
  });
  const current = filtered
    .filter((entry) => currentMinimaxRank(entry) !== null)
    .sort((a, b) => currentMinimaxRank(a)! - currentMinimaxRank(b)!);
  let index = 0;
  return filtered.map((entry) => currentMinimaxRank(entry) === null ? entry : current[index++]);
};

export const buildGatewayModelChoices = (
  catalog: GatewayModelChoice[],
  snapshot: GatewayModelPolicySnapshot | null
) => {
  const allowedKeys = buildAllowedModelKeys(snapshot);
  if (allowedKeys.length === 0) return curateUnconfiguredCatalog(catalog);
  const filtered = catalog.filter((entry) => allowedKeys.includes(`${entry.provider}/${entry.id}`));
  const filteredKeys = new Set(filtered.map((entry) => `${entry.provider}/${entry.id}`));
  const extras: GatewayModelChoice[] = [];
  for (const key of allowedKeys) {
    if (filteredKeys.has(key)) continue;
    const separator = key.indexOf("/");
    const provider = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!provider || !id) continue;
    extras.push({ provider, id, name: key });
  }
  return [...filtered, ...extras];
};
