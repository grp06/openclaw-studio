import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentTile as AgentTileType, TileSize } from "@/features/canvas/state/store";
import { isTraceMarkdown, stripTraceMarkdown } from "@/lib/text/extractThinking";
import { extractSummaryText } from "@/lib/text/summary";
import { normalizeAgentName } from "@/lib/names/agentNames";
import { Settings, Shuffle } from "lucide-react";
import {
  fetchProjectTileHeartbeat,
  fetchProjectTileWorkspaceFiles,
  updateProjectTileHeartbeat,
  updateProjectTileWorkspaceFiles,
} from "@/lib/projects/client";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import {
  createWorkspaceFilesState,
  isWorkspaceFileName,
  WORKSPACE_FILE_META,
  WORKSPACE_FILE_NAMES,
  WORKSPACE_FILE_PLACEHOLDERS,
  type WorkspaceFileName,
} from "@/lib/projects/workspaceFiles";
import { MAX_TILE_HEIGHT, MIN_TILE_SIZE } from "@/lib/canvasTileDefaults";
import { AgentAvatar } from "./AgentAvatar";

const HEARTBEAT_INTERVAL_OPTIONS = ["15m", "30m", "1h", "2h", "6h", "12h", "24h"];

type AgentTileProps = {
  tile: AgentTileType;
  projectId: string | null;
  isSelected: boolean;
  canSend: boolean;
  models: GatewayModelChoice[];
  onDelete: () => void;
  onLoadHistory: () => void;
  onNameChange: (name: string) => Promise<boolean>;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
  onModelChange: (value: string | null) => void;
  onThinkingChange: (value: string | null) => void;
  onAvatarShuffle: () => void;
  onNameShuffle: () => void;
  onResize?: (size: TileSize) => void;
  onResizeEnd?: (size: TileSize) => void;
};

export const AgentTile = ({
  tile,
  projectId,
  isSelected,
  canSend,
  models,
  onDelete,
  onLoadHistory,
  onNameChange,
  onDraftChange,
  onSend,
  onModelChange,
  onThinkingChange,
  onAvatarShuffle,
  onNameShuffle,
  onResize,
  onResizeEnd,
}: AgentTileProps) => {
  const [nameDraft, setNameDraft] = useState(tile.name);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState(createWorkspaceFilesState);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceFileName>(
    WORKSPACE_FILE_NAMES[0]
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);
  const [heartbeatSaving, setHeartbeatSaving] = useState(false);
  const [heartbeatDirty, setHeartbeatDirty] = useState(false);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [heartbeatOverride, setHeartbeatOverride] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatEvery, setHeartbeatEvery] = useState("30m");
  const [heartbeatIntervalMode, setHeartbeatIntervalMode] = useState<
    "preset" | "custom"
  >("preset");
  const [heartbeatCustomMinutes, setHeartbeatCustomMinutes] = useState("45");
  const [heartbeatTargetMode, setHeartbeatTargetMode] = useState<
    "last" | "none" | "custom"
  >("last");
  const [heartbeatTargetCustom, setHeartbeatTargetCustom] = useState("");
  const [heartbeatIncludeReasoning, setHeartbeatIncludeReasoning] = useState(false);
  const [heartbeatActiveHoursEnabled, setHeartbeatActiveHoursEnabled] =
    useState(false);
  const [heartbeatActiveStart, setHeartbeatActiveStart] = useState("08:00");
  const [heartbeatActiveEnd, setHeartbeatActiveEnd] = useState("18:00");
  const [heartbeatAckMaxChars, setHeartbeatAckMaxChars] = useState("300");
  const outputRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeStateRef = useRef<{
    active: boolean;
    axis: "height" | "width";
    startX?: number;
    startY?: number;
    startWidth?: number;
    startHeight?: number;
  } | null>(null);
  const userResizedRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeSizeRef = useRef<TileSize>({
    width: tile.size.width,
    height: tile.size.height,
  });
  const resizeHandlersRef = useRef<{
    move: (event: PointerEvent) => void;
    stop: () => void;
  } | null>(null);
  const scrollOutputToBottom = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleOutputWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const el = outputRef.current;
      if (!el) return;
      event.preventDefault();
      event.stopPropagation();
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextTop = Math.max(0, Math.min(maxTop, el.scrollTop + event.deltaY));
      const nextLeft = Math.max(0, Math.min(maxLeft, el.scrollLeft + event.deltaX));
      el.scrollTop = nextTop;
      el.scrollLeft = nextLeft;
    },
    []
  );

  useEffect(() => {
    const raf = requestAnimationFrame(scrollOutputToBottom);
    return () => cancelAnimationFrame(raf);
  }, [scrollOutputToBottom, tile.outputLines, tile.streamText]);

  const resizeDraft = useCallback(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    setNameDraft(tile.name);
  }, [tile.name]);

  useEffect(() => {
    resizeDraft();
  }, [resizeDraft, tile.draft]);

  useEffect(() => {
    resizeSizeRef.current = {
      width: tile.size.width,
      height: tile.size.height,
    };
  }, [tile.size.height, tile.size.width]);

  const stopResize = useCallback(() => {
    if (!resizeStateRef.current?.active) return;
    resizeStateRef.current = null;
    if (resizeHandlersRef.current) {
      window.removeEventListener("pointermove", resizeHandlersRef.current.move);
      window.removeEventListener("pointerup", resizeHandlersRef.current.stop);
      window.removeEventListener("pointercancel", resizeHandlersRef.current.stop);
      resizeHandlersRef.current = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (onResizeEnd) {
      onResizeEnd(resizeSizeRef.current);
    }
  }, [onResizeEnd]);

  const scheduleResize = useCallback(
    (size: Partial<TileSize>) => {
      resizeSizeRef.current = {
        ...resizeSizeRef.current,
        ...size,
      };
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        onResize?.(resizeSizeRef.current);
      });
    },
    [onResize]
  );

  const startHeightResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!onResize) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = tile.size.height;
      resizeStateRef.current = {
        active: true,
        axis: "height",
        startY,
        startHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const move = (moveEvent: PointerEvent) => {
        if (!resizeStateRef.current?.active) return;
        const delta = moveEvent.clientY - startY;
        const nextHeight = Math.min(
          MAX_TILE_HEIGHT,
          Math.max(MIN_TILE_SIZE.height, startHeight + delta)
        );
        scheduleResize({ height: nextHeight });
      };
      const stop = () => {
        stopResize();
      };
      resizeHandlersRef.current = { move, stop };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [onResize, scheduleResize, stopResize, tile.size.height]
  );

  const startWidthResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!onResize) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      userResizedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = tile.size.width;
      resizeStateRef.current = {
        active: true,
        axis: "width",
        startX,
        startWidth,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const move = (moveEvent: PointerEvent) => {
        if (!resizeStateRef.current?.active) return;
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(MIN_TILE_SIZE.width, startWidth + delta);
        scheduleResize({ width: nextWidth });
      };
      const stop = () => {
        stopResize();
      };
      resizeHandlersRef.current = { move, stop };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [onResize, scheduleResize, stopResize, tile.size.width]
  );

  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    if (resizeStateRef.current?.active || userResizedRef.current) return;
    const extra = Math.ceil(output.scrollHeight - output.clientHeight);
    if (extra <= 0) return;
    const nextHeight = Math.min(MAX_TILE_HEIGHT, tile.size.height + extra);
    if (nextHeight <= tile.size.height) return;
    if (onResizeEnd) {
      resizeSizeRef.current = { ...resizeSizeRef.current, height: nextHeight };
      onResizeEnd(resizeSizeRef.current);
    } else {
      onResize?.({ width: tile.size.width, height: nextHeight });
    }
  }, [
    onResize,
    onResizeEnd,
    tile.outputLines,
    tile.streamText,
    tile.thinkingTrace,
    tile.size.height,
    tile.size.width,
  ]);

  useEffect(() => {
    return () => stopResize();
  }, [stopResize]);

  const commitName = async () => {
    const next = normalizeAgentName(nameDraft);
    if (!next) {
      setNameDraft(tile.name);
      return;
    }
    if (next === tile.name) {
      return;
    }
    const ok = await onNameChange(next);
    if (!ok) {
      setNameDraft(tile.name);
      return;
    }
    setNameDraft(next);
  };

  const statusColor =
    tile.status === "running"
      ? "bg-primary text-primary-foreground"
      : tile.status === "error"
        ? "bg-destructive text-destructive-foreground"
        : "bg-accent text-accent-foreground border border-border shadow-sm";
  const statusLabel =
    tile.status === "running"
      ? "Running"
      : tile.status === "error"
        ? "Error"
        : "Waiting for direction";
  const latestTraceLine = (() => {
    for (let index = tile.outputLines.length - 1; index >= 0; index -= 1) {
      const line = tile.outputLines[index];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!isTraceMarkdown(trimmed)) continue;
      return stripTraceMarkdown(trimmed);
    }
    return null;
  })();
  const latestUpdate = (() => {
    if (tile.status === "running") {
      const thinking = tile.thinkingTrace?.trim();
      if (thinking) return thinking;
      if (latestTraceLine) return latestTraceLine;
      const streamText = tile.streamText?.trim();
      if (streamText) return streamText;
    }
    const latestPreview = tile.latestPreview?.trim();
    if (latestPreview) return extractSummaryText(latestPreview);
    const lastResult = tile.lastResult?.trim();
    if (lastResult) return extractSummaryText(lastResult);
    for (let index = tile.outputLines.length - 1; index >= 0; index -= 1) {
      const line = tile.outputLines[index];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isTraceMarkdown(trimmed)) continue;
      if (trimmed.startsWith(">")) continue;
      return extractSummaryText(trimmed);
    }
    return "No updates yet.";
  })();
  const lastUserMessage = (() => {
    const stored = tile.lastUserMessage?.trim();
    if (stored) return stored;
    for (let index = tile.outputLines.length - 1; index >= 0; index -= 1) {
      const line = tile.outputLines[index];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed.startsWith(">")) continue;
      const message = trimmed.replace(/^>\s?/, "").trim();
      if (!message) continue;
      return message;
    }
    return null;
  })();
  const modelOptions = models.map((entry) => ({
    value: `${entry.provider}/${entry.id}`,
    label:
      entry.name === `${entry.provider}/${entry.id}`
        ? entry.name
        : `${entry.name} (${entry.provider}/${entry.id})`,
    reasoning: entry.reasoning,
  }));
  const modelValue = tile.model ?? "";
  const modelOptionsWithFallback =
    modelValue && !modelOptions.some((option) => option.value === modelValue)
      ? [{ value: modelValue, label: modelValue, reasoning: undefined }, ...modelOptions]
      : modelOptions;
  const selectedModel = modelOptionsWithFallback.find(
    (option) => option.value === modelValue
  );
  const allowThinking = selectedModel?.reasoning !== false;
  const showThinking = tile.status === "running" && Boolean(tile.thinkingTrace);
  const showTranscript =
    tile.outputLines.length > 0 || Boolean(tile.streamText) || showThinking;
  const avatarSeed = tile.avatarSeed ?? tile.agentId;
  const panelBorder = "border-border";

  const loadWorkspaceFiles = useCallback(async () => {
    if (!projectId) return;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const result = await fetchProjectTileWorkspaceFiles(projectId, tile.id);
      const nextState = createWorkspaceFilesState();
      for (const file of result.files) {
        if (!isWorkspaceFileName(file.name)) continue;
        nextState[file.name] = {
          content: file.content ?? "",
          exists: Boolean(file.exists),
        };
      }
      setWorkspaceFiles(nextState);
      setWorkspaceDirty(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load workspace files.";
      setWorkspaceError(message);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [projectId, tile.id]);

  const saveWorkspaceFiles = useCallback(async () => {
    if (!projectId) return;
    setWorkspaceSaving(true);
    setWorkspaceError(null);
    try {
      const payload = {
        files: WORKSPACE_FILE_NAMES.map((name) => ({
          name,
          content: workspaceFiles[name].content,
        })),
      };
      const result = await updateProjectTileWorkspaceFiles(projectId, tile.id, payload);
      const nextState = createWorkspaceFilesState();
      for (const file of result.files) {
        if (!isWorkspaceFileName(file.name)) continue;
        nextState[file.name] = {
          content: file.content ?? "",
          exists: Boolean(file.exists),
        };
      }
      setWorkspaceFiles(nextState);
      setWorkspaceDirty(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save workspace files.";
      setWorkspaceError(message);
    } finally {
      setWorkspaceSaving(false);
    }
  }, [projectId, tile.id, workspaceFiles]);

  const handleWorkspaceTabChange = useCallback(
    (nextTab: WorkspaceFileName) => {
      if (nextTab === workspaceTab) return;
      if (workspaceDirty && !workspaceSaving) {
        void saveWorkspaceFiles();
      }
      setWorkspaceTab(nextTab);
    },
    [saveWorkspaceFiles, workspaceDirty, workspaceSaving, workspaceTab]
  );

  const loadHeartbeat = useCallback(async () => {
    if (!projectId) return;
    setHeartbeatLoading(true);
    setHeartbeatError(null);
    try {
      const result = await fetchProjectTileHeartbeat(projectId, tile.id);
      const every = result.heartbeat.every ?? "30m";
      const enabled = every !== "0m";
      const isPreset = HEARTBEAT_INTERVAL_OPTIONS.includes(every);
      if (isPreset) {
        setHeartbeatIntervalMode("preset");
      } else {
        setHeartbeatIntervalMode("custom");
        const parsed =
          every.endsWith("m")
            ? Number.parseInt(every, 10)
            : every.endsWith("h")
              ? Number.parseInt(every, 10) * 60
              : Number.parseInt(every, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          setHeartbeatCustomMinutes(String(parsed));
        }
      }
      const target = result.heartbeat.target ?? "last";
      const targetMode =
        target === "last" || target === "none" ? target : "custom";
      setHeartbeatOverride(result.hasOverride);
      setHeartbeatEnabled(enabled);
      setHeartbeatEvery(enabled ? every : "30m");
      setHeartbeatTargetMode(targetMode);
      setHeartbeatTargetCustom(targetMode === "custom" ? target : "");
      setHeartbeatIncludeReasoning(Boolean(result.heartbeat.includeReasoning));
      if (result.heartbeat.activeHours) {
        setHeartbeatActiveHoursEnabled(true);
        setHeartbeatActiveStart(result.heartbeat.activeHours.start);
        setHeartbeatActiveEnd(result.heartbeat.activeHours.end);
      } else {
        setHeartbeatActiveHoursEnabled(false);
      }
      if (typeof result.heartbeat.ackMaxChars === "number") {
        setHeartbeatAckMaxChars(String(result.heartbeat.ackMaxChars));
      } else {
        setHeartbeatAckMaxChars("300");
      }
      setHeartbeatDirty(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load heartbeat settings.";
      setHeartbeatError(message);
    } finally {
      setHeartbeatLoading(false);
    }
  }, [projectId, tile.id]);

  const saveHeartbeat = useCallback(async () => {
    if (!projectId) return;
    setHeartbeatSaving(true);
    setHeartbeatError(null);
    try {
      const target =
        heartbeatTargetMode === "custom"
          ? heartbeatTargetCustom.trim()
          : heartbeatTargetMode;
      let every = heartbeatEnabled ? heartbeatEvery.trim() : "0m";
      if (heartbeatEnabled && heartbeatIntervalMode === "custom") {
        const customValue = Number.parseInt(heartbeatCustomMinutes, 10);
        if (!Number.isFinite(customValue) || customValue <= 0) {
          setHeartbeatError("Custom interval must be a positive number.");
          setHeartbeatSaving(false);
          return;
        }
        every = `${customValue}m`;
      }
      const ackParsed = Number.parseInt(heartbeatAckMaxChars, 10);
      const ackMaxChars = Number.isFinite(ackParsed) ? ackParsed : 300;
      const activeHours =
        heartbeatActiveHoursEnabled && heartbeatActiveStart && heartbeatActiveEnd
          ? { start: heartbeatActiveStart, end: heartbeatActiveEnd }
          : null;
      const result = await updateProjectTileHeartbeat(projectId, tile.id, {
        override: heartbeatOverride,
        heartbeat: {
          every,
          target: target || "last",
          includeReasoning: heartbeatIncludeReasoning,
          ackMaxChars,
          activeHours,
        },
      });
      setHeartbeatOverride(result.hasOverride);
      setHeartbeatDirty(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save heartbeat settings.";
      setHeartbeatError(message);
    } finally {
      setHeartbeatSaving(false);
    }
  }, [
    projectId,
    tile.id,
    heartbeatActiveEnd,
    heartbeatActiveHoursEnabled,
    heartbeatActiveStart,
    heartbeatAckMaxChars,
    heartbeatCustomMinutes,
    heartbeatEnabled,
    heartbeatEvery,
    heartbeatIntervalMode,
    heartbeatIncludeReasoning,
    heartbeatOverride,
    heartbeatTargetCustom,
    heartbeatTargetMode,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    void loadWorkspaceFiles();
    void loadHeartbeat();
  }, [loadWorkspaceFiles, loadHeartbeat, settingsOpen]);

  useEffect(() => {
    if (!WORKSPACE_FILE_NAMES.includes(workspaceTab)) {
      setWorkspaceTab(WORKSPACE_FILE_NAMES[0]);
    }
  }, [workspaceTab]);

  const settingsModal =
    settingsOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-6 py-8 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Agent settings"
            onClick={() => setSettingsOpen(false)}
          >
            <div
              className="w-[min(92vw,920px)] max-h-[90vh] overflow-hidden rounded-lg border border-border bg-popover p-6 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex max-h-[calc(90vh-3rem)] flex-col gap-4 overflow-hidden">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Agent settings
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 shadow-sm">
                      <input
                        className="w-full bg-transparent text-sm font-semibold uppercase tracking-wide text-foreground outline-none"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onBlur={() => {
                          void commitName();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            setNameDraft(tile.name);
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-card"
                        type="button"
                        aria-label="Shuffle name"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onNameShuffle();
                        }}
                      >
                        <Shuffle className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-4 py-2 text-xs font-semibold uppercase text-muted-foreground"
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-4 overflow-auto pr-1">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
                      <label className="flex flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
                        <span>Model</span>
                        <select
                          className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                          value={tile.model ?? ""}
                          onChange={(event) => {
                            const value = event.target.value.trim();
                            onModelChange(value ? value : null);
                          }}
                        >
                          {modelOptionsWithFallback.length === 0 ? (
                            <option value="">No models found</option>
                          ) : null}
                          {modelOptionsWithFallback.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {allowThinking ? (
                        <label className="flex flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
                          <span>Thinking</span>
                          <select
                            className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                            value={tile.thinkingLevel ?? ""}
                            onChange={(event) => {
                              const value = event.target.value.trim();
                              onThinkingChange(value ? value : null);
                            }}
                          >
                            <option value="">Default</option>
                            <option value="off">Off</option>
                            <option value="minimal">Minimal</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="xhigh">XHigh</option>
                            </select>
                          </label>
                      ) : (
                        <div />
                      )}
                    </div>
                    <button
                      className="mt-4 w-full max-w-xs self-center rounded-lg border border-destructive bg-destructive px-3 py-2 text-xs font-semibold uppercase text-destructive-foreground"
                      type="button"
                      onClick={onDelete}
                    >
                      {tile.archivedAt ? "Restore agent" : "Archive agent"}
                    </button>
                  </div>
                  <div className="flex min-h-[420px] flex-1 flex-col rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Workspace files
                      </div>
                      <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                        {workspaceLoading
                          ? "Loading..."
                          : workspaceDirty
                            ? "Saving on tab change"
                            : "All changes saved"}
                      </div>
                    </div>
                    {workspaceError ? (
                      <div className="mt-3 rounded-lg border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
                        {workspaceError}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-end gap-2">
                      {WORKSPACE_FILE_NAMES.map((name) => {
                        const active = name === workspaceTab;
                        const label = WORKSPACE_FILE_META[name].title.replace(".md", "");
                        return (
                          <button
                            key={name}
                            type="button"
                            className={`rounded-t-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition ${
                              active
                                ? "border-border bg-card text-foreground shadow-sm"
                                : "border-transparent bg-muted text-muted-foreground hover:bg-card"
                            }`}
                            onClick={() => handleWorkspaceTabChange(name)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex-1 overflow-auto rounded-lg border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {WORKSPACE_FILE_META[workspaceTab].title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {WORKSPACE_FILE_META[workspaceTab].hint}
                          </div>
                        </div>
                        {!workspaceFiles[workspaceTab].exists ? (
                          <span className="rounded-md border border-border bg-accent px-2 py-1 text-[10px] font-semibold uppercase text-accent-foreground">
                            new
                          </span>
                        ) : null}
                      </div>

                      <textarea
                        className="mt-4 min-h-[220px] w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-none"
                        value={workspaceFiles[workspaceTab].content}
                        placeholder={
                          workspaceFiles[workspaceTab].content.trim().length === 0
                            ? WORKSPACE_FILE_PLACEHOLDERS[workspaceTab]
                            : undefined
                        }
                        disabled={workspaceLoading || workspaceSaving}
                        onChange={(event) => {
                          const value = event.target.value;
                          setWorkspaceFiles((prev) => ({
                            ...prev,
                            [workspaceTab]: { ...prev[workspaceTab], content: value },
                          }));
                          setWorkspaceDirty(true);
                        }}
                      />

                      {workspaceTab === "HEARTBEAT.md" ? (
                        <div className="mt-4 rounded-lg border border-border bg-card p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Heartbeat config
                            </div>
                            <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                              {heartbeatLoading
                                ? "Loading..."
                                : heartbeatDirty
                                  ? "Unsaved changes"
                                  : "All changes saved"}
                            </div>
                          </div>
                          {heartbeatError ? (
                            <div className="mt-3 rounded-lg border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
                              {heartbeatError}
                            </div>
                          ) : null}
                          <label className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Override defaults</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input text-foreground"
                              checked={heartbeatOverride}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatOverride(event.target.checked);
                                setHeartbeatDirty(true);
                              }}
                            />
                          </label>
                          <label className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Enabled</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input text-foreground"
                              checked={heartbeatEnabled}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatEnabled(event.target.checked);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            />
                          </label>
                          <label className="mt-4 flex flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Interval</span>
                            <select
                              className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                              value={heartbeatIntervalMode === "custom" ? "custom" : heartbeatEvery}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value === "custom") {
                                  setHeartbeatIntervalMode("custom");
                                } else {
                                  setHeartbeatIntervalMode("preset");
                                  setHeartbeatEvery(value);
                                }
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            >
                              {HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  Every {option}
                                </option>
                              ))}
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {heartbeatIntervalMode === "custom" ? (
                            <input
                              type="number"
                              min={1}
                              className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none"
                              value={heartbeatCustomMinutes}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatCustomMinutes(event.target.value);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                              placeholder="Minutes"
                            />
                          ) : null}
                          <label className="mt-4 flex flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Target</span>
                            <select
                              className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                              value={heartbeatTargetMode}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatTargetMode(
                                  event.target.value as "last" | "none" | "custom"
                                );
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            >
                              <option value="last">Last channel</option>
                              <option value="none">No delivery</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {heartbeatTargetMode === "custom" ? (
                            <input
                              className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none"
                              value={heartbeatTargetCustom}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatTargetCustom(event.target.value);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                              placeholder="Channel id (e.g., whatsapp)"
                            />
                          ) : null}
                          <label className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Include reasoning</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input text-foreground"
                              checked={heartbeatIncludeReasoning}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatIncludeReasoning(event.target.checked);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            />
                          </label>
                          <label className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase text-muted-foreground">
                            <span>Active hours</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input text-foreground"
                              checked={heartbeatActiveHoursEnabled}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatActiveHoursEnabled(event.target.checked);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            />
                          </label>
                          {heartbeatActiveHoursEnabled ? (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <input
                                type="time"
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none"
                                value={heartbeatActiveStart}
                                disabled={heartbeatLoading || heartbeatSaving}
                                onChange={(event) => {
                                  setHeartbeatActiveStart(event.target.value);
                                  setHeartbeatOverride(true);
                                  setHeartbeatDirty(true);
                                }}
                              />
                              <input
                                type="time"
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none"
                                value={heartbeatActiveEnd}
                                disabled={heartbeatLoading || heartbeatSaving}
                                onChange={(event) => {
                                  setHeartbeatActiveEnd(event.target.value);
                                  setHeartbeatOverride(true);
                                  setHeartbeatDirty(true);
                                }}
                              />
                            </div>
                          ) : null}
                          <label className="mt-4 flex flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
                            <span>ACK max chars</span>
                            <input
                              type="number"
                              min={0}
                              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none"
                              value={heartbeatAckMaxChars}
                              disabled={heartbeatLoading || heartbeatSaving}
                              onChange={(event) => {
                                setHeartbeatAckMaxChars(event.target.value);
                                setHeartbeatOverride(true);
                                setHeartbeatDirty(true);
                              }}
                            />
                          </label>
                          <div className="mt-4 flex items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                              {heartbeatDirty ? "Remember to save changes." : "Up to date."}
                            </div>
                            <button
                              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold uppercase text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted"
                              type="button"
                              disabled={
                                !projectId ||
                                heartbeatLoading ||
                                heartbeatSaving ||
                                !heartbeatDirty
                              }
                              onClick={() => void saveHeartbeat()}
                            >
                              {heartbeatSaving ? "Saving..." : "Save heartbeat"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
                      <div className="text-xs text-muted-foreground">
                        {workspaceDirty ? "Auto-save on tab switch." : "Up to date."}
                      </div>
                      <button
                        className="rounded-lg border border-border px-4 py-2 text-xs font-semibold uppercase text-muted-foreground"
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const resizeHandleClass = showTranscript
    ? isSelected
      ? "pointer-events-auto opacity-100"
      : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
    : "pointer-events-none opacity-0";

  return (
    <div data-tile className="group relative flex h-full w-full flex-col gap-3">
      {settingsModal}
      <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-1 flex-col items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-1 shadow-sm ${
                isSelected ? "agent-name-selected" : "border-border"
              }`}
            >
              <input
                className="w-full bg-transparent text-center text-xs font-semibold uppercase tracking-wide text-foreground outline-none"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  void commitName();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setNameDraft(tile.name);
                    event.currentTarget.blur();
                  }
                }}
              />
              <button
                className="nodrag flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-card"
                type="button"
                aria-label="Shuffle name"
                data-testid="agent-name-shuffle"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onNameShuffle();
                }}
              >
                <Shuffle className="h-3 w-3" />
              </button>
            </div>
            <div className="relative">
              <div data-drag-handle>
                <AgentAvatar
                  seed={avatarSeed}
                  name={tile.name}
                  size={120}
                  isSelected={isSelected}
                />
              </div>
              <button
                className="nodrag absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:bg-card"
                type="button"
                aria-label="Shuffle avatar"
                data-testid="agent-avatar-shuffle"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAvatarShuffle();
                }}
              >
                <Shuffle className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Latest update</span>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-2 max-h-28 overflow-auto text-xs text-foreground">
            {latestUpdate}
          </div>
          {lastUserMessage ? (
            <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Last message
              </span>
              <div className="mt-1 text-xs text-foreground">{lastUserMessage}</div>
            </div>
          ) : null}
          {tile.outputLines.length === 0 && !tile.streamText ? (
            <div className="mt-2">
              <button
                className="nodrag rounded-lg border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-card"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onLoadHistory();
                }}
              >
                Load history
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div className="relative">
            <button
              className="nodrag flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-card"
              type="button"
              data-testid="agent-options-toggle"
              aria-label="Agent options"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSettingsOpen(true);
              }}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
          <textarea
            ref={draftRef}
            rows={1}
            className="max-h-28 flex-1 resize-none overflow-hidden rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-foreground outline-none"
            value={tile.draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              resizeDraft();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (!canSend || tile.status === "running") return;
              const message = tile.draft.trim();
              if (!message) return;
              onSend(message);
            }}
            placeholder="type a message"
          />
          <button
            className="rounded-lg border border-transparent bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            type="button"
            onClick={() => onSend(tile.draft)}
            disabled={!canSend || tile.status === "running" || !tile.draft.trim()}
          >
            Send
          </button>
        </div>
      </div>

      {showTranscript ? (
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border ${panelBorder} bg-card px-4 pb-4 pt-4 shadow-sm`}
        >
          <div
            ref={outputRef}
            className="nowheel flex-1 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs text-foreground"
            onWheel={handleOutputWheel}
            data-testid="agent-transcript"
          >
            <div className="flex flex-col gap-2">
              {showThinking ? (
                <div className="rounded-lg border border-border bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground">
                  <div className="agent-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {tile.thinkingTrace}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : null}
              {(() => {
                const nodes: React.ReactNode[] = [];
                for (let index = 0; index < tile.outputLines.length; index += 1) {
                  const line = tile.outputLines[index];
                  if (isTraceMarkdown(line)) {
                    const traces = [stripTraceMarkdown(line)];
                    let cursor = index + 1;
                    while (
                      cursor < tile.outputLines.length &&
                      isTraceMarkdown(tile.outputLines[cursor])
                    ) {
                      traces.push(stripTraceMarkdown(tile.outputLines[cursor]));
                      cursor += 1;
                    }
                    nodes.push(
                      <details
                        key={`${tile.id}-trace-${index}`}
                        className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        <summary className="cursor-pointer select-none font-semibold">
                          Thinking
                        </summary>
                        <div className="agent-markdown mt-1 text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {traces.join("\n")}
                          </ReactMarkdown>
                        </div>
                      </details>
                    );
                    index = cursor - 1;
                    continue;
                  }
                  nodes.push(
                    <div key={`${tile.id}-line-${index}`} className="agent-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{line}</ReactMarkdown>
                    </div>
                  );
                }
                return nodes;
              })()}
              {tile.streamText ? (
                <div className="agent-markdown text-muted-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {tile.streamText}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Resize tile"
        className={`nodrag absolute -bottom-2 left-6 right-6 flex h-4 cursor-row-resize touch-none items-center justify-center transition-opacity ${resizeHandleClass}`}
        onPointerDown={startHeightResize}
      >
        <span className="h-1.5 w-16 rounded-full bg-border shadow-sm" />
      </button>
      <button
        type="button"
        aria-label="Resize tile width"
        className={`nodrag absolute -right-2 top-6 bottom-6 flex w-4 cursor-col-resize touch-none items-center justify-center transition-opacity ${resizeHandleClass}`}
        onPointerDown={startWidthResize}
      >
        <span className="h-16 w-1.5 rounded-full bg-border shadow-sm" />
      </button>
    </div>
  );
};
