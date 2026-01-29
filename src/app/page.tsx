"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// (ReactFlowInstance import removed)
import { CanvasFlow } from "@/features/canvas/components/CanvasFlow";
import { HeaderBar } from "@/features/canvas/components/HeaderBar";
import { MAX_TILE_HEIGHT, MIN_TILE_SIZE } from "@/lib/canvasTileDefaults";
import { screenToWorld, worldToScreen } from "@/features/canvas/lib/transform";
import { extractText } from "@/lib/text/extractText";
import { extractThinking, formatThinkingMarkdown } from "@/lib/text/extractThinking";
import { useGatewayConnection } from "@/lib/gateway/useGatewayConnection";
import type { EventFrame } from "@/lib/gateway/frames";
import {
  AgentCanvasProvider,
  getActiveProject,
  useAgentCanvasStore,
} from "@/features/canvas/state/store";
import { createProjectDiscordChannel } from "@/lib/projects/client";
import { createRandomAgentName, normalizeAgentName } from "@/lib/names/agentNames";
import type { AgentTile, ProjectRuntime } from "@/features/canvas/state/store";
// (CANVAS_BASE_ZOOM import removed)

type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

type AgentEventPayload = {
  runId: string;
  seq?: number;
  stream?: string;
  data?: Record<string, unknown>;
  sessionKey?: string;
};

const PROJECT_PROMPT_BLOCK_RE = /^(?:Project|Workspace) path:[\s\S]*?\n\s*\n/i;
const PROJECT_PROMPT_INLINE_RE = /^(?:Project|Workspace) path:[\s\S]*?memory_search\.\s*/i;
const RESET_PROMPT_RE =
  /^A new session was started via \/new or \/reset[\s\S]*?reasoning\.\s*/i;
const MESSAGE_ID_RE = /\s*\[message_id:[^\]]+\]\s*/gi;
const UI_METADATA_PREFIX_RE =
  /^(?:Project path:|Workspace path:|A new session was started via \/new or \/reset)/i;
const HEARTBEAT_PROMPT_RE = /^Read HEARTBEAT\.md if it exists\b/i;
const HEARTBEAT_PATH_RE = /Heartbeat file path:/i;

const stripUiMetadata = (text: string) => {
  if (!text) return text;
  let cleaned = text.replace(RESET_PROMPT_RE, "");
  const beforeProjectStrip = cleaned;
  cleaned = cleaned.replace(PROJECT_PROMPT_INLINE_RE, "");
  if (cleaned === beforeProjectStrip) {
    cleaned = cleaned.replace(PROJECT_PROMPT_BLOCK_RE, "");
  }
  cleaned = cleaned.replace(MESSAGE_ID_RE, "").trim();
  return cleaned;
};

const isHeartbeatPrompt = (text: string) => {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return HEARTBEAT_PROMPT_RE.test(trimmed) || HEARTBEAT_PATH_RE.test(trimmed);
};

type ChatHistoryMessage = Record<string, unknown>;

type ChatHistoryResult = {
  sessionKey: string;
  sessionId?: string;
  messages: ChatHistoryMessage[];
  thinkingLevel?: string;
};

const buildHistoryLines = (messages: ChatHistoryMessage[]) => {
  const lines: string[] = [];
  let lastAssistant: string | null = null;
  let lastRole: string | null = null;
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
  return { lines: deduped, lastAssistant, lastRole };
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

const buildProjectMessage = (project: ProjectRuntime | null, message: string) => {
  const trimmed = message.trim();
  if (!project || !project.repoPath.trim()) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  return `Workspace path: ${project.repoPath}. Operate within this repository. You may also read/write your agent workspace files (IDENTITY.md, USER.md, HEARTBEAT.md, TOOLS.md, MEMORY.md). Use MEMORY.md or memory/*.md directly for durable memory; do not rely on memory_search.\n\n${trimmed}`;
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
    createProject,
    openProject,
    deleteProject,
    deleteTile,
    renameTile,
    updateTile,
  } = useAgentCanvasStore();
  const project = getActiveProject(state);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showOpenProjectForm, setShowOpenProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectWarnings, setProjectWarnings] = useState<string[]>([]);
  const [openProjectWarnings, setOpenProjectWarnings] = useState<string[]>([]);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const historyPollsRef = useRef<Map<string, number>>(new Map());
  const stateRef = useRef(state);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // flowInstance removed (zoom controls live in the bottom-right ReactFlow Controls).

  const tiles = useMemo(() => project?.tiles ?? [], [project?.tiles]);

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

  const handleNewAgent = useCallback(async () => {
    if (!project) return;
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
        const { lines, lastAssistant, lastRole } = buildHistoryLines(
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

  const startHistoryPolling = useCallback(
    (projectId: string, tileId: string) => {
      const pollKey = `${projectId}:${tileId}`;
      const existing = historyPollsRef.current.get(pollKey);
      if (existing) {
        window.clearTimeout(existing);
        historyPollsRef.current.delete(pollKey);
      }

      let attempts = 0;
      const maxAttempts = 40;
      const poll = async () => {
        historyPollsRef.current.delete(pollKey);
        attempts += 1;
        await loadTileHistory(projectId, tileId);
        const currentProject = stateRef.current.projects.find(
          (entry) => entry.id === projectId
        );
        const tile = currentProject?.tiles.find((entry) => entry.id === tileId);
        if (!tile || tile.status !== "running") {
          return;
        }
        if (attempts >= maxAttempts) {
          return;
        }
        const timeoutId = window.setTimeout(poll, 1000);
        historyPollsRef.current.set(pollKey, timeoutId);
      };

      const timeoutId = window.setTimeout(poll, 1000);
      historyPollsRef.current.set(pollKey, timeoutId);
    },
    [loadTileHistory]
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
        patch: { status: "running", runId, streamText: "", thinkingTrace: null, draft: "" },
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
          message: buildProjectMessage(project, trimmed),
          deliver: false,
          idempotencyKey: runId,
        });
        startHistoryPolling(project.id, tileId);
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
    [client, dispatch, project, startHistoryPolling]
  );

  useEffect(() => {
    const polls = historyPollsRef.current;
    return () => {
      for (const timeoutId of polls.values()) {
        window.clearTimeout(timeoutId);
      }
      polls.clear();
    };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    if (!project) return;
    const tilesToLoad = project.tiles.filter(
      (tile) => tile.outputLines.length === 0 && tile.sessionKey?.trim()
    );
    if (tilesToLoad.length === 0) return;
    let cancelled = false;
    const loadHistory = async () => {
      for (const tile of tilesToLoad) {
        if (cancelled) return;
        await loadTileHistory(project.id, tile.id);
      }
    };
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [loadTileHistory, project, status]);

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
      const role =
        payload.message && typeof payload.message === "object"
          ? (payload.message as Record<string, unknown>).role
          : null;
      if (role === "user") {
        return;
      }
      const nextTextRaw = extractText(payload.message);
      const nextText = nextTextRaw ? stripUiMetadata(nextTextRaw) : null;
      const nextThinking = extractThinking(payload.message);
      if (payload.state === "delta") {
        if (typeof nextTextRaw === "string" && UI_METADATA_PREFIX_RE.test(nextTextRaw.trim())) {
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
            patch: { lastResult: nextText },
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
      const directMatch = payload.sessionKey
        ? findTileBySessionKey(state.projects, payload.sessionKey)
        : null;
      const match = directMatch ?? findTileByRunId(state.projects, payload.runId);
      if (!match) return;
      if (payload.stream !== "lifecycle") return;
      const project = state.projects.find((entry) => entry.id === match.projectId);
      const tile = project?.tiles.find((entry) => entry.id === match.tileId);
      if (!tile) return;
      const phase = typeof payload.data?.phase === "string" ? payload.data.phase : "";
      if (phase === "start") {
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { status: "running", runId: payload.runId },
        });
        return;
      }
      if (phase === "end") {
        if (tile.runId && tile.runId !== payload.runId) return;
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { status: "idle", runId: null, streamText: null, thinkingTrace: null },
        });
        return;
      }
      if (phase === "error") {
        if (tile.runId && tile.runId !== payload.runId) return;
        dispatch({
          type: "updateTile",
          projectId: match.projectId,
          tileId: match.tileId,
          patch: { status: "error", runId: null, streamText: null, thinkingTrace: null },
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
    const result = await createProject(projectName.trim());
    if (!result) return;
    setProjectWarnings(result.warnings);
    setProjectName("");
    setShowProjectForm(false);
  }, [createProject, projectName]);

  const handleProjectOpen = useCallback(async () => {
    if (!projectPath.trim()) {
      setOpenProjectWarnings(["Workspace path is required."]);
      return;
    }
    const result = await openProject(projectPath.trim());
    if (!result) return;
    setOpenProjectWarnings(result.warnings);
    setProjectPath("");
    setShowOpenProjectForm(false);
  }, [openProject, projectPath]);

  const handleProjectDelete = useCallback(async () => {
    if (!project) return;
    const confirmation = window.prompt(
      `Type DELETE ${project.name} to confirm workspace deletion.`
    );
    if (confirmation !== `DELETE ${project.name}`) {
      return;
    }
    const result = await deleteProject(project.id);
    if (result?.warnings.length) {
      window.alert(result.warnings.join("\n"));
    }
  }, [deleteProject, project]);

  const handleCreateDiscordChannel = useCallback(async () => {
    if (!project) return;
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
      const result = await deleteTile(project.id, tileId);
      if (result?.warnings.length) {
        window.alert(result.warnings.join("\n"));
      }
    },
    [deleteTile, project]
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
            projects={state.projects.map((entry) => ({ id: entry.id, name: entry.name }))}
            activeProjectId={state.activeProjectId}
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
            onNewAgent={handleNewAgent}
            onCreateDiscordChannel={handleCreateDiscordChannel}
            canCreateDiscordChannel={Boolean(project && project.tiles.length > 0)}
          />
        </div>

        {state.loading ? (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="glass-panel px-6 py-6 text-slate-700">Loading workspaces…</div>
          </div>
        ) : null}

        {showProjectForm ? (
          <div className="pointer-events-auto mx-auto w-full max-w-5xl">
            <div className="glass-panel px-6 py-6">
              <div className="flex flex-col gap-4">
                <div className="grid gap-4">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Workspace name
                    <input
                      className="h-11 rounded-full border border-slate-300 bg-white/80 px-4 text-sm text-slate-900 outline-none"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white"
                    type="button"
                    onClick={handleProjectCreate}
                  >
                    Create Workspace
                  </button>
                  <button
                    className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700"
                    type="button"
                    onClick={() => setShowProjectForm(false)}
                  >
                    Cancel
                  </button>
                </div>
                {projectWarnings.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
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
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Workspace path
                    <input
                      className="h-11 rounded-full border border-slate-300 bg-white/80 px-4 text-sm text-slate-900 outline-none"
                      value={projectPath}
                      onChange={(event) => setProjectPath(event.target.value)}
                      placeholder="/Users/you/repos/my-workspace"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white"
                    type="button"
                    onClick={handleProjectOpen}
                  >
                    Open Workspace
                  </button>
                  <button
                    className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700"
                    type="button"
                    onClick={() => setShowOpenProjectForm(false)}
                  >
                    Cancel
                  </button>
                </div>
                {openProjectWarnings.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                    {openProjectWarnings.join(" ")}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {state.error ? (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {state.error}
            </div>
          </div>
        ) : null}

        {project ? null : (
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <div className="glass-panel px-6 py-8 text-slate-600">
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
