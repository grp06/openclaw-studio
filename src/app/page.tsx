"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// (ReactFlowInstance import removed)
import { CanvasFlow } from "@/features/canvas/components/CanvasFlow";
import { HeaderBar } from "@/features/canvas/components/HeaderBar";
import { MAX_TILE_HEIGHT, MIN_TILE_SIZE } from "@/lib/canvasTileDefaults";
import { screenToWorld, worldToScreen } from "@/features/canvas/lib/transform";
import { extractText } from "@/lib/text/extractText";
import { extractThinking, formatThinkingMarkdown } from "@/lib/text/extractThinking";
import { extractSummaryText } from "@/lib/text/summary";
import { isHeartbeatPrompt, isUiMetadataPrefix, stripUiMetadata } from "@/lib/text/uiMetadata";
import { useGatewayConnection } from "@/lib/gateway/useGatewayConnection";
import type { EventFrame } from "@/lib/gateway/frames";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import {
  AgentCanvasProvider,
  getActiveProject,
  useAgentCanvasStore,
} from "@/features/canvas/state/store";
import {
  type AgentEventPayload,
  type ChatEventPayload,
  getAgentSummaryPatch,
  getChatSummaryPatch,
} from "@/features/canvas/state/summary";
import {
  createProjectDiscordChannel,
  fetchProjectCleanupPreview,
  runProjectCleanup,
} from "@/lib/projects/client";
import { createRandomAgentName, normalizeAgentName } from "@/lib/names/agentNames";
import { buildAgentInstruction } from "@/lib/projects/message";
import { filterArchivedItems } from "@/lib/projects/archive";
import type { AgentTile, ProjectRuntime } from "@/features/canvas/state/store";
import { logger } from "@/lib/logger";
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
    if (!text && !thinking) continue;
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
      if (text) {
        lines.push(text);
        lastAssistant = text;
      }
      lastRole = "assistant";
    }
  }
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return { lines: deduped, lastAssistant, lastRole, lastUser };
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
    if (line.startsWith("> ")) {
      merged.splice(cursor, 0, line);
      cursor += 1;
    }
  }
  return merged;
};

const findTileBySessionKey = (
  projects: ProjectRuntime[],
  sessionKey: string
): { projectId: string; tileId: string } | null => {
  for (const project of projects) {
    const tile = project.tiles.find((entry) => entry.sessionKey === sessionKey);
    if (tile) {
      return { projectId: project.id, tileId: tile.id };
    }
  }
  return null;
};

const findTileByRunId = (
  projects: ProjectRuntime[],
  runId: string
): { projectId: string; tileId: string } | null => {
  for (const project of projects) {
    const tile = project.tiles.find((entry) => entry.runId === runId);
    if (tile) {
      return { projectId: project.id, tileId: tile.id };
    }
  }
  return null;
};

const AgentCanvasPage = () => {
  const { client, status } = useGatewayConnection();

  const {
    state,
    dispatch,
    createTile,
    createOrOpenProject,
    deleteProject,
    restoreProject,
    deleteTile,
    restoreTile,
    renameTile,
    updateTile,
  } = useAgentCanvasStore();
  const activeProject = getActiveProject(state);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showOpenProjectForm, setShowOpenProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectWarnings, setProjectWarnings] = useState<string[]>([]);
  const [openProjectWarnings, setOpenProjectWarnings] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const summaryRefreshRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  // flowInstance removed (zoom controls live in the bottom-right ReactFlow Controls).

  const visibleProjects = useMemo(
    () => filterArchivedItems(state.projects, showArchived),
    [state.projects, showArchived]
  );
  const hasArchivedTiles = useMemo(
    () => state.projects.some((entry) => entry.tiles.some((tile) => tile.archivedAt)),
    [state.projects]
  );
  const project = useMemo(() => {
    if (activeProject && (showArchived || !activeProject.archivedAt)) {
      return activeProject;
    }
    return visibleProjects[0] ?? null;
  }, [activeProject, showArchived, visibleProjects]);
  const tiles = useMemo(
    () => filterArchivedItems(project?.tiles ?? [], showArchived),
    [project?.tiles, showArchived]
  );
  const errorMessage = state.error ?? gatewayModelsError;

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

  const computeNewTilePosition = useCallback(
    (tileSize: { width: number; height: number }) => {
      if (!project) {
        return { x: 80, y: 200 };
      }

      if (viewportSize.width === 0 || viewportSize.height === 0) {
        const offset = project.tiles.length * 36;
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
        return project.tiles.some((tile) =>
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
    [project, state.canvas, viewportSize]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    const projects = stateRef.current.projects;
    const tiles = projects.flatMap((entry) => entry.tiles);
    const sessionKeys = Array.from(
      new Set(
        tiles
          .map((tile) => tile.sessionKey)
          .filter((key): key is string => typeof key === "string" && key.trim())
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
      for (const project of projects) {
        for (const tile of project.tiles) {
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
              patch.latestPreview = extractSummaryText(cleaned);
            }
            if (lastUser?.text) {
              patch.lastUserMessage = stripUiMetadata(lastUser.text);
            }
          }
          if (Object.keys(patch).length > 0) {
            dispatch({
              type: "updateTile",
              projectId: project.id,
              tileId: tile.id,
              patch,
            });
          }
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
  }, [client, loadSummarySnapshot, status]);

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
    if (showArchived) return;
    if (activeProject && activeProject.archivedAt) {
      const fallback = state.projects.find((entry) => !entry.archivedAt) ?? null;
      if ((fallback?.id ?? null) !== state.activeProjectId) {
        dispatch({ type: "setActiveProject", projectId: fallback?.id ?? null });
      }
    }
  }, [activeProject, dispatch, showArchived, state.activeProjectId, state.projects]);

  useEffect(() => {
    if (!state.selectedTileId) return;
    if (tiles.some((tile) => tile.id === state.selectedTileId)) return;
    dispatch({ type: "selectTile", tileId: null });
  }, [dispatch, state.selectedTileId, tiles]);

  const handleNewAgent = useCallback(async () => {
    if (!project || project.archivedAt) return;
    const name = createRandomAgentName();
    const result = await createTile(project.id, name, "coding");
    if (!result) return;

    const nextPosition = computeNewTilePosition(result.tile.size);
    dispatch({
      type: "updateTile",
      projectId: project.id,
      tileId: result.tile.id,
      patch: { position: nextPosition },
    });
    dispatch({ type: "selectTile", tileId: result.tile.id });
  }, [computeNewTilePosition, createTile, dispatch, project]);

  const loadTileHistory = useCallback(
    async (projectId: string, tileId: string) => {
      const currentProject = stateRef.current.projects.find(
        (entry) => entry.id === projectId
      );
      const tile = currentProject?.tiles.find((entry) => entry.id === tileId);
      const sessionKey = tile?.sessionKey?.trim();
      if (!tile || !sessionKey) return;
      if (historyInFlightRef.current.has(sessionKey)) return;

      historyInFlightRef.current.add(sessionKey);
      try {
        const result = await client.call<ChatHistoryResult>("chat.history", {
          sessionKey,
          limit: 200,
        });
        const { lines, lastAssistant, lastRole, lastUser } = buildHistoryLines(
          result.messages ?? []
        );
        if (lines.length === 0) return;
        const currentLines = tile.outputLines;
        const mergedLines = mergeHistoryWithPending(lines, currentLines);
        const isSame =
          mergedLines.length === currentLines.length &&
          mergedLines.every((line, index) => line === currentLines[index]);
        if (isSame) {
          if (!tile.runId && tile.status === "running" && lastRole === "assistant") {
            dispatch({
              type: "updateTile",
              projectId,
              tileId,
              patch: { status: "idle", runId: null, streamText: null, thinkingTrace: null },
            });
          }
          return;
        }
        const patch: Partial<AgentTile> = {
          outputLines: mergedLines,
          lastResult: lastAssistant ?? null,
          ...(lastAssistant ? { latestPreview: lastAssistant } : {}),
          ...(lastUser ? { lastUserMessage: lastUser } : {}),
        };
        if (!tile.runId && tile.status === "running" && lastRole === "assistant") {
          patch.status = "idle";
          patch.runId = null;
          patch.streamText = null;
          patch.thinkingTrace = null;
        }
        dispatch({
          type: "updateTile",
          projectId,
          tileId,
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

  const handleLoadHistory = useCallback(
    async (tileId: string) => {
      if (!project) return;
      await loadTileHistory(project.id, tileId);
    },
    [loadTileHistory, project]
  );

  const handleSend = useCallback(
    async (tileId: string, sessionKey: string, message: string) => {
      if (!project) return;
      const trimmed = message.trim();
      if (!trimmed) return;
      const isResetCommand = /^\/(reset|new)(\s|$)/i.test(trimmed);
      const runId = crypto.randomUUID();
      const tile = project.tiles.find((entry) => entry.id === tileId);
      if (!tile) {
        dispatch({
          type: "appendOutput",
          projectId: project.id,
          tileId,
          line: "Error: Tile not found.",
        });
        return;
      }
      if (isResetCommand) {
        dispatch({
          type: "updateTile",
          projectId: project.id,
          tileId,
          patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null },
        });
      }
      dispatch({
        type: "updateTile",
        projectId: project.id,
        tileId,
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
        projectId: project.id,
        tileId,
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
            type: "updateTile",
            projectId: project.id,
            tileId,
            patch: { sessionSettingsSynced: true },
          });
        }
        await client.call("chat.send", {
          sessionKey,
          message: buildAgentInstruction({
            worktreePath: tile.workspacePath,
            repoPath: project.repoPath,
            message: trimmed,
          }),
          deliver: false,
          idempotencyKey: runId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gateway error";
        dispatch({
          type: "updateTile",
          projectId: project.id,
          tileId,
          patch: { status: "error", runId: null, streamText: null, thinkingTrace: null },
        });
        dispatch({
          type: "appendOutput",
          projectId: project.id,
          tileId,
          line: `Error: ${msg}`,
        });
      }
    },
    [client, dispatch, project]
  );

  const handleModelChange = useCallback(
    async (tileId: string, sessionKey: string, value: string | null) => {
      if (!project) return;
      dispatch({
        type: "updateTile",
        projectId: project.id,
        tileId,
        patch: { model: value, sessionSettingsSynced: false },
      });
      try {
        await client.call("sessions.patch", {
          key: sessionKey,
          model: value ?? null,
        });
        dispatch({
          type: "updateTile",
          projectId: project.id,
          tileId,
          patch: { sessionSettingsSynced: true },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set model.";
        dispatch({
          type: "appendOutput",
          projectId: project.id,
          tileId,
          line: `Model update failed: ${msg}`,
        });
      }
    },
    [client, dispatch, project]
  );

  const handleThinkingChange = useCallback(
    async (tileId: string, sessionKey: string, value: string | null) => {
      if (!project) return;
      dispatch({
        type: "updateTile",
        projectId: project.id,
        tileId,
        patch: { thinkingLevel: value, sessionSettingsSynced: false },
      });
      try {
        await client.call("sessions.patch", {
          key: sessionKey,
          thinkingLevel: value ?? null,
        });
        dispatch({
          type: "updateTile",
          projectId: project.id,
          tileId,
          patch: { sessionSettingsSynced: true },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to set thinking level.";
        dispatch({
          type: "appendOutput",
          projectId: project.id,
          tileId,
          line: `Thinking update failed: ${msg}`,
        });
      }
    },
    [client, dispatch, project]
  );

  useEffect(() => {
    return client.onEvent((event: EventFrame) => {
      if (event.event !== "chat") return;
      const payload = event.payload as ChatEventPayload | undefined;
      if (!payload?.sessionKey) return;
      const match = findTileBySessionKey(state.projects, payload.sessionKey);
      if (!match) return;

      const project = state.projects.find((entry) => entry.id === match.projectId);
      const tile = project?.tiles.find((entry) => entry.id === match.tileId);
      const summaryPatch = getChatSummaryPatch(payload);
      if (summaryPatch) {
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
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
      const summaryText =
        typeof nextText === "string" ? extractSummaryText(nextText) : null;
      const nextThinking = extractThinking(payload.message);
      if (payload.state === "delta") {
        if (typeof nextTextRaw === "string" && isUiMetadataPrefix(nextTextRaw.trim())) {
          return;
        }
        if (nextThinking) {
          dispatch({
            type: "updateTile",
            projectId: match.projectId,
            tileId: match.tileId,
            patch: { thinkingTrace: nextThinking, status: "running" },
          });
        }
        if (typeof nextText === "string") {
          dispatch({
            type: "setStream",
            projectId: match.projectId,
            tileId: match.tileId,
            value: nextText,
          });
          dispatch({
            type: "updateTile",
            projectId: match.projectId,
            tileId: match.tileId,
            patch: { status: "running" },
          });
        }
        return;
      }

      if (payload.state === "final") {
        const thinkingText = nextThinking ?? tile?.thinkingTrace ?? null;
        const thinkingLine = thinkingText ? formatThinkingMarkdown(thinkingText) : "";
        if (thinkingLine) {
          dispatch({
            type: "appendOutput",
            projectId: match.projectId,
            tileId: match.tileId,
            line: thinkingLine,
          });
        }
        if (typeof nextText === "string") {
          dispatch({
            type: "appendOutput",
            projectId: match.projectId,
            tileId: match.tileId,
            line: nextText,
          });
          dispatch({
            type: "updateTile",
            projectId: match.projectId,
            tileId: match.tileId,
            patch: { lastResult: summaryText || nextText },
          });
        }
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { streamText: null, thinkingTrace: null },
        });
        return;
      }

      if (payload.state === "aborted") {
        dispatch({
          type: "appendOutput",
          projectId: match.projectId,
          tileId: match.tileId,
          line: "Run aborted.",
        });
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { streamText: null, thinkingTrace: null },
        });
        return;
      }

      if (payload.state === "error") {
        dispatch({
          type: "appendOutput",
          projectId: match.projectId,
          tileId: match.tileId,
          line: payload.errorMessage ? `Error: ${payload.errorMessage}` : "Run error.",
        });
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { streamText: null, thinkingTrace: null },
        });
      }
    });
  }, [client, dispatch, state.projects]);

  useEffect(() => {
    return client.onEvent((event: EventFrame) => {
      if (event.event !== "agent") return;
      const payload = event.payload as AgentEventPayload | undefined;
      if (!payload?.runId) return;
      const summaryPatch = getAgentSummaryPatch(payload);
      if (!summaryPatch) return;
      const directMatch = payload.sessionKey
        ? findTileBySessionKey(state.projects, payload.sessionKey)
        : null;
      const match = directMatch ?? findTileByRunId(state.projects, payload.runId);
      if (!match) return;
      const project = state.projects.find((entry) => entry.id === match.projectId);
      const tile = project?.tiles.find((entry) => entry.id === match.tileId);
      if (!tile) return;
      const phase = typeof payload.data?.phase === "string" ? payload.data.phase : "";
      if (phase === "start") {
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { status: "running", runId: payload.runId, lastActivityAt: summaryPatch.lastActivityAt ?? null },
        });
        return;
      }
      if (phase === "end") {
        if (tile.runId && tile.runId !== payload.runId) return;
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
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
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
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
  }, [client, dispatch, state.projects]);

  // Zoom controls are available in the bottom-right of the canvas.

  const handleProjectCreate = useCallback(async () => {
    if (!projectName.trim()) {
      setProjectWarnings(["Workspace name is required."]);
      return;
    }
    const result = await createOrOpenProject({ name: projectName.trim() });
    if (!result) return;
    setProjectWarnings(result.warnings);
    setProjectName("");
    setShowProjectForm(false);
  }, [createOrOpenProject, projectName]);

  const handleProjectOpen = useCallback(async () => {
    if (!projectPath.trim()) {
      setOpenProjectWarnings(["Workspace path is required."]);
      return;
    }
    const result = await createOrOpenProject({ path: projectPath.trim() });
    if (!result) return;
    setOpenProjectWarnings(result.warnings);
    setProjectPath("");
    setShowOpenProjectForm(false);
  }, [createOrOpenProject, projectPath]);

  const handleProjectDelete = useCallback(async () => {
    if (!project) return;
    if (project.archivedAt) {
      const result = await restoreProject(project.id);
      if (result?.warnings.length) {
        window.alert(result.warnings.join("\n"));
      }
      return;
    }
    const confirmation = window.prompt(
      `Type ARCHIVE ${project.name} to confirm workspace archive.`
    );
    if (confirmation !== `ARCHIVE ${project.name}`) {
      return;
    }
    const result = await deleteProject(project.id);
    if (result?.warnings.length) {
      window.alert(result.warnings.join("\n"));
    }
  }, [deleteProject, project, restoreProject]);

  const handleCleanupArchived = useCallback(async () => {
    try {
      const preview = await fetchProjectCleanupPreview();
      if (preview.items.length === 0) {
        window.alert("No archived agents to clean.");
        return;
      }
      const confirmation = window.prompt(
        `Type CLEAN ARCHIVED to remove ${preview.items.length} archived agents.`
      );
      if (confirmation !== "CLEAN ARCHIVED") return;
      const result = await runProjectCleanup({
        tileIds: preview.items.map((item) => item.tileId),
      });
      dispatch({ type: "loadStore", store: result.store });
      if (result.warnings.length) {
        window.alert(result.warnings.join("\n"));
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to clean archived agents.";
      window.alert(message);
    }
  }, [dispatch]);

  const handleCreateDiscordChannel = useCallback(async () => {
    if (!project || project.archivedAt) return;
    if (!state.selectedTileId) {
      window.alert("Select an agent tile first.");
      return;
    }
    const tile = project.tiles.find((entry) => entry.id === state.selectedTileId);
    if (!tile) {
      window.alert("Selected agent not found.");
      return;
    }
    try {
      const result = await createProjectDiscordChannel(project.id, {
        agentId: tile.agentId,
        agentName: tile.name,
      });
      const notice = `Created Discord channel #${result.channelName} for ${tile.name}.`;
      if (result.warnings.length) {
        window.alert(`${notice}\n${result.warnings.join("\n")}`);
      } else {
        window.alert(notice);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create Discord channel.";
      window.alert(message);
    }
  }, [project, state.selectedTileId]);

  const handleTileDelete = useCallback(
    async (tileId: string) => {
      if (!project) return;
      const tile = project.tiles.find((entry) => entry.id === tileId);
      if (!tile) return;
      const result = tile.archivedAt
        ? await restoreTile(project.id, tileId)
        : await deleteTile(project.id, tileId);
      if (result?.warnings.length) {
        window.alert(result.warnings.join("\n"));
      }
    },
    [deleteTile, project, restoreTile]
  );

  const handleAvatarShuffle = useCallback(
    async (tileId: string) => {
      if (!project) return;
      const avatarSeed = crypto.randomUUID();
      const result = await updateTile(project.id, tileId, { avatarSeed });
      if (!result) return;
      if ("error" in result) {
        window.alert(result.error);
        return;
      }
      if (result.warnings.length > 0) {
        window.alert(result.warnings.join("\n"));
      }
    },
    [project, updateTile]
  );

  const handleNameShuffle = useCallback(
    async (tileId: string) => {
      if (!project) return;
      const name = createRandomAgentName();
      const result = await renameTile(project.id, tileId, normalizeAgentName(name));
      if (!result) return;
      if ("error" in result) {
        window.alert(result.error);
        return;
      }
      if (result.warnings.length > 0) {
        window.alert(result.warnings.join("\n"));
      }
    },
    [project, renameTile]
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasFlow
        tiles={tiles}
        projectId={project?.id ?? null}
        transform={state.canvas}
        viewportRef={viewportRef}
        selectedTileId={state.selectedTileId}
        canSend={status === "connected"}
        models={gatewayModels}
        onSelectTile={(id) => dispatch({ type: "selectTile", tileId: id })}
        onMoveTile={(id, position) =>
          project
            ? dispatch({
                type: "updateTile",
                projectId: project.id,
                tileId: id,
                patch: { position },
              })
            : null
        }
        onResizeTile={(id, size) =>
          project
            ? dispatch({
                type: "updateTile",
                projectId: project.id,
                tileId: id,
                patch: {
                  size: {
                    height: Math.min(
                      MAX_TILE_HEIGHT,
                      Math.max(size.height, MIN_TILE_SIZE.height)
                    ),
                    width: Math.max(size.width, MIN_TILE_SIZE.width),
                  },
                },
              })
            : null
        }
        onDeleteTile={handleTileDelete}
        onLoadHistory={handleLoadHistory}
        onRenameTile={(id, name) => {
          if (!project) return Promise.resolve(false);
          return renameTile(project.id, id, name).then((result) => {
            if (!result) return false;
            if ("error" in result) {
              window.alert(result.error);
              return false;
            }
            if (result.warnings.length > 0) {
              window.alert(result.warnings.join("\n"));
            }
            return true;
          });
        }}
        onDraftChange={(id, value) =>
          project
            ? dispatch({
                type: "updateTile",
                projectId: project.id,
                tileId: id,
                patch: { draft: value },
              })
            : null
        }
        onSend={handleSend}
        onModelChange={handleModelChange}
        onThinkingChange={handleThinkingChange}
        onAvatarShuffle={handleAvatarShuffle}
        onNameShuffle={handleNameShuffle}
        onUpdateTransform={(patch) => dispatch({ type: "setCanvas", patch })}
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-4 p-6">
        <div className="pointer-events-auto mx-auto w-full max-w-6xl">
          <HeaderBar
            projects={visibleProjects.map((entry) => ({
              id: entry.id,
              name: entry.name,
              archivedAt: entry.archivedAt,
            }))}
            activeProjectId={project?.id ?? null}
            status={status}
            onProjectChange={(projectId) =>
              dispatch({
                type: "setActiveProject",
                projectId: projectId.trim() ? projectId : null,
              })
            }
            onCreateProject={() => {
              setProjectWarnings([]);
              setOpenProjectWarnings([]);
              setShowOpenProjectForm(false);
              setShowProjectForm((prev) => !prev);
            }}
            onOpenProject={() => {
              setProjectWarnings([]);
              setOpenProjectWarnings([]);
              setShowProjectForm(false);
              setShowOpenProjectForm((prev) => !prev);
            }}
            onDeleteProject={handleProjectDelete}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((prev) => !prev)}
            activeProjectArchived={Boolean(project?.archivedAt)}
            onNewAgent={handleNewAgent}
            onCreateDiscordChannel={handleCreateDiscordChannel}
            canCreateDiscordChannel={Boolean(
              project && tiles.length > 0 && !project.archivedAt
            )}
            onCleanupArchived={handleCleanupArchived}
            canCleanupArchived={hasArchivedTiles}
          />
        </div>

        {state.loading ? (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="glass-panel px-6 py-6 text-muted-foreground">
              Loading workspaces…
            </div>
          </div>
        ) : null}

        {showProjectForm ? (
          <div className="pointer-events-auto mx-auto w-full max-w-5xl">
            <div className="glass-panel px-6 py-6">
              <div className="flex flex-col gap-4">
                <div className="grid gap-4">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Workspace name
                    <input
                      className="h-11 rounded-lg border border-input bg-background px-4 text-sm text-foreground outline-none"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleProjectCreate();
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                    type="button"
                    onClick={handleProjectCreate}
                  >
                    Create Workspace
                  </button>
                  <button
                    className="rounded-lg border border-input px-5 py-2 text-sm font-semibold text-foreground"
                    type="button"
                    onClick={() => setShowProjectForm(false)}
                  >
                    Cancel
                  </button>
                </div>
                {projectWarnings.length > 0 ? (
                  <div className="rounded-lg border border-border bg-accent px-4 py-2 text-sm text-accent-foreground">
                    {projectWarnings.join(" ")}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showOpenProjectForm ? (
          <div className="pointer-events-auto mx-auto w-full max-w-5xl">
            <div className="glass-panel px-6 py-6">
              <div className="flex flex-col gap-4">
                <div className="grid gap-4">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Workspace path
                    <input
                      className="h-11 rounded-lg border border-input bg-background px-4 text-sm text-foreground outline-none"
                      value={projectPath}
                      onChange={(event) => setProjectPath(event.target.value)}
                      placeholder="/Users/you/repos/my-workspace"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                    type="button"
                    onClick={handleProjectOpen}
                  >
                    Open Workspace
                  </button>
                  <button
                    className="rounded-lg border border-input px-5 py-2 text-sm font-semibold text-foreground"
                    type="button"
                    onClick={() => setShowOpenProjectForm(false)}
                  >
                    Cancel
                  </button>
                </div>
                {openProjectWarnings.length > 0 ? (
                  <div className="rounded-lg border border-border bg-accent px-4 py-2 text-sm text-accent-foreground">
                    {openProjectWarnings.join(" ")}
                  </div>
                ) : null}
              </div>
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

        {project ? null : (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="glass-panel px-6 py-8 text-muted-foreground">
              Create a workspace to begin.
            </div>
          </div>
        )}
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
