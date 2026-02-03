"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
// (ReactFlowInstance import removed)
import { CanvasFlow } from "@/features/canvas/components/CanvasFlow";
import { AgentInspectPanel } from "@/features/canvas/components/AgentInspectPanel";
import { HeaderBar } from "@/features/canvas/components/HeaderBar";
import { ConnectionPanel } from "@/features/canvas/components/ConnectionPanel";
import { MIN_TILE_SIZE } from "@/lib/canvasTileDefaults";
import { screenToWorld, worldToScreen } from "@/features/canvas/lib/transform";
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
  AgentCanvasProvider,
  getSelectedAgent,
  useAgentCanvasStore,
} from "@/features/canvas/state/store";
import {
  type AgentEventPayload,
  type ChatEventPayload,
  getAgentSummaryPatch,
  getChatSummaryPatch,
} from "@/features/canvas/state/summary";
import { fetchCronJobs } from "@/lib/projects/client";
import { createRandomAgentName, normalizeAgentName } from "@/lib/names/agentNames";
import type { AgentSeed, AgentTile, CanvasTransform } from "@/features/canvas/state/store";
import type { CronJobSummary } from "@/lib/projects/types";
import { logger } from "@/lib/logger";
import { renameGatewayAgent, deleteGatewayAgent } from "@/lib/gateway/agentConfig";
import {
  parseAgentIdFromSessionKey,
  buildAgentStudioSessionKey,
  isSameSessionKey,
} from "@/lib/gateway/sessionKeys";
import { buildAvatarDataUrl } from "@/lib/avatars/multiavatar";
import { fetchStudioSettings, updateStudioSettings } from "@/lib/studio/client";
import { resolveGatewayLayout, type StudioAgentLayout } from "@/lib/studio/settings";
import { BrushCleaning } from "lucide-react";
import { generateUUID } from "@/lib/gateway/openclaw/uuid";
// (CANVAS_BASE_ZOOM import removed)

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
const DEFAULT_TILE_GAP = { x: 48, y: 56 };

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding = 0
) => {
  const ax = a.x - padding;
  const ay = a.y - padding;
  const aw = a.width + padding * 2;
  const ah = a.height + padding * 2;
  const bx = b.x;
  const by = b.y;
  const bw = b.width;
  const bh = b.height;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
};

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

const buildMissingAgentLayouts = (params: {
  agentIds: string[];
  occupiedLayouts?: Record<string, StudioAgentLayout> | null;
  sizeByAgent?: Record<string, { width: number; height: number }>;
  avatarSeedByAgent?: Record<string, string | null>;
  viewportSize: { width: number; height: number };
  headerOffset: number;
  canvas: CanvasTransform;
  defaultSize?: { width: number; height: number };
}) => {
  const layouts: Record<string, StudioAgentLayout> = {};
  const occupiedLayouts = params.occupiedLayouts ?? {};
  const occupiedRects = Object.values(occupiedLayouts).map((entry) => ({
    x: entry.position.x,
    y: entry.position.y,
    width: entry.size.width,
    height: entry.size.height,
  }));
  const sizeByAgent = params.sizeByAgent ?? {};
  const avatarSeedByAgent = params.avatarSeedByAgent ?? {};
  const fallbackSize = params.defaultSize ?? MIN_TILE_SIZE;
  const zoom = params.canvas.zoom;
  const sizes = params.agentIds.map((agentId) => sizeByAgent[agentId] ?? fallbackSize);
  const maxWidth = Math.max(fallbackSize.width, ...sizes.map((size) => size.width));
  const maxHeight = Math.max(fallbackSize.height, ...sizes.map((size) => size.height));
  const stepX = maxWidth * zoom + DEFAULT_TILE_GAP.x;
  const stepY = maxHeight * zoom + DEFAULT_TILE_GAP.y;
  const safeX = 32;
  const safeY = Math.max(32, params.headerOffset + 24);
  const availableWidth =
    params.viewportSize.width > 0 ? params.viewportSize.width - safeX * 2 : stepX;
  const columns = Math.max(1, Math.floor((availableWidth + DEFAULT_TILE_GAP.x) / stepX));
  const isOccupied = (rect: { x: number; y: number; width: number; height: number }) =>
    occupiedRects.some((other) => rectsOverlap(rect, other, 24));

  let cursor = 0;
  for (const agentId of params.agentIds) {
    const size = sizeByAgent[agentId] ?? fallbackSize;
    while (true) {
      const col = cursor % columns;
      const row = Math.floor(cursor / columns);
      cursor += 1;
      const screen = {
        x: safeX + col * stepX,
        y: safeY + row * stepY,
      };
      const position = screenToWorld(params.canvas, screen);
      const rect = { x: position.x, y: position.y, width: size.width, height: size.height };
      if (isOccupied(rect)) continue;
      layouts[agentId] = {
        position,
        size: { width: size.width, height: size.height },
        avatarSeed: avatarSeedByAgent[agentId] ?? agentId,
      };
      occupiedRects.push(rect);
      break;
    }
  }
  return layouts;
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

const findAgentBySessionKey = (agents: AgentTile[], sessionKey: string): string | null => {
  const exact = agents.find((agent) => isSameSessionKey(agent.sessionKey, sessionKey));
  return exact ? exact.agentId : null;
};

const findAgentByRunId = (agents: AgentTile[], runId: string): string | null => {
  const match = agents.find((agent) => agent.runId === runId);
  return match ? match.agentId : null;
};

const AgentCanvasPage = () => {
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
    clearError,
  } = useGatewayConnection();

  const { state, dispatch, hydrateAgents, setError, setLoading } = useAgentCanvasStore();
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [heartbeatTick, setHeartbeatTick] = useState(0);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const summaryRefreshRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  const [inspectAgentId, setInspectAgentId] = useState<string | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const viewportSizeRef = useRef(viewportSize);
  const headerOffsetRef = useRef(headerOffset);
  const studioSessionIdRef = useRef<string>(generateUUID());
  const thinkingDebugRef = useRef<Set<string>>(new Set());
  const chatRunSeenRef = useRef<Set<string>>(new Set());
  const specialUpdateRef = useRef<Map<string, string>>(new Map());
  const specialUpdateInFlightRef = useRef<Set<string>>(new Set());
  const toolLinesSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const assistantStreamByRunRef = useRef<Map<string, string>>(new Map());
  // flowInstance removed (zoom controls live in the bottom-right ReactFlow Controls).

  const agents = state.agents;
  const selectedAgent = useMemo(() => getSelectedAgent(state), [state]);
  const inspectTile = useMemo(() => {
    if (!inspectAgentId) return null;
    return agents.find((entry) => entry.agentId === inspectAgentId) ?? null;
  }, [agents, inspectAgentId]);
  const faviconSeed = useMemo(() => {
    const firstTile = agents[0];
    const seed = firstTile?.avatarSeed ?? firstTile?.agentId ?? "";
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

  const resolveCronJobForTile = useCallback((jobs: CronJobSummary[], tile: AgentTile) => {
    if (!jobs.length) return null;
    const agentId = tile.agentId?.trim();
    const filtered = agentId ? jobs.filter((job) => job.agentId === agentId) : jobs;
    const active = filtered.length > 0 ? filtered : jobs;
    return [...active].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ?? null;
  }, []);

  const updateSpecialLatestUpdate = useCallback(
    async (agentId: string, tile: AgentTile, message: string) => {
      const key = agentId;
      const kind = resolveSpecialUpdateKind(message);
      if (!kind) {
        if (tile.latestOverride || tile.latestOverrideKind) {
          dispatch({
            type: "updateAgent",
            agentId: tile.agentId,
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
            tile.agentId?.trim() || parseAgentIdFromSessionKey(tile.sessionKey);
          if (!resolvedId) {
            dispatch({
              type: "updateAgent",
              agentId: tile.agentId,
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
              agentId: tile.agentId,
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
            agentId: tile.agentId,
            patch: {
              latestOverride: content || null,
              latestOverrideKind: content ? "heartbeat" : null,
            },
          });
          return;
        }
        const cronResult = await fetchCronJobs();
        const job = resolveCronJobForTile(cronResult.jobs, tile);
        const content = job ? buildCronDisplay(job) : "";
        dispatch({
          type: "updateAgent",
          agentId: tile.agentId,
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
    [client, dispatch, resolveCronJobForTile]
  );

  const refreshHeartbeatLatestUpdate = useCallback(() => {
    const agents = stateRef.current.agents;
    for (const tile of agents) {
      void updateSpecialLatestUpdate(tile.agentId, tile, "heartbeat");
    }
  }, [updateSpecialLatestUpdate]);

  const computeNewTilePosition = useCallback(
    (tileSize: { width: number; height: number }) => {
      if (agents.length === 0) {
        return { x: 80, y: 200 };
      }

      if (viewportSize.width === 0 || viewportSize.height === 0) {
        const offset = agents.length * 36;
        return { x: 80 + offset, y: 200 + offset };
      }

      const safeTop = 140;
      const edgePadding = 24;
      const step = 80;
      const maxRings = 12;
      const zoom = state.canvas.zoom;

      const effectiveSize = {
        width: Math.max(tileSize.width, MIN_TILE_SIZE.width),
        height: Math.max(tileSize.height, MIN_TILE_SIZE.height),
      };

      const minCenterY = safeTop + (effectiveSize.height * zoom) / 2;
      const screenCenter = {
        x: viewportSize.width / 2,
        y: Math.max(viewportSize.height / 2, minCenterY),
      };
      const worldCenter = screenToWorld(state.canvas, screenCenter);
      const base = {
        x: worldCenter.x - effectiveSize.width / 2,
        y: worldCenter.y - effectiveSize.height / 2,
      };

      const candidateFits = (candidate: { x: number; y: number }) => {
        const screen = worldToScreen(state.canvas, candidate);
        const tileWidth = effectiveSize.width * zoom;
        const tileHeight = effectiveSize.height * zoom;
        return (
          screen.x >= edgePadding &&
          screen.y >= safeTop &&
          screen.x + tileWidth <= viewportSize.width - edgePadding &&
          screen.y + tileHeight <= viewportSize.height - edgePadding
        );
      };

      const candidateOverlaps = (candidate: { x: number; y: number }) => {
        const rect = {
          x: candidate.x,
          y: candidate.y,
          width: effectiveSize.width,
          height: effectiveSize.height,
        };
        return agents.some((tile) =>
          rectsOverlap(
            rect,
            {
              x: tile.position.x,
              y: tile.position.y,
              width: Math.max(tile.size.width, MIN_TILE_SIZE.width),
              height: Math.max(tile.size.height, MIN_TILE_SIZE.height),
            },
            24
          )
        );
      };

      for (let ring = 0; ring <= maxRings; ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (let dy = -ring; dy <= ring; dy += 1) {
            if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) {
              continue;
            }
            const candidate = {
              x: base.x + dx * step,
              y: base.y + dy * step,
            };
            if (!candidateFits(candidate)) continue;
            if (!candidateOverlaps(candidate)) return candidate;
          }
        }
      }

      return base;
    },
    [agents, state.canvas, viewportSize]
  );

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
      const [agentsResult, settingsResult] = await Promise.all([
        client.call<AgentsListResult>("agents.list", {}),
        fetchStudioSettings().catch((err) => {
          logger.error("Failed to load studio settings.", err);
          return { settings: null } as { settings: null };
        }),
      ]);
      const sessionId = studioSessionIdRef.current || generateUUID();
      studioSessionIdRef.current = sessionId;
      const layout =
        settingsResult.settings && gatewayUrl
          ? resolveGatewayLayout(settingsResult.settings, gatewayUrl)?.agents ?? null
          : null;
      const missingAgentIds = agentsResult.agents
        .map((agent) => agent.id)
        .filter((agentId) => !layout?.[agentId]);
      const computedLayouts =
        missingAgentIds.length > 0
          ? buildMissingAgentLayouts({
              agentIds: missingAgentIds,
              occupiedLayouts: layout,
              viewportSize: viewportSizeRef.current,
              headerOffset: headerOffsetRef.current,
              canvas: stateRef.current.canvas,
            })
          : {};
      const seeds: AgentSeed[] = agentsResult.agents.map((agent, index) => {
        const layoutEntry = layout?.[agent.id] ?? computedLayouts[agent.id];
        const position = layoutEntry?.position ?? { x: 80 + index * 36, y: 200 + index * 36 };
        const size = layoutEntry?.size ?? MIN_TILE_SIZE;
        const avatarSeed = layoutEntry?.avatarSeed ?? agent.id;
        const avatarUrl = resolveAgentAvatarUrl(agent);
        const name = resolveAgentName(agent);
        return {
          agentId: agent.id,
          name,
          sessionKey: buildAgentStudioSessionKey(agent.id, sessionId),
          position,
          size,
          avatarSeed,
          avatarUrl,
        };
      });
      hydrateAgents(seeds);

      if (gatewayUrl.trim()) {
        const missingLayouts = computedLayouts;
        if (Object.keys(missingLayouts).length > 0) {
          await updateStudioSettings({
            layouts: {
              [gatewayUrl.trim()]: { agents: missingLayouts },
            },
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
    gatewayUrl,
    hydrateAgents,
    resolveAgentAvatarUrl,
    resolveAgentName,
    setError,
    setLoading,
    status,
  ]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    headerOffsetRef.current = headerOffset;
  }, [headerOffset]);

  useEffect(() => {
    if (status !== "connected") return;
    studioSessionIdRef.current = generateUUID();
  }, [gatewayUrl, status]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadAgents();
  }, [gatewayUrl, loadAgents, status]);

  useEffect(() => {
    if (status === "disconnected") {
      setLoading(false);
    }
  }, [setLoading, status]);

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const update = () => {
      setHeaderOffset(node.offsetHeight || 0);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inspectAgentId) return;
    if (state.selectedAgentId && state.selectedAgentId !== inspectAgentId) {
      setInspectAgentId(null);
    }
  }, [inspectAgentId, state.selectedAgentId]);

  useEffect(() => {
    if (inspectAgentId && !inspectTile) {
      setInspectAgentId(null);
    }
  }, [inspectAgentId, inspectTile]);

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
    const tiles = stateRef.current.agents;
    const sessionKeys = Array.from(
      new Set(
        tiles
          .map((tile) => tile.sessionKey)
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
      for (const tile of tiles) {
        const patch: Partial<AgentTile> = {};
        const activity = activityByKey.get(tile.sessionKey);
        if (typeof activity === "number") {
          patch.lastActivityAt = activity;
        }
        const preview = previewMap.get(tile.sessionKey);
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
            agentId: tile.agentId,
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
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!state.selectedAgentId) return;
    if (agents.some((tile) => tile.agentId === state.selectedAgentId)) return;
    dispatch({ type: "selectAgent", agentId: null });
  }, [agents, dispatch, state.selectedAgentId]);

  useEffect(() => {
    for (const tile of agents) {
      const lastMessage = tile.lastUserMessage?.trim() ?? "";
      const kind = resolveSpecialUpdateKind(lastMessage);
      const key = tile.agentId;
      const marker = kind === "heartbeat" ? `${lastMessage}:${heartbeatTick}` : lastMessage;
      const previous = specialUpdateRef.current.get(key);
      if (previous === marker) continue;
      specialUpdateRef.current.set(key, marker);
      void updateSpecialLatestUpdate(tile.agentId, tile, lastMessage);
    }
  }, [agents, heartbeatTick, updateSpecialLatestUpdate]);

  const loadTileHistory = useCallback(
    async (agentId: string) => {
      const tile = stateRef.current.agents.find((entry) => entry.agentId === agentId);
      const sessionKey = tile?.sessionKey?.trim();
      if (!tile || !sessionKey) return;
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
        const currentLines = tile.outputLines;
        const mergedLines = mergeHistoryWithPending(lines, currentLines);
        const isSame =
          mergedLines.length === currentLines.length &&
          mergedLines.every((line, index) => line === currentLines[index]);
        if (isSame) {
          const patch: Partial<AgentTile> = { historyLoadedAt: loadedAt };
          if (!tile.runId && tile.status === "running" && lastRole === "assistant") {
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
        const patch: Partial<AgentTile> = {
          outputLines: mergedLines,
          lastResult: lastAssistant ?? null,
          ...(lastAssistant ? { latestPreview: lastAssistant } : {}),
          ...(lastUser ? { lastUserMessage: lastUser } : {}),
          historyLoadedAt: loadedAt,
        };
        if (!tile.runId && tile.status === "running" && lastRole === "assistant") {
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

  const handleInspectTile = useCallback(
    (agentId: string) => {
      setInspectAgentId(agentId);
      dispatch({ type: "selectAgent", agentId });
    },
    [dispatch]
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) return;
      const confirmed = window.confirm(
        `Delete ${tile.name}? This removes the agent from the gateway config.`
      );
      if (!confirmed) return;
      try {
        await deleteGatewayAgent({
          client,
          agentId,
          sessionKey: tile.sessionKey,
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

  const shouldAutoLoadHistory = useCallback((tile: AgentTile) => {
    if (!tile.sessionKey?.trim()) return false;
    return !tile.historyLoadedAt;
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    for (const tile of agents) {
      if (!shouldAutoLoadHistory(tile)) continue;
      void loadTileHistory(tile.agentId);
    }
  }, [agents, loadTileHistory, shouldAutoLoadHistory, status]);

  const handleSend = useCallback(
    async (agentId: string, sessionKey: string, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const isResetCommand = /^\/(reset|new)(\s|$)/i.test(trimmed);
      const runId = crypto.randomUUID();
      assistantStreamByRunRef.current.delete(runId);
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) {
        dispatch({
          type: "appendOutput",
          agentId,
          line: "Error: Tile not found.",
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
          throw new Error("Missing session key for tile.");
        }
        if (!tile.sessionSettingsSynced) {
          await client.call("sessions.patch", {
            key: sessionKey,
            model: tile.model ?? null,
            thinkingLevel: tile.thinkingLevel ?? null,
          });
          dispatch({
            type: "updateAgent",
            agentId,
            patch: { sessionSettingsSynced: true },
          });
        }
        await client.call("chat.send", {
          sessionKey,
          message: buildAgentInstruction({ message: trimmed }),
          deliver: false,
          idempotencyKey: runId,
        });
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
    [client, dispatch]
  );

  const handleThinkingChange = useCallback(
    async (agentId: string, sessionKey: string, value: string | null) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { thinkingLevel: value, sessionSettingsSynced: false },
      });
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
    [client, dispatch]
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
      const tile = state.agents.find((entry) => entry.agentId === agentId);
      const summaryPatch = getChatSummaryPatch(payload);
      if (summaryPatch) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: summaryPatch,
        });
      }
      const role =
        payload.message && typeof payload.message === "object"
          ? (payload.message as Record<string, unknown>).role
          : null;
      if (role === "user") {
        return;
      }
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
        const thinkingText = nextThinking ?? tile?.thinkingTrace ?? null;
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
          tile &&
          !tile.outputLines.some((line) => isTraceMarkdown(line.trim()))
        ) {
          void loadTileHistory(agentId);
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
        if (tile?.lastUserMessage && !tile.latestOverride) {
          void updateSpecialLatestUpdate(agentId, tile, tile.lastUserMessage);
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
    loadTileHistory,
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
      const tile = state.agents.find((entry) => entry.agentId === match);
      if (!tile) return;
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
        const patch: Partial<AgentTile> = {
          status: "running",
          runId: payload.runId,
          lastActivityAt: Date.now(),
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
            if (!hasChatEvents || !tile.streamText?.trim()) {
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
          },
        });
        return;
      }
      if (phase === "end") {
        if (tile.runId && tile.runId !== payload.runId) return;
        assistantStreamByRunRef.current.delete(payload.runId);
        if (!hasChatEvents) {
          const finalText = tile.streamText?.trim();
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
        if (tile.runId && tile.runId !== payload.runId) return;
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

  // Zoom controls are available in the bottom-right of the canvas.

  const persistAgentLayout = useCallback(
    async (
      agentId: string,
      layout: {
        position: { x: number; y: number };
        size: { width: number; height: number };
        avatarSeed?: string | null;
      }
    ) => {
      if (!gatewayUrl.trim()) return;
      try {
        await updateStudioSettings({
          layouts: {
            [gatewayUrl.trim()]: { agents: { [agentId]: layout } },
          },
        });
      } catch (err) {
        logger.error("Failed to save agent layout.", err);
      }
    },
    [gatewayUrl]
  );

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) return false;
      try {
        await renameGatewayAgent({
          client,
          agentId,
          name,
          sessionKey: tile.sessionKey,
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
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) return;
      const avatarSeed = crypto.randomUUID();
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { avatarSeed },
      });
      await persistAgentLayout(agentId, {
        position: tile.position,
        size: tile.size,
        avatarSeed,
      });
    },
    [agents, dispatch, persistAgentLayout]
  );

  const handleNameShuffle = useCallback(
    async (agentId: string) => {
      const name = normalizeAgentName(createRandomAgentName());
      if (!name) return;
      await handleRenameAgent(agentId, name);
    },
    [handleRenameAgent]
  );

  const handleCleanUpLayout = useCallback(async () => {
    if (!gatewayUrl.trim()) return;
    if (agents.length === 0) return;
    const sizeByAgent: Record<string, { width: number; height: number }> = {};
    const avatarSeedByAgent: Record<string, string | null> = {};
    const agentIds = agents.map((tile) => {
      sizeByAgent[tile.agentId] = { width: tile.size.width, height: tile.size.height };
      avatarSeedByAgent[tile.agentId] = tile.avatarSeed ?? null;
      return tile.agentId;
    });
    const layouts = buildMissingAgentLayouts({
      agentIds,
      viewportSize: viewportSizeRef.current,
      headerOffset: headerOffsetRef.current,
      canvas: stateRef.current.canvas,
      sizeByAgent,
      avatarSeedByAgent,
    });
    if (Object.keys(layouts).length === 0) return;
    for (const [agentId, layout] of Object.entries(layouts)) {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          position: layout.position,
          size: layout.size,
        },
      });
    }
    try {
      await updateStudioSettings({
        layouts: {
          [gatewayUrl.trim()]: { agents: layouts },
        },
      });
    } catch (err) {
      logger.error("Failed to save clean-up layout.", err);
    }
  }, [agents, dispatch, gatewayUrl, updateStudioSettings]);

  const handleMoveTile = useCallback(
    (agentId: string, position: { x: number; y: number }) => {
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) return;
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { position },
      });
      void persistAgentLayout(agentId, {
        position,
        size: tile.size,
        avatarSeed: tile.avatarSeed ?? null,
      });
    },
    [agents, dispatch, persistAgentLayout]
  );

  const handleResizeTile = useCallback(
    (agentId: string, size: { width: number; height: number }) => {
      const tile = agents.find((entry) => entry.agentId === agentId);
      if (!tile) return;
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { size },
      });
      void persistAgentLayout(agentId, {
        position: tile.position,
        size,
        avatarSeed: tile.avatarSeed ?? null,
      });
    },
    [agents, dispatch, persistAgentLayout]
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
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasFlow
        tiles={agents}
        transform={state.canvas}
        viewportRef={viewportRef}
        selectedTileId={state.selectedAgentId}
        canSend={status === "connected"}
        onSelectTile={(id) => dispatch({ type: "selectAgent", agentId: id })}
        onMoveTile={handleMoveTile}
        onResizeTile={handleResizeTile}
        onRenameTile={handleRenameAgent}
        onDraftChange={handleDraftChange}
        onSend={handleSend}
        onAvatarShuffle={handleAvatarShuffle}
        onNameShuffle={handleNameShuffle}
        onInspectTile={handleInspectTile}
        onUpdateTransform={(patch) => dispatch({ type: "setCanvas", patch })}
      />

      {inspectTile ? (
        <div
          style={
            {
              "--header-offset": `${headerOffset}px`,
            } as CSSProperties
          }
        >
          <AgentInspectPanel
            key={inspectTile.agentId}
            tile={inspectTile}
            client={client}
            models={gatewayModels}
            onClose={() => setInspectAgentId(null)}
            onDelete={() => handleDeleteAgent(inspectTile.agentId)}
            onModelChange={(value) =>
              handleModelChange(inspectTile.agentId, inspectTile.sessionKey, value)
            }
            onThinkingChange={(value) =>
              handleThinkingChange(inspectTile.agentId, inspectTile.sessionKey, value)
            }
          />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-4 p-6">
        <div ref={headerRef} className="pointer-events-auto mx-auto w-full max-w-4xl">
          <HeaderBar
            status={status}
            gatewayUrl={gatewayUrl}
            agentCount={agents.length}
            onConnectionSettings={() => setShowConnectionPanel((prev) => !prev)}
          />
        </div>

        {state.loading ? (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="glass-panel px-6 py-6 text-muted-foreground">
              Loading agents…
            </div>
          </div>
        ) : null}

        {connectionPanelVisible ? (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
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
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="rounded-lg border border-destructive bg-destructive px-4 py-2 text-sm text-destructive-foreground">
              {errorMessage}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-auto mt-auto flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-input bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:border-ring disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleCleanUpLayout()}
            disabled={agents.length === 0 || status !== "connected"}
          >
            <BrushCleaning className="h-4 w-4" aria-hidden="true" />
            Clean up
          </button>
        </div>

      </div>
    </div>
  );
};

export default function Home() {
  return (
    <AgentCanvasProvider>
      <AgentCanvasPage />
    </AgentCanvasProvider>
  );
}
