"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import { AgentInspectPanel } from "@/features/agents/components/AgentInspectPanel";
import { FleetSidebar } from "@/features/agents/components/FleetSidebar";
import { HeaderBar } from "@/features/agents/components/HeaderBar";
import { ConnectionPanel } from "@/features/agents/components/ConnectionPanel";
import {
  extractText,
  extractThinking,
  extractThinkingFromTaggedStream,
  formatThinkingMarkdown,
  isTraceMarkdown,
  extractToolLines,
  formatToolCallMarkdown,
} from "@/lib/text/message-extract";
import {
  buildAgentInstruction,
  isHeartbeatPrompt,
  isUiMetadataPrefix,
  stripUiMetadata,
} from "@/lib/text/message-metadata";
import { useGatewayConnection } from "@/lib/gateway/useGatewayConnection";
import type { EventFrame } from "@/lib/gateway/frames";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import {
  AgentStoreProvider,
  getFilteredAgents,
  getSelectedAgent,
  type FocusFilter,
  useAgentStore,
} from "@/features/agents/state/store";
import {
  type AgentEventPayload,
  type ChatEventPayload,
  getAgentSummaryPatch,
  getChatSummaryPatch,
} from "@/features/agents/state/summary";
import { fetchCronJobs } from "@/lib/cron/client";
import { createRandomAgentName, normalizeAgentName } from "@/lib/names/agentNames";
import type { AgentStoreSeed, AgentState } from "@/features/agents/state/store";
import type { CronJobSummary } from "@/lib/cron/types";
import { logger } from "@/lib/logger";
import { renameGatewayAgent, deleteGatewayAgent } from "@/lib/gateway/agentConfig";
import {
  parseAgentIdFromSessionKey,
  buildAgentStudioSessionKey,
  isSameSessionKey,
} from "@/lib/gateway/sessionKeys";
import { buildAvatarDataUrl } from "@/lib/avatars/multiavatar";
import { fetchStudioSettings, updateStudioSettings } from "@/lib/studio/client";
import { resolveFocusedPreference, resolveStudioSessionId } from "@/lib/studio/settings";
import { generateUUID } from "@/lib/gateway/openclaw/uuid";

type ChatHistoryMessage = Record<string, unknown>;

type ChatHistoryResult = {
  sessionKey: string;
  sessionId?: string;
  messages: ChatHistoryMessage[];
  thinkingLevel?: string;
};

type GatewayConfigSnapshot = {
  config?: {
    agents?: {
      defaults?: {
        model?: string | { primary?: string; fallbacks?: string[] };
        models?: Record<string, { alias?: string }>;
      };
    };
  };
};

type AgentsListResult = {
  defaultId: string;
  mainKey: string;
  scope?: string;
  agents: Array<{
    id: string;
    name?: string;
    identity?: {
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string;
    };
  }>;
};

type SessionPreviewItem = {
  role: "user" | "assistant" | "tool" | "system" | "other";
  text: string;
};

type SessionsPreviewEntry = {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionPreviewItem[];
};

type SessionsPreviewResult = {
  ts: number;
  previews: SessionsPreviewEntry[];
};

type SessionsListEntry = {
  key: string;
  updatedAt?: number | null;
  displayName?: string;
  origin?: { label?: string | null; provider?: string | null } | null;
};

type SessionsListResult = {
  sessions?: SessionsListEntry[];
};

type SessionStatusSummary = {
  key: string;
  updatedAt: number | null;
};

type StatusSummary = {
  sessions?: {
    recent?: SessionStatusSummary[];
    byAgent?: Array<{ agentId: string; recent: SessionStatusSummary[] }>;
  };
};

const SPECIAL_UPDATE_HEARTBEAT_RE = /\bheartbeat\b/i;
const SPECIAL_UPDATE_CRON_RE = /\bcron\b/i;

const resolveSpecialUpdateKind = (message: string) => {
  const lowered = message.toLowerCase();
  const heartbeatIndex = lowered.search(SPECIAL_UPDATE_HEARTBEAT_RE);
  const cronIndex = lowered.search(SPECIAL_UPDATE_CRON_RE);
  if (heartbeatIndex === -1 && cronIndex === -1) return null;
  if (heartbeatIndex === -1) return "cron";
  if (cronIndex === -1) return "heartbeat";
  return cronIndex > heartbeatIndex ? "cron" : "heartbeat";
};

const formatEveryMs = (everyMs: number) => {
  if (everyMs % 3600000 === 0) {
    return `${everyMs / 3600000}h`;
  }
  if (everyMs % 60000 === 0) {
    return `${everyMs / 60000}m`;
  }
  if (everyMs % 1000 === 0) {
    return `${everyMs / 1000}s`;
  }
  return `${everyMs}ms`;
};

const formatCronSchedule = (schedule: CronJobSummary["schedule"]) => {
  if (schedule.kind === "every") {
    return `Every ${formatEveryMs(schedule.everyMs)}`;
  }
  if (schedule.kind === "cron") {
    return schedule.tz ? `Cron: ${schedule.expr} (${schedule.tz})` : `Cron: ${schedule.expr}`;
  }
  return `At: ${new Date(schedule.atMs).toLocaleString()}`;
};

const buildCronDisplay = (job: CronJobSummary) => {
  const payloadText =
    job.payload.kind === "systemEvent" ? job.payload.text : job.payload.message;
  const lines = [job.name, formatCronSchedule(job.schedule), payloadText].filter(Boolean);
  return lines.join("\n");
};

const buildHistoryLines = (messages: ChatHistoryMessage[]) => {
  const lines: string[] = [];
  let lastAssistant: string | null = null;
  let lastRole: string | null = null;
  let lastUser: string | null = null;
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "other";
    const extracted = extractText(message);
    const text = stripUiMetadata(extracted?.trim() ?? "");
    const thinking =
      role === "assistant" ? formatThinkingMarkdown(extractThinking(message) ?? "") : "";
    const toolLines = extractToolLines(message);
    if (!text && !thinking && toolLines.length === 0) continue;
    if (role === "user") {
      if (text && isHeartbeatPrompt(text)) {
        continue;
      }
      if (text) {
        lines.push(`> ${text}`);
        lastUser = text;
      }
      lastRole = "user";
    } else if (role === "assistant") {
      if (thinking) {
        lines.push(thinking);
      }
      if (toolLines.length > 0) {
        lines.push(...toolLines);
      }
      if (text) {
        lines.push(text);
        lastAssistant = text;
      }
      lastRole = "assistant";
    } else if (toolLines.length > 0) {
      lines.push(...toolLines);
    } else if (text) {
      lines.push(text);
    }
  }
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return { lines: deduped, lastAssistant, lastRole, lastUser };
};

const mergeStreamingText = (current: string, incoming: string): string => {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  if (current.endsWith(incoming)) return current;
  if (incoming.endsWith(current)) return incoming;
  return `${current}${incoming}`;
};

const extractReasoningBody = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^reasoning:\s*([\s\S]*)$/i);
  if (!match) return null;
  const body = (match[1] ?? "").trim();
  return body || null;
};

const resolveThinkingFromAgentStream = (
  data: Record<string, unknown> | null,
  rawStream: string
): string | null => {
  if (data) {
    const extracted = extractThinking(data);
    if (extracted) return extracted;
    const text = typeof data.text === "string" ? data.text : "";
    const delta = typeof data.delta === "string" ? data.delta : "";
    const prefixed = extractReasoningBody(text) ?? extractReasoningBody(delta);
    if (prefixed) return prefixed;
  }
  const tagged = extractThinkingFromTaggedStream(rawStream);
  return tagged || null;
};

const findLatestHeartbeatResponse = (messages: ChatHistoryMessage[]) => {
  let awaitingHeartbeatReply = false;
  let latestResponse: string | null = null;
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "";
    if (role === "user") {
      const text = stripUiMetadata(extractText(message) ?? "").trim();
      awaitingHeartbeatReply = isHeartbeatPrompt(text);
      continue;
    }
    if (role === "assistant" && awaitingHeartbeatReply) {
      const text = stripUiMetadata(extractText(message) ?? "").trim();
      if (text) {
        latestResponse = text;
      }
    }
  }
  return latestResponse;
};

const mergeHistoryWithPending = (historyLines: string[], currentLines: string[]) => {
  if (currentLines.length === 0) return historyLines;
  if (historyLines.length === 0) return historyLines;
  const merged = [...historyLines];
  let cursor = 0;
  for (const line of currentLines) {
    let foundIndex = -1;
    for (let i = cursor; i < merged.length; i += 1) {
      if (merged[i] === line) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex !== -1) {
      cursor = foundIndex + 1;
      continue;
    }
    merged.splice(cursor, 0, line);
    cursor += 1;
  }
  return merged;
};

const findAgentBySessionKey = (agents: AgentState[], sessionKey: string): string | null => {
  const exact = agents.find((agent) => isSameSessionKey(agent.sessionKey, sessionKey));
  return exact ? exact.agentId : null;
};

const findAgentByRunId = (agents: AgentState[], runId: string): string | null => {
  const match = agents.find((agent) => agent.runId === runId);
  return match ? match.agentId : null;
};

const AgentStudioPage = () => {
  const {
    client,
    status,
    gatewayUrl,
    token,
    error: gatewayError,
    connect,
    disconnect,
    setGatewayUrl,
    setToken,
  } = useGatewayConnection();

  const { state, dispatch, hydrateAgents, setError, setLoading } = useAgentStore();
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [focusedPreferencesLoaded, setFocusedPreferencesLoaded] = useState(false);
  const [heartbeatTick, setHeartbeatTick] = useState(0);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const summaryRefreshRef = useRef<number | null>(null);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  const [inspectAgentId, setInspectAgentId] = useState<string | null>(null);
  const studioSessionIdRef = useRef<string | null>(null);
  const thinkingDebugRef = useRef<Set<string>>(new Set());
  const chatRunSeenRef = useRef<Set<string>>(new Set());
  const specialUpdateRef = useRef<Map<string, string>>(new Map());
  const specialUpdateInFlightRef = useRef<Set<string>>(new Set());
  const toolLinesSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const assistantStreamByRunRef = useRef<Map<string, string>>(new Map());
  const focusedSaveTimerRef = useRef<number | null>(null);

  const agents = state.agents;
  const selectedAgent = useMemo(() => getSelectedAgent(state), [state]);
  const filteredAgents = useMemo(
    () => getFilteredAgents(state, focusFilter),
    [focusFilter, state]
  );
  const focusedAgent = useMemo(() => {
    if (filteredAgents.length === 0) return null;
    const selectedInFilter = selectedAgent
      ? filteredAgents.find((entry) => entry.agentId === selectedAgent.agentId)
      : null;
    return selectedInFilter ?? filteredAgents[0] ?? null;
  }, [filteredAgents, selectedAgent]);
  const inspectAgent = useMemo(() => {
    if (!inspectAgentId) return null;
    return agents.find((entry) => entry.agentId === inspectAgentId) ?? null;
  }, [agents, inspectAgentId]);
  const faviconSeed = useMemo(() => {
    const firstAgent = agents[0];
    const seed = firstAgent?.avatarSeed ?? firstAgent?.agentId ?? "";
    return seed.trim() || null;
  }, [agents]);
  const faviconHref = useMemo(
    () => (faviconSeed ? buildAvatarDataUrl(faviconSeed) : null),
    [faviconSeed]
  );
  const errorMessage = state.error ?? gatewayModelsError;

  useEffect(() => {
    const selector = 'link[data-agent-favicon="true"]';
    const existing = document.querySelector(selector) as HTMLLinkElement | null;
    if (!faviconHref) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (existing.href !== faviconHref) {
        existing.href = faviconHref;
      }
      return;
    }
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = faviconHref;
    link.setAttribute("data-agent-favicon", "true");
    document.head.appendChild(link);
  }, [faviconHref]);

  const resolveConfiguredModelKey = useCallback(
    (raw: string, models?: Record<string, { alias?: string }>) => {
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
    },
    []
  );

  const buildAllowedModelKeys = useCallback(
    (snapshot: GatewayConfigSnapshot | null) => {
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
    },
    [resolveConfiguredModelKey]
  );

  const summarizeThinkingMessage = useCallback((message: unknown) => {
    if (!message || typeof message !== "object") {
      return { type: typeof message };
    }
    const record = message as Record<string, unknown>;
    const summary: Record<string, unknown> = { keys: Object.keys(record) };
    const content = record.content;
    if (Array.isArray(content)) {
      summary.contentTypes = content.map((item) => {
        if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          return typeof entry.type === "string" ? entry.type : "object";
        }
        return typeof item;
      });
    } else if (typeof content === "string") {
      summary.contentLength = content.length;
    }
    if (typeof record.text === "string") {
      summary.textLength = record.text.length;
    }
    for (const key of ["analysis", "reasoning", "thinking"]) {
      const value = record[key];
      if (typeof value === "string") {
        summary[`${key}Length`] = value.length;
      } else if (value && typeof value === "object") {
        summary[`${key}Keys`] = Object.keys(value as Record<string, unknown>);
      }
    }
    return summary;
  }, []);

  const markToolLineSeen = useCallback((runId: string | null, line: string) => {
    if (!runId) return true;
    const map = toolLinesSeenRef.current;
    const set = map.get(runId) ?? new Set<string>();
    if (!map.has(runId)) map.set(runId, set);
    if (set.has(line)) return false;
    set.add(line);
    return true;
  }, []);

  const clearToolLinesSeen = useCallback((runId?: string | null) => {
    if (!runId) return;
    toolLinesSeenRef.current.delete(runId);
  }, []);

  const resolveCronJobForAgent = useCallback((jobs: CronJobSummary[], agent: AgentState) => {
    if (!jobs.length) return null;
    const agentId = agent.agentId?.trim();
    const filtered = agentId ? jobs.filter((job) => job.agentId === agentId) : jobs;
    const active = filtered.length > 0 ? filtered : jobs;
    return [...active].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ?? null;
  }, []);

  const updateSpecialLatestUpdate = useCallback(
    async (agentId: string, agent: AgentState, message: string) => {
      const key = agentId;
      const kind = resolveSpecialUpdateKind(message);
      if (!kind) {
        if (agent.latestOverride || agent.latestOverrideKind) {
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch: { latestOverride: null, latestOverrideKind: null },
          });
        }
        return;
      }
      if (specialUpdateInFlightRef.current.has(key)) return;
      specialUpdateInFlightRef.current.add(key);
      try {
        if (kind === "heartbeat") {
          const resolvedId =
            agent.agentId?.trim() || parseAgentIdFromSessionKey(agent.sessionKey);
          if (!resolvedId) {
            dispatch({
              type: "updateAgent",
              agentId: agent.agentId,
              patch: { latestOverride: null, latestOverrideKind: null },
            });
            return;
          }
          const sessions = await client.call<SessionsListResult>("sessions.list", {
            agentId: resolvedId,
            includeGlobal: false,
            includeUnknown: false,
            limit: 48,
          });
          const entries = Array.isArray(sessions.sessions) ? sessions.sessions : [];
          const heartbeatSessions = entries.filter((entry) => {
            const label = entry.origin?.label;
            return typeof label === "string" && label.toLowerCase() === "heartbeat";
          });
          const candidates = heartbeatSessions.length > 0 ? heartbeatSessions : entries;
          const sorted = [...candidates].sort(
            (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          );
          const sessionKey = sorted[0]?.key;
          if (!sessionKey) {
            dispatch({
              type: "updateAgent",
              agentId: agent.agentId,
              patch: { latestOverride: null, latestOverrideKind: null },
            });
            return;
          }
          const history = await client.call<ChatHistoryResult>("chat.history", {
            sessionKey,
            limit: 200,
          });
          const content = findLatestHeartbeatResponse(history.messages ?? []) ?? "";
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch: {
              latestOverride: content || null,
              latestOverrideKind: content ? "heartbeat" : null,
            },
          });
          return;
        }
        const cronResult = await fetchCronJobs();
        const job = resolveCronJobForAgent(cronResult.jobs, agent);
        const content = job ? buildCronDisplay(job) : "";
        dispatch({
          type: "updateAgent",
          agentId: agent.agentId,
          patch: {
            latestOverride: content || null,
            latestOverrideKind: content ? "cron" : null,
          },
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load latest cron/heartbeat update.";
        logger.error(message);
      } finally {
        specialUpdateInFlightRef.current.delete(key);
      }
    },
    [client, dispatch, resolveCronJobForAgent]
  );

  const refreshHeartbeatLatestUpdate = useCallback(() => {
    const agents = stateRef.current.agents;
    for (const agent of agents) {
      void updateSpecialLatestUpdate(agent.agentId, agent, "heartbeat");
    }
  }, [updateSpecialLatestUpdate]);

  const resolveAgentName = useCallback((agent: AgentsListResult["agents"][number]) => {
    const fromList = typeof agent.name === "string" ? agent.name.trim() : "";
    if (fromList) return fromList;
    const fromIdentity =
      typeof agent.identity?.name === "string" ? agent.identity.name.trim() : "";
    if (fromIdentity) return fromIdentity;
    return agent.id;
  }, []);

  const resolveAgentAvatarUrl = useCallback(
    (agent: AgentsListResult["agents"][number]) => {
      const candidate = agent.identity?.avatarUrl ?? agent.identity?.avatar ?? null;
      if (typeof candidate !== "string") return null;
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
      if (trimmed.startsWith("data:image/")) return trimmed;
      return null;
    },
    []
  );

  const loadAgents = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true);
    try {
      const agentsResult = await client.call<AgentsListResult>("agents.list", {});
      type StudioSessionEntry = { key: string; sessionId: string; updatedAt: number };
      type StudioSessionsForAgent = { agentId: string; entries: StudioSessionEntry[] };
      const studioSessionsByAgent = await Promise.all(
        agentsResult.agents.map(async (agent): Promise<StudioSessionsForAgent> => {
          const prefix = `agent:${agent.id}:studio:`;
          try {
            const sessions = await client.call<SessionsListResult>("sessions.list", {
              agentId: agent.id,
              includeGlobal: false,
              includeUnknown: false,
              limit: 64,
            });
            const entries = Array.isArray(sessions.sessions) ? sessions.sessions : [];
            const studioEntries = entries
              .map((entry): StudioSessionEntry | null => {
                const key = entry.key?.trim();
                if (!key || !key.startsWith(prefix)) return null;
                const suffix = key.slice(prefix.length).trim();
                if (!suffix) return null;
                const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
                return { key, sessionId: suffix, updatedAt };
              })
              .filter((entry): entry is StudioSessionEntry => Boolean(entry))
              .sort((a, b) => b.updatedAt - a.updatedAt);
            return { agentId: agent.id, entries: studioEntries };
          } catch (err) {
            logger.error("Failed to list sessions while resolving studio session.", err);
            return { agentId: agent.id, entries: [] };
          }
        })
      );
      const allStudioSessions = studioSessionsByAgent
        .flatMap((group) => group.entries)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const hadPersistedSessionId = Boolean(studioSessionIdRef.current?.trim());
      let sessionId = studioSessionIdRef.current?.trim() ?? "";
      const hasPersistedSession =
        sessionId.length > 0 && allStudioSessions.some((entry) => entry.sessionId === sessionId);
      if (!sessionId || (allStudioSessions.length > 0 && !hasPersistedSession)) {
        sessionId = allStudioSessions[0]?.sessionId ?? generateUUID();
        studioSessionIdRef.current = sessionId;
      }
      if (!hadPersistedSessionId || !hasPersistedSession) {
        const key = gatewayUrl.trim();
        if (key) {
          try {
            await updateStudioSettings({
              sessions: { [key]: sessionId },
            });
          } catch (err) {
            logger.error("Failed to save studio session ID.", err);
          }
        }
      }
      const seeds: AgentStoreSeed[] = agentsResult.agents.map((agent) => {
        const avatarSeed = agent.id;
        const avatarUrl = resolveAgentAvatarUrl(agent);
        const name = resolveAgentName(agent);
        return {
          agentId: agent.id,
          name,
          sessionKey: buildAgentStudioSessionKey(agent.id, sessionId),
          avatarSeed,
          avatarUrl,
        };
      });
      const existingSessions = new Set<string>();
      const staleStudioKeys: string[] = [];
      for (const seed of seeds) {
        const sessionsForAgent = studioSessionsByAgent.find(
          (entry) => entry.agentId === seed.agentId
        )?.entries;
        if (!sessionsForAgent || sessionsForAgent.length === 0) continue;
        const active = sessionsForAgent.find(
          (entry) => entry.sessionId === sessionId
        );
        if (!active) continue;
        existingSessions.add(active.key);
        for (const entry of sessionsForAgent) {
          if (entry.key === active.key) continue;
          staleStudioKeys.push(entry.key);
        }
      }
      if (staleStudioKeys.length > 0) {
        await Promise.all(
          staleStudioKeys.map(async (key) => {
            try {
              await client.call("sessions.delete", { key });
            } catch (err) {
              logger.error("Failed to prune duplicate studio session key.", err);
            }
          })
        );
      }
      hydrateAgents(seeds);
      if (existingSessions.size > 0) {
        for (const seed of seeds) {
          if (!existingSessions.has(seed.sessionKey)) continue;
          dispatch({
            type: "updateAgent",
            agentId: seed.agentId,
            patch: { sessionCreated: true },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agents.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    client,
    dispatch,
    hydrateAgents,
    resolveAgentAvatarUrl,
    resolveAgentName,
    setError,
    setLoading,
    gatewayUrl,
    status,
  ]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    const key = gatewayUrl.trim();
    studioSessionIdRef.current = null;
    if (!key) {
      setFocusedPreferencesLoaded(true);
      return;
    }
    setFocusedPreferencesLoaded(false);
    const loadFocusedPreferences = async () => {
      try {
        const settingsResult = await fetchStudioSettings();
        if (
          cancelled ||
          !settingsResult.settings
        ) {
          return;
        }
        const persistedSessionId = resolveStudioSessionId(settingsResult.settings, key);
        if (persistedSessionId) {
          studioSessionIdRef.current = persistedSessionId;
        }
        const preference = resolveFocusedPreference(settingsResult.settings, key);
        if (preference) {
          setFocusFilter(preference.filter);
          dispatch({
            type: "selectAgent",
            agentId: preference.selectedAgentId,
          });
          return;
        }
        setFocusFilter("all");
      } catch (err) {
        logger.error("Failed to load focused preference.", err);
      } finally {
        if (!cancelled) {
          setFocusedPreferencesLoaded(true);
        }
      }
    };
    void loadFocusedPreferences();
    return () => {
      cancelled = true;
    };
  }, [dispatch, gatewayUrl]);

  useEffect(() => {
    return () => {
      if (focusedSaveTimerRef.current !== null) {
        window.clearTimeout(focusedSaveTimerRef.current);
        focusedSaveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const key = gatewayUrl.trim();
    if (!focusedPreferencesLoaded || !key) return;
    if (focusedSaveTimerRef.current !== null) {
      window.clearTimeout(focusedSaveTimerRef.current);
    }
    focusedSaveTimerRef.current = window.setTimeout(() => {
      focusedSaveTimerRef.current = null;
      void updateStudioSettings({
        focused: {
          [key]: {
            mode: "focused",
            filter: focusFilter,
            selectedAgentId: stateRef.current.selectedAgentId,
          },
        },
      }).catch((err) => {
        logger.error("Failed to save focused preference.", err);
      });
    }, 300);
    return () => {
      if (focusedSaveTimerRef.current !== null) {
        window.clearTimeout(focusedSaveTimerRef.current);
        focusedSaveTimerRef.current = null;
      }
    };
  }, [focusFilter, focusedPreferencesLoaded, gatewayUrl, state.selectedAgentId]);

  useEffect(() => {
    if (status !== "connected" || !focusedPreferencesLoaded) return;
    void loadAgents();
  }, [focusedPreferencesLoaded, gatewayUrl, loadAgents, status]);

  useEffect(() => {
    if (status === "disconnected") {
      setLoading(false);
    }
  }, [setLoading, status]);

  useEffect(() => {
    if (!inspectAgentId) return;
    if (state.selectedAgentId && state.selectedAgentId !== inspectAgentId) {
      setInspectAgentId(null);
    }
  }, [inspectAgentId, state.selectedAgentId]);

  useEffect(() => {
    if (inspectAgentId && !inspectAgent) {
      setInspectAgentId(null);
    }
  }, [inspectAgentId, inspectAgent]);

  useEffect(() => {
    if (status !== "connected") {
      setGatewayModels([]);
      setGatewayModelsError(null);
      return;
    }
    let cancelled = false;
    const loadModels = async () => {
      let configSnapshot: GatewayConfigSnapshot | null = null;
      try {
        configSnapshot = await client.call<GatewayConfigSnapshot>("config.get", {});
      } catch (err) {
        logger.error("Failed to load gateway config.", err);
      }
      try {
        const result = await client.call<{ models: GatewayModelChoice[] }>(
          "models.list",
          {}
        );
        if (cancelled) return;
        const catalog = Array.isArray(result.models) ? result.models : [];
        const allowedKeys = buildAllowedModelKeys(configSnapshot);
        if (allowedKeys.length === 0) {
          setGatewayModels(catalog);
          setGatewayModelsError(null);
          return;
        }
        const filtered = catalog.filter((entry) =>
          allowedKeys.includes(`${entry.provider}/${entry.id}`)
        );
        const filteredKeys = new Set(
          filtered.map((entry) => `${entry.provider}/${entry.id}`)
        );
        const extras: GatewayModelChoice[] = [];
        for (const key of allowedKeys) {
          if (filteredKeys.has(key)) continue;
          const [provider, id] = key.split("/");
          if (!provider || !id) continue;
          extras.push({ provider, id, name: key });
        }
        setGatewayModels([...filtered, ...extras]);
        setGatewayModelsError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load models.";
        setGatewayModelsError(message);
        setGatewayModels([]);
        logger.error("Failed to load gateway models.", err);
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [buildAllowedModelKeys, client, status]);

  const loadSummarySnapshot = useCallback(async () => {
    const activeAgents = stateRef.current.agents.filter((agent) => agent.sessionCreated);
    const sessionKeys = Array.from(
      new Set(
        activeAgents
          .map((agent) => agent.sessionKey)
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
      )
    ).slice(0, 64);
    if (sessionKeys.length === 0) return;
    try {
      const [statusSummary, previewResult] = await Promise.all([
        client.call<StatusSummary>("status", {}),
        client.call<SessionsPreviewResult>("sessions.preview", {
          keys: sessionKeys,
          limit: 8,
          maxChars: 240,
        }),
      ]);
      const previewMap = new Map<string, SessionsPreviewEntry>();
      for (const entry of previewResult.previews ?? []) {
        previewMap.set(entry.key, entry);
      }
      const activityByKey = new Map<string, number>();
      const addActivity = (entries?: SessionStatusSummary[]) => {
        if (!entries) return;
        for (const entry of entries) {
          if (!entry?.key || typeof entry.updatedAt !== "number") continue;
          activityByKey.set(entry.key, entry.updatedAt);
        }
      };
      addActivity(statusSummary.sessions?.recent);
      for (const group of statusSummary.sessions?.byAgent ?? []) {
        addActivity(group.recent);
      }
      for (const agent of activeAgents) {
        const patch: Partial<AgentState> = {};
        const activity = activityByKey.get(agent.sessionKey);
        if (typeof activity === "number") {
          patch.lastActivityAt = activity;
        }
        const preview = previewMap.get(agent.sessionKey);
        if (preview?.items?.length) {
          const lastAssistant = [...preview.items]
            .reverse()
            .find((item) => item.role === "assistant");
          const lastUser = [...preview.items]
            .reverse()
            .find((item) => item.role === "user");
          if (lastAssistant?.text) {
            const cleaned = stripUiMetadata(lastAssistant.text);
            patch.latestPreview = cleaned;
          }
          if (lastUser?.text) {
            patch.lastUserMessage = stripUiMetadata(lastUser.text);
          }
        }
        if (Object.keys(patch).length > 0) {
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to load summary snapshot.", err);
    }
  }, [client, dispatch]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    if (status !== "connected") return;
    const unsubscribe = client.onEvent((event: EventFrame) => {
      if (event.event !== "presence" && event.event !== "heartbeat") return;
      if (event.event === "heartbeat") {
        setHeartbeatTick((prev) => prev + 1);
        refreshHeartbeatLatestUpdate();
      }
      if (summaryRefreshRef.current !== null) {
        window.clearTimeout(summaryRefreshRef.current);
      }
      summaryRefreshRef.current = window.setTimeout(() => {
        summaryRefreshRef.current = null;
        void loadSummarySnapshot();
      }, 750);
    });
    return () => {
      if (summaryRefreshRef.current !== null) {
        window.clearTimeout(summaryRefreshRef.current);
        summaryRefreshRef.current = null;
      }
      unsubscribe();
    };
  }, [client, loadSummarySnapshot, refreshHeartbeatLatestUpdate, status]);

  useEffect(() => {
    if (!state.selectedAgentId) return;
    if (agents.some((agent) => agent.agentId === state.selectedAgentId)) return;
    dispatch({ type: "selectAgent", agentId: null });
  }, [agents, dispatch, state.selectedAgentId]);

  useEffect(() => {
    const nextId = focusedAgent?.agentId ?? null;
    if (state.selectedAgentId === nextId) return;
    dispatch({ type: "selectAgent", agentId: nextId });
  }, [dispatch, focusedAgent, state.selectedAgentId]);

  useEffect(() => {
    for (const agent of agents) {
      const lastMessage = agent.lastUserMessage?.trim() ?? "";
      const kind = resolveSpecialUpdateKind(lastMessage);
      const key = agent.agentId;
      const marker = kind === "heartbeat" ? `${lastMessage}:${heartbeatTick}` : lastMessage;
      const previous = specialUpdateRef.current.get(key);
      if (previous === marker) continue;
      specialUpdateRef.current.set(key, marker);
      void updateSpecialLatestUpdate(agent.agentId, agent, lastMessage);
    }
  }, [agents, heartbeatTick, updateSpecialLatestUpdate]);

  const loadAgentHistory = useCallback(
    async (agentId: string) => {
      const agent = stateRef.current.agents.find((entry) => entry.agentId === agentId);
      const sessionKey = agent?.sessionKey?.trim();
      if (!agent || !agent.sessionCreated || !sessionKey) return;
      if (historyInFlightRef.current.has(sessionKey)) return;

      historyInFlightRef.current.add(sessionKey);
      const loadedAt = Date.now();
      try {
        const result = await client.call<ChatHistoryResult>("chat.history", {
          sessionKey,
          limit: 200,
        });
        const { lines, lastAssistant, lastRole, lastUser } = buildHistoryLines(
          result.messages ?? []
        );
        if (lines.length === 0) {
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { historyLoadedAt: loadedAt },
          });
          return;
        }
        const currentLines = agent.outputLines;
        const mergedLines = mergeHistoryWithPending(lines, currentLines);
        const isSame =
          mergedLines.length === currentLines.length &&
          mergedLines.every((line, index) => line === currentLines[index]);
        if (isSame) {
          const patch: Partial<AgentState> = { historyLoadedAt: loadedAt };
          if (!agent.runId && agent.status === "running" && lastRole === "assistant") {
            patch.status = "idle";
            patch.runId = null;
            patch.streamText = null;
            patch.thinkingTrace = null;
          }
          dispatch({
            type: "updateAgent",
            agentId,
            patch,
          });
          return;
        }
        const patch: Partial<AgentState> = {
          outputLines: mergedLines,
          lastResult: lastAssistant ?? null,
          ...(lastAssistant ? { latestPreview: lastAssistant } : {}),
          ...(lastUser ? { lastUserMessage: lastUser } : {}),
          historyLoadedAt: loadedAt,
        };
        if (!agent.runId && agent.status === "running" && lastRole === "assistant") {
          patch.status = "idle";
          patch.runId = null;
          patch.streamText = null;
          patch.thinkingTrace = null;
        }
        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load chat history.";
        console.error(msg);
      } finally {
        historyInFlightRef.current.delete(sessionKey);
      }
    },
    [client, dispatch]
  );

  useEffect(() => {
    if (status !== "connected") return;
    for (const agent of agents) {
      if (!agent.sessionCreated || agent.historyLoadedAt) continue;
      void loadAgentHistory(agent.agentId);
    }
  }, [agents, loadAgentHistory, status]);

  const handleInspectAgent = useCallback(
    (agentId: string) => {
      setInspectAgentId(agentId);
      dispatch({ type: "selectAgent", agentId });
    },
    [dispatch]
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return;
      const confirmed = window.confirm(
        `Delete ${agent.name}? This removes the agent from the gateway config.`
      );
      if (!confirmed) return;
      try {
        await deleteGatewayAgent({
          client,
          agentId,
          sessionKey: agent.sessionKey,
        });
        setInspectAgentId(null);
        await loadAgents();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete agent.";
        setError(msg);
      }
    },
    [agents, client, loadAgents, setError]
  );

  useEffect(() => {
    if (status !== "connected") return;
    const hasRunning = agents.some((agent) => agent.status === "running");
    if (!hasRunning) return;
    for (const agent of stateRef.current.agents) {
      if (agent.status !== "running") continue;
      void loadAgentHistory(agent.agentId);
    }
    const timer = window.setInterval(() => {
      for (const agent of stateRef.current.agents) {
        if (agent.status !== "running") continue;
        void loadAgentHistory(agent.agentId);
      }
    }, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [agents, loadAgentHistory, status]);

  const handleSend = useCallback(
    async (agentId: string, sessionKey: string, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const isResetCommand = /^\/(reset|new)(\s|$)/i.test(trimmed);
      const runId = crypto.randomUUID();
      assistantStreamByRunRef.current.delete(runId);
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) {
        dispatch({
          type: "appendOutput",
          agentId,
          line: "Error: Agent not found.",
        });
        return;
      }
      if (isResetCommand) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null },
        });
      }
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          status: "running",
          runId,
          streamText: "",
          thinkingTrace: null,
          draft: "",
          lastUserMessage: trimmed,
          lastActivityAt: Date.now(),
        },
      });
      dispatch({
        type: "appendOutput",
        agentId,
        line: `> ${trimmed}`,
      });
      try {
        if (!sessionKey) {
          throw new Error("Missing session key for agent.");
        }
        let createdSession = agent.sessionCreated;
        if (!agent.sessionSettingsSynced) {
          await client.call("sessions.patch", {
            key: sessionKey,
            model: agent.model ?? null,
            thinkingLevel: agent.thinkingLevel ?? null,
          });
          createdSession = true;
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { sessionSettingsSynced: true, sessionCreated: true },
          });
        }
        await client.call("chat.send", {
          sessionKey,
          message: buildAgentInstruction({ message: trimmed }),
          deliver: false,
          idempotencyKey: runId,
        });
        if (!createdSession) {
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { sessionCreated: true },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gateway error";
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { status: "error", runId: null, streamText: null, thinkingTrace: null },
        });
        dispatch({
          type: "appendOutput",
          agentId,
          line: `Error: ${msg}`,
        });
      }
    },
    [agents, client, dispatch]
  );

  const handleModelChange = useCallback(
    async (agentId: string, sessionKey: string, value: string | null) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { model: value, sessionSettingsSynced: false },
      });
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent?.sessionCreated) return;
      try {
        await client.call("sessions.patch", {
          key: sessionKey,
          model: value ?? null,
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { sessionSettingsSynced: true },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set model.";
        dispatch({
          type: "appendOutput",
          agentId,
          line: `Model update failed: ${msg}`,
        });
      }
    },
    [agents, client, dispatch]
  );

  const handleThinkingChange = useCallback(
    async (agentId: string, sessionKey: string, value: string | null) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { thinkingLevel: value, sessionSettingsSynced: false },
      });
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent?.sessionCreated) return;
      try {
        await client.call("sessions.patch", {
          key: sessionKey,
          thinkingLevel: value ?? null,
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { sessionSettingsSynced: true },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set thinking level.";
        dispatch({
          type: "appendOutput",
          agentId,
          line: `Thinking update failed: ${msg}`,
        });
      }
    },
    [agents, client, dispatch]
  );


  const handleToolCallingToggle = useCallback(
    (agentId: string, enabled: boolean) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { toolCallingEnabled: enabled },
      });
    },
    [dispatch]
  );

  const handleThinkingTracesToggle = useCallback(
    (agentId: string, enabled: boolean) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { showThinkingTraces: enabled },
      });
    },
    [dispatch]
  );

  useEffect(() => {
    return client.onEvent((event: EventFrame) => {
      if (event.event !== "chat") return;
      const payload = event.payload as ChatEventPayload | undefined;
      if (!payload?.sessionKey) return;
      if (payload.runId) {
        chatRunSeenRef.current.add(payload.runId);
      }
      const agentId = findAgentBySessionKey(state.agents, payload.sessionKey);
      if (!agentId) return;
      const agent = state.agents.find((entry) => entry.agentId === agentId);
      const summaryPatch = getChatSummaryPatch(payload);
      if (summaryPatch) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { ...summaryPatch, sessionCreated: true },
        });
      }
      const role =
        payload.message && typeof payload.message === "object"
          ? (payload.message as Record<string, unknown>).role
          : null;
      if (role === "user") {
        return;
      }
      dispatch({
        type: "markActivity",
        agentId,
      });
      const nextTextRaw = extractText(payload.message);
      const nextText = nextTextRaw ? stripUiMetadata(nextTextRaw) : null;
      const nextThinking = extractThinking(payload.message ?? payload);
      const toolLines = extractToolLines(payload.message ?? payload);
      const isToolRole = role === "tool" || role === "toolResult";
      if (payload.state === "delta") {
        if (typeof nextTextRaw === "string" && isUiMetadataPrefix(nextTextRaw.trim())) {
          return;
        }
        if (toolLines.length > 0) {
          for (const line of toolLines) {
            if (markToolLineSeen(payload.runId ?? null, line)) {
              dispatch({
                type: "appendOutput",
                agentId,
                line,
              });
            }
          }
        }
        if (nextThinking) {
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { thinkingTrace: nextThinking, status: "running" },
          });
        }
        if (typeof nextText === "string") {
          dispatch({
            type: "setStream",
            agentId,
            value: nextText,
          });
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { status: "running" },
          });
        }
        return;
      }

      if (payload.state === "final") {
        if (payload.runId) {
          chatRunSeenRef.current.delete(payload.runId);
          assistantStreamByRunRef.current.delete(payload.runId);
        }
        if (
          !nextThinking &&
          role === "assistant" &&
          !thinkingDebugRef.current.has(payload.sessionKey)
        ) {
          thinkingDebugRef.current.add(payload.sessionKey);
          console.warn("No thinking trace extracted from chat event.", {
            sessionKey: payload.sessionKey,
            message: summarizeThinkingMessage(payload.message ?? payload),
          });
        }
        const thinkingText = nextThinking ?? agent?.thinkingTrace ?? null;
        const thinkingLine = thinkingText ? formatThinkingMarkdown(thinkingText) : "";
        if (thinkingLine) {
          dispatch({
            type: "appendOutput",
            agentId,
            line: thinkingLine,
          });
        }
        if (toolLines.length > 0) {
          for (const line of toolLines) {
            if (markToolLineSeen(payload.runId ?? null, line)) {
              dispatch({
                type: "appendOutput",
                agentId,
                line,
              });
            }
          }
        }
        if (
          !thinkingLine &&
          role === "assistant" &&
          agent &&
          !agent.outputLines.some((line) => isTraceMarkdown(line.trim()))
        ) {
          void loadAgentHistory(agentId);
        }
        if (!isToolRole && typeof nextText === "string") {
          dispatch({
            type: "appendOutput",
            agentId,
            line: nextText,
          });
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { lastResult: nextText },
          });
        }
        if (agent?.lastUserMessage && !agent.latestOverride) {
          void updateSpecialLatestUpdate(agentId, agent, agent.lastUserMessage);
        }
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { streamText: null, thinkingTrace: null },
        });
        clearToolLinesSeen(payload.runId ?? null);
        return;
      }

      if (payload.state === "aborted") {
        if (payload.runId) {
          chatRunSeenRef.current.delete(payload.runId);
          assistantStreamByRunRef.current.delete(payload.runId);
        }
        clearToolLinesSeen(payload.runId ?? null);
        dispatch({
          type: "appendOutput",
          agentId,
          line: "Run aborted.",
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { streamText: null, thinkingTrace: null },
        });
        return;
      }

      if (payload.state === "error") {
        if (payload.runId) {
          chatRunSeenRef.current.delete(payload.runId);
          assistantStreamByRunRef.current.delete(payload.runId);
        }
        clearToolLinesSeen(payload.runId ?? null);
        dispatch({
          type: "appendOutput",
          agentId,
          line: payload.errorMessage ? `Error: ${payload.errorMessage}` : "Run error.",
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { streamText: null, thinkingTrace: null },
        });
      }
    });
  }, [
    client,
    dispatch,
    loadAgentHistory,
    state.agents,
    summarizeThinkingMessage,
    markToolLineSeen,
    clearToolLinesSeen,
    updateSpecialLatestUpdate,
  ]);

  useEffect(() => {
    return client.onEvent((event: EventFrame) => {
      if (event.event !== "agent") return;
      const payload = event.payload as AgentEventPayload | undefined;
      if (!payload?.runId) return;
      const directMatch = payload.sessionKey
        ? findAgentBySessionKey(state.agents, payload.sessionKey)
        : null;
      const match = directMatch ?? findAgentByRunId(state.agents, payload.runId);
      if (!match) return;
      const agent = state.agents.find((entry) => entry.agentId === match);
      if (!agent) return;
      dispatch({
        type: "markActivity",
        agentId: match,
      });
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      const data =
        payload.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : null;
      const hasChatEvents = chatRunSeenRef.current.has(payload.runId);
      if (stream === "assistant") {
        const rawText = typeof data?.text === "string" ? data.text : "";
        const rawDelta = typeof data?.delta === "string" ? data.delta : "";
        const previousRaw = assistantStreamByRunRef.current.get(payload.runId) ?? "";
        let mergedRaw = previousRaw;
        if (rawText) {
          mergedRaw = rawText;
        } else if (rawDelta) {
          mergedRaw = mergeStreamingText(previousRaw, rawDelta);
        }
        if (mergedRaw) {
          assistantStreamByRunRef.current.set(payload.runId, mergedRaw);
        }
        const liveThinking = resolveThinkingFromAgentStream(data, mergedRaw);
        const patch: Partial<AgentState> = {
          status: "running",
          runId: payload.runId,
          lastActivityAt: Date.now(),
          sessionCreated: true,
        };
        if (liveThinking) {
          patch.thinkingTrace = liveThinking;
        }
        dispatch({
          type: "updateAgent",
          agentId: match,
          patch,
        });
        if (mergedRaw && (!rawText || !isUiMetadataPrefix(rawText.trim()))) {
          const visibleText = extractText({ role: "assistant", content: mergedRaw }) ?? mergedRaw;
          const cleaned = stripUiMetadata(visibleText);
          if (cleaned) {
            if (!hasChatEvents || !agent.streamText?.trim()) {
              dispatch({
                type: "setStream",
                agentId: match,
                value: cleaned,
              });
            }
          }
        }
        return;
      }
      if (stream === "tool") {
        const phase = typeof data?.phase === "string" ? data.phase : "";
        const name = typeof data?.name === "string" ? data.name : "tool";
        const toolCallId = typeof data?.toolCallId === "string" ? data.toolCallId : "";
        if (phase && phase !== "result") {
          const args =
            (data?.arguments as unknown) ??
            (data?.args as unknown) ??
            (data?.input as unknown) ??
            (data?.parameters as unknown) ??
            null;
          const line = formatToolCallMarkdown({
            id: toolCallId || undefined,
            name,
            arguments: args,
          });
          if (line && markToolLineSeen(payload.runId, line)) {
            dispatch({
              type: "appendOutput",
              agentId: match,
              line,
            });
          }
          return;
        }
        if (phase !== "result") return;
        const result = data?.result;
        const isError = typeof data?.isError === "boolean" ? data.isError : undefined;
        const resultRecord =
          result && typeof result === "object" ? (result as Record<string, unknown>) : null;
        const details =
          resultRecord && "details" in resultRecord ? resultRecord.details : undefined;
        let content: unknown = result;
        if (resultRecord) {
          if (Array.isArray(resultRecord.content)) {
            content = resultRecord.content;
          } else if (typeof resultRecord.text === "string") {
            content = resultRecord.text;
          }
        }
        const message = {
          role: "tool",
          toolName: name,
          toolCallId,
          isError,
          details,
          content,
        };
        for (const line of extractToolLines(message)) {
          if (markToolLineSeen(payload.runId, line)) {
            dispatch({
              type: "appendOutput",
              agentId: match,
              line,
            });
          }
        }
        return;
      }
      if (stream !== "lifecycle") return;
      const summaryPatch = getAgentSummaryPatch(payload);
      if (!summaryPatch) return;
      const phase = typeof data?.phase === "string" ? data.phase : "";
      if (phase === "start") {
        dispatch({
          type: "updateAgent",
          agentId: match,
          patch: {
            status: "running",
            runId: payload.runId,
            lastActivityAt: summaryPatch.lastActivityAt ?? null,
            sessionCreated: true,
          },
        });
        return;
      }
      if (phase === "end") {
        if (agent.runId && agent.runId !== payload.runId) return;
        assistantStreamByRunRef.current.delete(payload.runId);
        if (!hasChatEvents) {
          const finalText = agent.streamText?.trim();
          if (finalText) {
            dispatch({
              type: "appendOutput",
              agentId: match,
              line: finalText,
            });
            dispatch({
              type: "updateAgent",
              agentId: match,
              patch: { lastResult: finalText },
            });
          }
        }
        chatRunSeenRef.current.delete(payload.runId);
        clearToolLinesSeen(payload.runId);
        dispatch({
          type: "updateAgent",
          agentId: match,
          patch: {
            status: "idle",
            runId: null,
            streamText: null,
            thinkingTrace: null,
            lastActivityAt: summaryPatch.lastActivityAt ?? null,
          },
        });
        return;
      }
      if (phase === "error") {
        if (agent.runId && agent.runId !== payload.runId) return;
        assistantStreamByRunRef.current.delete(payload.runId);
        chatRunSeenRef.current.delete(payload.runId);
        clearToolLinesSeen(payload.runId);
        dispatch({
          type: "updateAgent",
          agentId: match,
          patch: {
            status: "error",
            runId: null,
            streamText: null,
            thinkingTrace: null,
            lastActivityAt: summaryPatch.lastActivityAt ?? null,
          },
        });
      }
    });
  }, [client, clearToolLinesSeen, dispatch, markToolLineSeen, state.agents]);

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return false;
      try {
        await renameGatewayAgent({
          client,
          agentId,
          name,
          sessionKey: agent.sessionKey,
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { name },
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to rename agent.";
        setError(message);
        return false;
      }
    },
    [agents, client, dispatch, setError]
  );

  const handleAvatarShuffle = useCallback(
    async (agentId: string) => {
      const avatarSeed = crypto.randomUUID();
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { avatarSeed },
      });
    },
    [dispatch]
  );

  const handleNameShuffle = useCallback(
    async (agentId: string) => {
      const name = normalizeAgentName(createRandomAgentName());
      if (!name) return;
      await handleRenameAgent(agentId, name);
    },
    [handleRenameAgent]
  );

  const handleDraftChange = useCallback(
    (agentId: string, value: string) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { draft: value },
      });
    },
    [dispatch]
  );

  const connectionPanelVisible = showConnectionPanel || status !== "connected";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div className="relative z-10 flex h-full flex-col gap-4 p-4 md:p-6">
        <div className="w-full">
          <HeaderBar
            status={status}
            gatewayUrl={gatewayUrl}
            agentCount={agents.length}
            onConnectionSettings={() => setShowConnectionPanel((prev) => !prev)}
          />
        </div>

        {state.loading ? (
          <div className="w-full">
            <div className="glass-panel px-6 py-6 text-muted-foreground">
              Loading agents…
            </div>
          </div>
        ) : null}

        {connectionPanelVisible ? (
          <div className="w-full">
            <div className="glass-panel px-6 py-6">
              <ConnectionPanel
                gatewayUrl={gatewayUrl}
                token={token}
                status={status}
                error={gatewayError}
                onGatewayUrlChange={setGatewayUrl}
                onTokenChange={setToken}
                onConnect={() => void connect()}
                onDisconnect={disconnect}
              />
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="w-full">
            <div className="rounded-lg border border-destructive bg-destructive px-4 py-2 text-sm text-destructive-foreground">
              {errorMessage}
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
          <FleetSidebar
            agents={filteredAgents}
            selectedAgentId={focusedAgent?.agentId ?? state.selectedAgentId}
            filter={focusFilter}
            onFilterChange={setFocusFilter}
            onSelectAgent={(agentId) =>
              dispatch({ type: "selectAgent", agentId })
            }
          />
          <div
            className="glass-panel min-h-0 flex-1 p-2"
            data-testid="focused-agent-panel"
          >
            {focusedAgent ? (
              <AgentChatPanel
                agent={focusedAgent}
                isSelected={false}
                canSend={status === "connected"}
                onInspect={() => handleInspectAgent(focusedAgent.agentId)}
                onNameChange={(name) =>
                  handleRenameAgent(focusedAgent.agentId, name)
                }
                onDraftChange={(value) =>
                  handleDraftChange(focusedAgent.agentId, value)
                }
                onSend={(message) =>
                  handleSend(
                    focusedAgent.agentId,
                    focusedAgent.sessionKey,
                    message
                  )
                }
                onAvatarShuffle={() => handleAvatarShuffle(focusedAgent.agentId)}
                onNameShuffle={() => handleNameShuffle(focusedAgent.agentId)}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                {agents.length > 0
                  ? "No agents match this filter."
                  : "No agents available."}
              </div>
            )}
          </div>
          {inspectAgent ? (
            <div className="glass-panel min-h-0 w-full shrink-0 overflow-hidden p-0 lg:min-w-[360px] lg:max-w-[420px]">
              <AgentInspectPanel
                key={inspectAgent.agentId}
                agent={inspectAgent}
                client={client}
                models={gatewayModels}
                onClose={() => setInspectAgentId(null)}
                onDelete={() => handleDeleteAgent(inspectAgent.agentId)}
                onModelChange={(value) =>
                  handleModelChange(inspectAgent.agentId, inspectAgent.sessionKey, value)
                }
                onThinkingChange={(value) =>
                  handleThinkingChange(inspectAgent.agentId, inspectAgent.sessionKey, value)
                }
                onToolCallingToggle={(enabled) =>
                  handleToolCallingToggle(inspectAgent.agentId, enabled)
                }
                onThinkingTracesToggle={(enabled) =>
                  handleThinkingTracesToggle(inspectAgent.agentId, enabled)
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default function Home() {
  return (
    <AgentStoreProvider>
      <AgentStudioPage />
    </AgentStoreProvider>
  );
}
