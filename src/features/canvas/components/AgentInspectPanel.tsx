"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentTile } from "@/features/canvas/state/store";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import {
  resolveHeartbeatSettings,
  updateGatewayHeartbeat,
  type GatewayConfigSnapshot,
} from "@/lib/gateway/agentConfig";
import { invokeGatewayTool } from "@/lib/gateway/tools";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import {
  createWorkspaceFilesState,
  isWorkspaceFileName,
  WORKSPACE_FILE_META,
  WORKSPACE_FILE_NAMES,
  WORKSPACE_FILE_PLACEHOLDERS,
  type WorkspaceFileName,
} from "@/lib/projects/workspaceFiles";

const HEARTBEAT_INTERVAL_OPTIONS = ["15m", "30m", "1h", "2h", "6h", "12h", "24h"];

type AgentInspectPanelProps = {
  tile: AgentTile;
  client: GatewayClient;
  models: GatewayModelChoice[];
  onClose: () => void;
  onDelete: () => void;
  onModelChange: (value: string | null) => void;
  onThinkingChange: (value: string | null) => void;
};

export const AgentInspectPanel = ({
  tile,
  client,
  models,
  onClose,
  onDelete,
  onModelChange,
  onThinkingChange,
}: AgentInspectPanelProps) => {
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
  const extractToolText = useCallback((result: unknown) => {
    if (!result || typeof result !== "object") return "";
    const record = result as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    const content = record.content;
    if (!Array.isArray(content)) return "";
    const blocks = content
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const block = item as Record<string, unknown>;
        if (block.type !== "text" || typeof block.text !== "string") return null;
        return block.text;
      })
      .filter((text): text is string => Boolean(text));
    return blocks.join("");
  }, []);

  const isMissingFileError = useCallback(
    (message: string) => /no such file|enoent/i.test(message),
    []
  );

  const loadWorkspaceFiles = useCallback(async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const sessionKey = tile.sessionKey?.trim();
      if (!sessionKey) {
        setWorkspaceError("Session key is missing for this agent.");
        return;
      }
      const results = await Promise.all(
        WORKSPACE_FILE_NAMES.map(async (name) => {
          const response = await invokeGatewayTool({
            tool: "read",
            sessionKey,
            args: { path: name },
          });
          if (!response.ok) {
            if (isMissingFileError(response.error)) {
              return { name, content: "", exists: false };
            }
            throw new Error(response.error);
          }
          const content = extractToolText(response.result);
          return { name, content, exists: true };
        })
      );
      const nextState = createWorkspaceFilesState();
      for (const file of results) {
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
  }, [extractToolText, isMissingFileError, tile.sessionKey]);

  const saveWorkspaceFiles = useCallback(async () => {
    setWorkspaceSaving(true);
    setWorkspaceError(null);
    try {
      const sessionKey = tile.sessionKey?.trim();
      if (!sessionKey) {
        setWorkspaceError("Session key is missing for this agent.");
        return;
      }
      await Promise.all(
        WORKSPACE_FILE_NAMES.map(async (name) => {
          const response = await invokeGatewayTool({
            tool: "write",
            sessionKey,
            args: { path: name, content: workspaceFiles[name].content },
          });
          if (!response.ok) {
            throw new Error(response.error);
          }
          return name;
        })
      );
      const nextState = createWorkspaceFilesState();
      for (const name of WORKSPACE_FILE_NAMES) {
        nextState[name] = {
          content: workspaceFiles[name].content,
          exists: true,
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
  }, [tile.sessionKey, workspaceFiles]);

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
    setHeartbeatLoading(true);
    setHeartbeatError(null);
    try {
      const snapshot = await client.call<GatewayConfigSnapshot>("config.get", {});
      const config =
        snapshot.config && typeof snapshot.config === "object" ? snapshot.config : {};
      const result = resolveHeartbeatSettings(config, tile.agentId);
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
      const targetMode = target === "last" || target === "none" ? target : "custom";
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
  }, [client, tile.agentId]);

  const saveHeartbeat = useCallback(async () => {
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
      const result = await updateGatewayHeartbeat({
        client,
        agentId: tile.agentId,
        sessionKey: tile.sessionKey,
        payload: {
          override: heartbeatOverride,
          heartbeat: {
            every,
            target: target || "last",
            includeReasoning: heartbeatIncludeReasoning,
            ackMaxChars,
            activeHours,
          },
        },
      });
      setHeartbeatOverride(result.hasOverride);
      setHeartbeatEnabled(result.heartbeat.every !== "0m");
      setHeartbeatEvery(result.heartbeat.every);
      setHeartbeatTargetMode(
        result.heartbeat.target === "last" || result.heartbeat.target === "none"
          ? result.heartbeat.target
          : "custom"
      );
      setHeartbeatTargetCustom(
        result.heartbeat.target === "last" || result.heartbeat.target === "none"
          ? ""
          : result.heartbeat.target
      );
      setHeartbeatIncludeReasoning(result.heartbeat.includeReasoning);
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
        err instanceof Error ? err.message : "Failed to save heartbeat settings.";
      setHeartbeatError(message);
    } finally {
      setHeartbeatSaving(false);
    }
  }, [
    heartbeatActiveEnd,
    heartbeatActiveHoursEnabled,
    heartbeatActiveStart,
    heartbeatAckMaxChars,
    heartbeatCustomMinutes,
    heartbeatEnabled,
    heartbeatEvery,
    heartbeatIncludeReasoning,
    heartbeatIntervalMode,
    heartbeatOverride,
    heartbeatTargetCustom,
    heartbeatTargetMode,
    client,
    tile.agentId,
    tile.sessionKey,
  ]);

  useEffect(() => {
    void loadWorkspaceFiles();
    void loadHeartbeat();
  }, [loadWorkspaceFiles, loadHeartbeat]);

  useEffect(() => {
    if (!WORKSPACE_FILE_NAMES.includes(workspaceTab)) {
      setWorkspaceTab(WORKSPACE_FILE_NAMES[0]);
    }
  }, [workspaceTab]);

  const modelOptions = useMemo(
    () =>
      models.map((entry) => ({
        value: `${entry.provider}/${entry.id}`,
        label:
          entry.name === `${entry.provider}/${entry.id}`
            ? entry.name
            : `${entry.name} (${entry.provider}/${entry.id})`,
        reasoning: entry.reasoning,
      })),
    [models]
  );
  const modelValue = tile.model ?? "";
  const modelOptionsWithFallback =
    modelValue && !modelOptions.some((option) => option.value === modelValue)
      ? [{ value: modelValue, label: modelValue, reasoning: undefined }, ...modelOptions]
      : modelOptions;
  const selectedModel = modelOptionsWithFallback.find(
    (option) => option.value === modelValue
  );
  const allowThinking = selectedModel?.reasoning !== false;

  return (
    <div className="agent-inspect-panel" data-testid="agent-inspect-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inspect
          </div>
          <div className="text-sm font-semibold text-foreground">{tile.name}</div>
        </div>
        <button
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold uppercase text-muted-foreground"
          type="button"
          data-testid="agent-inspect-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <section
          className="flex min-h-[420px] flex-1 flex-col rounded-lg border border-border bg-card p-4"
          data-testid="agent-inspect-files"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Brain files
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
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                    active
                      ? "border-border bg-background text-foreground shadow-sm"
                      : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => handleWorkspaceTabChange(name)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex-1 overflow-auto rounded-lg bg-muted/40 p-4">
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
              className="mt-4 min-h-[220px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none"
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
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              {workspaceDirty ? "Auto-save on tab switch." : "Up to date."}
            </div>
          </div>
        </section>

        <section
          className="rounded-lg border border-border bg-card p-4"
          data-testid="agent-inspect-settings"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Settings
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr]">
            <label className="flex min-w-0 flex-col gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <span>Model</span>
              <select
                className="h-10 w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
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
                className="rounded-lg border border-transparent bg-primary px-4 py-2 text-xs font-semibold uppercase text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                type="button"
                disabled={heartbeatLoading || heartbeatSaving || !heartbeatDirty}
                onClick={() => void saveHeartbeat()}
              >
                {heartbeatSaving ? "Saving..." : "Save heartbeat"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
            Delete agent
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Removes the agent from the gateway config.
          </div>
          <button
            className="mt-3 w-full rounded-lg border border-destructive bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm transition hover:brightness-105"
            type="button"
            onClick={onDelete}
          >
            Delete agent
          </button>
        </section>
      </div>
    </div>
  );
};
