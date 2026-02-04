export type StudioGatewaySettings = {
  url: string;
  token: string;
};

export type FocusFilter = "all" | "needs-attention" | "running" | "idle";
export type StudioViewMode = "focused";

export type StudioFocusedPreference = {
  mode: StudioViewMode;
  selectedAgentId: string | null;
  filter: FocusFilter;
};

export type StudioSettings = {
  version: 1;
  gateway: StudioGatewaySettings | null;
  focused: Record<string, StudioFocusedPreference>;
  sessions: Record<string, string>;
};

export type StudioSettingsPatch = {
  gateway?: StudioGatewaySettings | null;
  focused?: Record<string, Partial<StudioFocusedPreference> | null>;
  sessions?: Record<string, string | null>;
};

const SETTINGS_VERSION = 1 as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const coerceString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeGatewayKey = (value: unknown) => {
  const key = coerceString(value);
  return key ? key : null;
};

const normalizeFocusFilter = (
  value: unknown,
  fallback: FocusFilter = "all"
): FocusFilter => {
  const filter = coerceString(value);
  if (
    filter === "all" ||
    filter === "needs-attention" ||
    filter === "running" ||
    filter === "idle"
  ) {
    return filter;
  }
  return fallback;
};

const normalizeViewMode = (
  value: unknown,
  fallback: StudioViewMode = "focused"
): StudioViewMode => {
  const mode = coerceString(value);
  if (mode === "focused") {
    return mode;
  }
  return fallback;
};

const normalizeSelectedAgentId = (value: unknown, fallback: string | null = null) => {
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const defaultFocusedPreference = (): StudioFocusedPreference => ({
  mode: "focused",
  selectedAgentId: null,
  filter: "all",
});

const normalizeFocusedPreference = (
  value: unknown,
  fallback: StudioFocusedPreference = defaultFocusedPreference()
): StudioFocusedPreference => {
  if (!isRecord(value)) return fallback;
  return {
    mode: normalizeViewMode(value.mode, fallback.mode),
    selectedAgentId: normalizeSelectedAgentId(
      value.selectedAgentId,
      fallback.selectedAgentId
    ),
    filter: normalizeFocusFilter(value.filter, fallback.filter),
  };
};

const normalizeGatewaySettings = (value: unknown): StudioGatewaySettings | null => {
  if (!isRecord(value)) return null;
  const url = coerceString(value.url);
  if (!url) return null;
  const token = coerceString(value.token);
  return { url, token };
};

const normalizeFocused = (value: unknown): Record<string, StudioFocusedPreference> => {
  if (!isRecord(value)) return {};
  const focused: Record<string, StudioFocusedPreference> = {};
  for (const [gatewayKeyRaw, focusedRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    focused[gatewayKey] = normalizeFocusedPreference(focusedRaw);
  }
  return focused;
};

const normalizeSessions = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const sessions: Record<string, string> = {};
  for (const [gatewayKeyRaw, sessionIdRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    const sessionId = coerceString(sessionIdRaw);
    if (!sessionId) continue;
    sessions[gatewayKey] = sessionId;
  }
  return sessions;
};

export const defaultStudioSettings = (): StudioSettings => ({
  version: SETTINGS_VERSION,
  gateway: null,
  focused: {},
  sessions: {},
});

export const normalizeStudioSettings = (raw: unknown): StudioSettings => {
  if (!isRecord(raw)) return defaultStudioSettings();
  const gateway = normalizeGatewaySettings(raw.gateway);
  const focused = normalizeFocused(raw.focused);
  const sessions = normalizeSessions(raw.sessions);
  return {
    version: SETTINGS_VERSION,
    gateway,
    focused,
    sessions,
  };
};

export const mergeStudioSettings = (
  current: StudioSettings,
  patch: StudioSettingsPatch
): StudioSettings => {
  const nextGateway =
    patch.gateway === undefined ? current.gateway : normalizeGatewaySettings(patch.gateway);
  const nextFocused = { ...current.focused };
  const nextSessions = { ...current.sessions };
  if (patch.focused) {
    for (const [keyRaw, value] of Object.entries(patch.focused)) {
      const key = normalizeGatewayKey(keyRaw);
      if (!key) continue;
      if (value === null) {
        delete nextFocused[key];
        continue;
      }
      const fallback = nextFocused[key] ?? defaultFocusedPreference();
      nextFocused[key] = normalizeFocusedPreference(value, fallback);
    }
  }
  if (patch.sessions) {
    for (const [keyRaw, value] of Object.entries(patch.sessions)) {
      const key = normalizeGatewayKey(keyRaw);
      if (!key) continue;
      if (value === null) {
        delete nextSessions[key];
        continue;
      }
      const sessionId = coerceString(value);
      if (!sessionId) continue;
      nextSessions[key] = sessionId;
    }
  }
  return {
    version: SETTINGS_VERSION,
    gateway: nextGateway ?? null,
    focused: nextFocused,
    sessions: nextSessions,
  };
};

export const resolveFocusedPreference = (
  settings: StudioSettings,
  gatewayUrl: string
): StudioFocusedPreference | null => {
  const key = normalizeGatewayKey(gatewayUrl);
  if (!key) return null;
  return settings.focused[key] ?? null;
};

export const resolveStudioSessionId = (
  settings: StudioSettings,
  gatewayUrl: string
): string | null => {
  const key = normalizeGatewayKey(gatewayUrl);
  if (!key) return null;
  return settings.sessions[key] ?? null;
};
