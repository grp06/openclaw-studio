"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, ListChecks, Play, Sun, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AgentState } from "@/features/agents/state/store";
import type { CronCreateDraft, CronCreateTemplateId } from "@/lib/cron/createPayloadBuilder";
import { formatCronPayload, formatCronSchedule, type CronJobSummary } from "@/lib/cron/types";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import type { AgentHeartbeatSummary } from "@/lib/gateway/agentConfig";
import { readGatewayAgentFile, writeGatewayAgentFile } from "@/lib/gateway/agentFiles";
import {
  AGENT_FILE_META,
  AGENT_FILE_NAMES,
  AGENT_FILE_PLACEHOLDERS,
  createAgentFilesState,
  isAgentFileName,
  type AgentFileName,
} from "@/lib/agents/agentFiles";

const AgentInspectHeader = ({
  label,
  title,
  onClose,
  closeTestId,
  closeDisabled,
}: {
  label: string;
  title: string;
  onClose: () => void;
  closeTestId: string;
  closeDisabled?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </div>
        <div className="console-title text-2xl leading-none text-foreground">{title}</div>
      </div>
      <button
        className="rounded-md border border-border/80 bg-card/70 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition hover:border-border hover:bg-muted/65"
        type="button"
        data-testid={closeTestId}
        disabled={closeDisabled}
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
};

type AgentSettingsPanelProps = {
  agent: AgentState;
  onClose: () => void;
  onRename: (value: string) => Promise<boolean>;
  onNewSession: () => Promise<void> | void;
  onDelete: () => void;
  canDelete?: boolean;
  onToolCallingToggle: (enabled: boolean) => void;
  onThinkingTracesToggle: (enabled: boolean) => void;
  cronJobs: CronJobSummary[];
  cronLoading: boolean;
  cronError: string | null;
  cronRunBusyJobId: string | null;
  cronDeleteBusyJobId: string | null;
  onRunCronJob: (jobId: string) => Promise<void> | void;
  onDeleteCronJob: (jobId: string) => Promise<void> | void;
  cronCreateBusy?: boolean;
  onCreateCronJob?: (draft: CronCreateDraft) => Promise<void> | void;
  heartbeats?: AgentHeartbeatSummary[];
  heartbeatLoading?: boolean;
  heartbeatError?: string | null;
  heartbeatRunBusyId?: string | null;
  heartbeatDeleteBusyId?: string | null;
  onRunHeartbeat?: (heartbeatId: string) => Promise<void> | void;
  onDeleteHeartbeat?: (heartbeatId: string) => Promise<void> | void;
};

const formatHeartbeatSchedule = (heartbeat: AgentHeartbeatSummary) =>
  `Every ${heartbeat.heartbeat.every}`;

const formatHeartbeatTarget = (heartbeat: AgentHeartbeatSummary) =>
  `Target: ${heartbeat.heartbeat.target}`;

const formatHeartbeatSource = (heartbeat: AgentHeartbeatSummary) =>
  heartbeat.source === "override" ? "Override" : "Inherited";

const formatCronStateLine = (job: CronJobSummary): string | null => {
  if (typeof job.state.runningAtMs === "number" && Number.isFinite(job.state.runningAtMs)) {
    return "Running now";
  }
  if (typeof job.state.nextRunAtMs === "number" && Number.isFinite(job.state.nextRunAtMs)) {
    return `Next: ${new Date(job.state.nextRunAtMs).toLocaleString()}`;
  }
  if (typeof job.state.lastRunAtMs === "number" && Number.isFinite(job.state.lastRunAtMs)) {
    const status = job.state.lastStatus ? `${job.state.lastStatus} ` : "";
    return `Last: ${status}${new Date(job.state.lastRunAtMs).toLocaleString()}`.trim();
  }
  return null;
};

const getFirstLinePreview = (value: string, maxChars: number): string => {
  const firstLine =
    value
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) return "";
  if (firstLine.length <= maxChars) return firstLine;
  return `${firstLine.slice(0, maxChars)}...`;
};

type CronTemplateOption = {
  id: CronCreateTemplateId;
  title: string;
  description: string;
  icon: typeof Sun;
  accent: string;
};

const CRON_TEMPLATE_OPTIONS: CronTemplateOption[] = [
  {
    id: "morning-brief",
    title: "Morning Brief",
    description: "Daily status summary with overnight updates.",
    icon: Sun,
    accent: "border-amber-400/40 bg-amber-500/10",
  },
  {
    id: "reminder",
    title: "Reminder",
    description: "A timed nudge for a specific event or task.",
    icon: Bell,
    accent: "border-cyan-400/40 bg-cyan-500/10",
  },
  {
    id: "weekly-review",
    title: "Weekly Review",
    description: "Recurring synthesis across a longer time window.",
    icon: CalendarDays,
    accent: "border-emerald-400/40 bg-emerald-500/10",
  },
  {
    id: "inbox-triage",
    title: "Inbox Triage",
    description: "Regular sorting and summarizing of incoming updates.",
    icon: ListChecks,
    accent: "border-orange-400/40 bg-orange-500/10",
  },
  {
    id: "custom",
    title: "Custom",
    description: "Start from a blank flow and choose each setting.",
    icon: ListChecks,
    accent: "border-violet-400/40 bg-violet-500/10",
  },
];

const createInitialCronDraft = (): CronCreateDraft => ({
  templateId: "morning-brief",
  name: "",
  taskText: "",
  scheduleKind: "every",
  everyAmount: 30,
  everyUnit: "minutes",
  deliveryMode: "announce",
  deliveryChannel: "last",
});

const applyTemplateDefaults = (templateId: CronCreateTemplateId, current: CronCreateDraft): CronCreateDraft => {
  if (templateId === "morning-brief") {
    return {
      ...current,
      templateId,
      name: current.name || "Morning brief",
      taskText: current.taskText || "Summarize overnight updates and priorities.",
      scheduleKind: "cron",
      cronExpr: current.cronExpr || "0 7 * * *",
      cronTz: current.cronTz || "America/Chicago",
      deliveryMode: "announce",
      deliveryChannel: current.deliveryChannel || "last",
    };
  }
  if (templateId === "reminder") {
    return {
      ...current,
      templateId,
      name: current.name || "Reminder",
      taskText: current.taskText || "Reminder: follow up on today’s priority task.",
      scheduleKind: "at",
    };
  }
  if (templateId === "weekly-review") {
    return {
      ...current,
      templateId,
      name: current.name || "Weekly review",
      taskText: current.taskText || "Summarize wins, blockers, and next-week priorities.",
      scheduleKind: "cron",
      cronExpr: current.cronExpr || "0 9 * * 1",
      cronTz: current.cronTz || "America/Chicago",
      deliveryMode: "announce",
      deliveryChannel: current.deliveryChannel || "last",
    };
  }
  if (templateId === "inbox-triage") {
    return {
      ...current,
      templateId,
      name: current.name || "Inbox triage",
      taskText: current.taskText || "Triage unread updates and surface the top actions.",
      scheduleKind: "every",
      everyAmount: current.everyAmount ?? 30,
      everyUnit: current.everyUnit ?? "minutes",
      deliveryMode: "announce",
      deliveryChannel: current.deliveryChannel || "last",
    };
  }
  return {
    ...current,
    templateId: "custom",
    scheduleKind: current.scheduleKind ?? "every",
    everyAmount: current.everyAmount ?? 30,
    everyUnit: current.everyUnit ?? "minutes",
    deliveryMode: current.deliveryMode ?? "announce",
    deliveryChannel: current.deliveryChannel || "last",
  };
};

export const AgentSettingsPanel = ({
  agent,
  onClose,
  onRename,
  onNewSession,
  onDelete,
  canDelete = true,
  onToolCallingToggle,
  onThinkingTracesToggle,
  cronJobs,
  cronLoading,
  cronError,
  cronRunBusyJobId,
  cronDeleteBusyJobId,
  onRunCronJob,
  onDeleteCronJob,
  cronCreateBusy = false,
  onCreateCronJob = () => {},
  heartbeats = [],
  heartbeatLoading = false,
  heartbeatError = null,
  heartbeatRunBusyId = null,
  heartbeatDeleteBusyId = null,
  onRunHeartbeat = () => {},
  onDeleteHeartbeat = () => {},
}: AgentSettingsPanelProps) => {
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [expandedCronJobIds, setExpandedCronJobIds] = useState<Set<string>>(() => new Set());
  const [cronCreateOpen, setCronCreateOpen] = useState(false);
  const [cronCreateStep, setCronCreateStep] = useState(0);
  const [cronCreateError, setCronCreateError] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState<CronCreateDraft>(createInitialCronDraft);

  useEffect(() => {
    setNameDraft(agent.name);
    setRenameError(null);
  }, [agent.agentId, agent.name]);

  const handleRename = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setRenameError("Agent name is required.");
      return;
    }
    if (next === agent.name) {
      setRenameError(null);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      const ok = await onRename(next);
      if (!ok) {
        setRenameError("Failed to rename agent.");
        return;
      }
      setNameDraft(next);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleNewSession = async () => {
    setSessionBusy(true);
    try {
      await onNewSession();
    } finally {
      setSessionBusy(false);
    }
  };

  const openCronCreate = () => {
    setCronCreateOpen(true);
    setCronCreateStep(0);
    setCronCreateError(null);
    setCronDraft(createInitialCronDraft());
  };

  const closeCronCreate = () => {
    setCronCreateOpen(false);
    setCronCreateStep(0);
    setCronCreateError(null);
    setCronDraft(createInitialCronDraft());
  };

  const updateCronDraft = (patch: Partial<CronCreateDraft>) => {
    setCronDraft((prev) => ({ ...prev, ...patch }));
  };

  const selectCronTemplate = (templateId: CronCreateTemplateId) => {
    setCronDraft((prev) => applyTemplateDefaults(templateId, prev));
  };

  const canMoveToScheduleStep = cronDraft.name.trim().length > 0 && cronDraft.taskText.trim().length > 0;
  const canMoveToReviewStep =
    cronDraft.scheduleKind === "every"
      ? Number.isFinite(cronDraft.everyAmount) && (cronDraft.everyAmount ?? 0) > 0
      : cronDraft.scheduleKind === "at"
        ? (cronDraft.scheduleAt ?? "").trim().length > 0
        : (cronDraft.cronExpr ?? "").trim().length > 0;
  const canSubmitCronCreate = canMoveToScheduleStep && canMoveToReviewStep;

  const submitCronCreate = async () => {
    if (cronCreateBusy || !canSubmitCronCreate) {
      return;
    }
    setCronCreateError(null);
    const payload: CronCreateDraft = {
      templateId: cronDraft.templateId,
      name: cronDraft.name.trim(),
      taskText: cronDraft.taskText.trim(),
      scheduleKind: cronDraft.scheduleKind,
      ...(typeof cronDraft.everyAmount === "number" ? { everyAmount: cronDraft.everyAmount } : {}),
      ...(cronDraft.everyUnit ? { everyUnit: cronDraft.everyUnit } : {}),
      ...(cronDraft.scheduleAt ? { scheduleAt: cronDraft.scheduleAt } : {}),
      ...(cronDraft.cronExpr ? { cronExpr: cronDraft.cronExpr } : {}),
      ...(cronDraft.cronTz ? { cronTz: cronDraft.cronTz } : {}),
      ...(cronDraft.deliveryMode ? { deliveryMode: cronDraft.deliveryMode } : {}),
      ...(cronDraft.deliveryChannel ? { deliveryChannel: cronDraft.deliveryChannel } : {}),
      ...(cronDraft.deliveryTo ? { deliveryTo: cronDraft.deliveryTo } : {}),
      ...(cronDraft.advancedSessionTarget
        ? { advancedSessionTarget: cronDraft.advancedSessionTarget }
        : {}),
      ...(cronDraft.advancedWakeMode ? { advancedWakeMode: cronDraft.advancedWakeMode } : {}),
    };
    try {
      await onCreateCronJob(payload);
      closeCronCreate();
    } catch (err) {
      setCronCreateError(err instanceof Error ? err.message : "Failed to create cron job.");
    }
  };

  const moveCronCreateBack = () => {
    setCronCreateStep((prev) => Math.max(0, prev - 1));
  };

  const moveCronCreateNext = () => {
    if (cronCreateStep === 0) {
      setCronCreateStep(1);
      return;
    }
    if (cronCreateStep === 1 && canMoveToScheduleStep) {
      setCronCreateStep(2);
      return;
    }
    if (cronCreateStep === 2 && canMoveToReviewStep) {
      setCronCreateStep(3);
    }
  };

  return (
    <div
      className="agent-inspect-panel"
      data-testid="agent-settings-panel"
      style={{ position: "relative", left: "auto", top: "auto", width: "100%", height: "100%" }}
    >
      <AgentInspectHeader
        label="Agent settings"
        title={agent.name}
        onClose={onClose}
        closeTestId="agent-settings-close"
      />

      <div className="flex flex-col gap-4 p-4">
        <section
          className="rounded-md border border-border/80 bg-card/70 p-4"
          data-testid="agent-settings-identity"
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Identity
          </div>
          <label className="mt-3 flex flex-col gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span>Agent name</span>
            <input
              aria-label="Agent name"
              className="h-10 rounded-md border border-border bg-card/75 px-3 text-xs font-semibold text-foreground outline-none"
              value={nameDraft}
              disabled={renameSaving}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          {renameError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {renameError}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              className="rounded-md border border-transparent bg-primary/90 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
              type="button"
              onClick={() => {
                void handleRename();
              }}
              disabled={renameSaving}
            >
              {renameSaving ? "Saving..." : "Update Name"}
            </button>
          </div>
        </section>

        <section
          className="rounded-md border border-border/80 bg-card/70 p-4"
          data-testid="agent-settings-display"
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Display
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Show tool calls</span>
              <input
                aria-label="Show tool calls"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-foreground"
                checked={agent.toolCallingEnabled}
                onChange={(event) => onToolCallingToggle(event.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Show thinking</span>
              <input
                aria-label="Show thinking"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-foreground"
                checked={agent.showThinkingTraces}
                onChange={(event) => onThinkingTracesToggle(event.target.checked)}
              />
            </label>
          </div>
        </section>

        <section
          className="rounded-md border border-border/80 bg-card/70 p-4"
          data-testid="agent-settings-session"
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Session
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Start this agent in a fresh session and clear the visible transcript in Studio.
          </div>
          <button
            className="mt-3 w-full rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            onClick={() => {
              void handleNewSession();
            }}
            disabled={sessionBusy}
          >
            {sessionBusy ? "Starting..." : "New session"}
          </button>
        </section>

        <section
          className="rounded-md border border-border/80 bg-card/70 p-4"
          data-testid="agent-settings-cron"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Cron jobs
            </div>
            {!cronLoading && !cronError && cronJobs.length > 0 ? (
              <button
                className="rounded-md border border-border/80 bg-card/75 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={openCronCreate}
              >
                Create
              </button>
            ) : null}
          </div>
          {cronLoading ? (
            <div className="mt-3 text-[11px] text-muted-foreground">Loading cron jobs...</div>
          ) : null}
          {!cronLoading && cronError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {cronError}
            </div>
          ) : null}
          {!cronLoading && !cronError && cronJobs.length === 0 ? (
            <>
              <div className="mt-3 text-[11px] text-muted-foreground">
                No cron jobs for this agent.
              </div>
              <button
                className="mt-3 w-full rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={openCronCreate}
              >
                Create
              </button>
            </>
          ) : null}
          {!cronLoading && !cronError && cronJobs.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {cronJobs.map((job) => {
                const runBusy = cronRunBusyJobId === job.id;
                const deleteBusy = cronDeleteBusyJobId === job.id;
                const busy = runBusy || deleteBusy;
                const scheduleText = formatCronSchedule(job.schedule);
                const payloadText = formatCronPayload(job.payload).trim();
                const payloadPreview = getFirstLinePreview(payloadText, 160);
                const payloadExpandable =
                  payloadText.length > payloadPreview.length || payloadText.split("\n").length > 1;
                const expanded = expandedCronJobIds.has(job.id);
                const stateLine = formatCronStateLine(job);
                return (
                  <div
                    key={job.id}
                    className="group/cron flex items-start justify-between gap-2 rounded-md border border-border/80 bg-card/75 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                          {job.name}
                        </div>
                        {!job.enabled ? (
                          <div className="shrink-0 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Disabled
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Schedule
                        </span>
                        <div className="break-words">{scheduleText}</div>
                      </div>
                      {stateLine ? (
                        <div className="mt-1 break-words text-[11px] text-muted-foreground">
                          {stateLine}
                        </div>
                      ) : null}
                      {payloadText ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              Task
                            </span>
                            {payloadExpandable ? (
                              <button
                                className="shrink-0 rounded-md border border-border/80 bg-card/70 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-muted/65"
                                type="button"
                                onClick={() => {
                                  setExpandedCronJobIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(job.id)) {
                                      next.delete(job.id);
                                    } else {
                                      next.add(job.id);
                                    }
                                    return next;
                                  });
                                }}
                              >
                                {expanded ? "Less" : "More"}
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-0.5 whitespace-pre-wrap break-words" title={payloadText}>
                            {expanded ? payloadText : payloadPreview || payloadText}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition group-focus-within/cron:opacity-100 group-hover/cron:opacity-100">
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground transition hover:border-border hover:bg-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        aria-label={`Run cron job ${job.name} now`}
                        onClick={() => {
                          void onRunCronJob(job.id);
                        }}
                        disabled={busy}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-destructive/40 bg-transparent text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        aria-label={`Delete cron job ${job.name}`}
                        onClick={() => {
                          void onDeleteCronJob(job.id);
                        }}
                        disabled={busy}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        <section
          className="rounded-md border border-border/80 bg-card/70 p-4"
          data-testid="agent-settings-heartbeat"
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Heartbeats
          </div>
          {heartbeatLoading ? (
            <div className="mt-3 text-[11px] text-muted-foreground">Loading heartbeats...</div>
          ) : null}
          {!heartbeatLoading && heartbeatError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {heartbeatError}
            </div>
          ) : null}
          {!heartbeatLoading && !heartbeatError && heartbeats.length === 0 ? (
            <div className="mt-3 text-[11px] text-muted-foreground">
              No heartbeats for this agent.
            </div>
          ) : null}
          {!heartbeatLoading && !heartbeatError && heartbeats.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {heartbeats.map((heartbeat) => {
                const runBusy = heartbeatRunBusyId === heartbeat.id;
                const deleteBusy = heartbeatDeleteBusyId === heartbeat.id;
                const busy = runBusy || deleteBusy;
                const deleteAllowed = heartbeat.source === "override";
                return (
                  <div
                    key={heartbeat.id}
                    className="group/heartbeat flex items-start justify-between gap-2 rounded-md border border-border/80 bg-card/75 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                        {heartbeat.agentId}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatHeartbeatSchedule(heartbeat)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatHeartbeatTarget(heartbeat)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatHeartbeatSource(heartbeat)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition group-focus-within/heartbeat:opacity-100 group-hover/heartbeat:opacity-100">
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground transition hover:border-border hover:bg-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        aria-label={`Run heartbeat for ${heartbeat.agentId} now`}
                        onClick={() => {
                          void onRunHeartbeat(heartbeat.id);
                        }}
                        disabled={busy}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-destructive/40 bg-transparent text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        aria-label={`Delete heartbeat for ${heartbeat.agentId}`}
                        onClick={() => {
                          void onDeleteHeartbeat(heartbeat.id);
                        }}
                        disabled={busy || !deleteAllowed}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {canDelete ? (
          <section className="rounded-md border border-destructive/30 bg-destructive/4 p-4">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-destructive">
              Delete agent
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              Removes the agent from the gateway config and deletes its cron jobs.
            </div>
            <button
              className="mt-3 w-full rounded-md border border-destructive/50 bg-transparent px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive shadow-sm transition hover:bg-destructive/10"
              type="button"
              onClick={onDelete}
            >
              Delete agent
            </button>
          </section>
        ) : (
          <section className="rounded-md border border-border/80 bg-card/70 p-4">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              System agent
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              The main agent is reserved and cannot be deleted.
            </div>
          </section>
        )}
      </div>
      {cronCreateOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Create cron job"
          onClick={closeCronCreate}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card/95 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Cron job composer
                </div>
                <div className="mt-1 text-base font-semibold text-foreground">Create cron job</div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md border border-border/80 bg-card/70 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-muted/65"
                onClick={closeCronCreate}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-4 py-4">
              {cronCreateError ? (
                <div className="rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
                  {cronCreateError}
                </div>
              ) : null}
              {cronCreateStep === 0 ? (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Choose a starter template to prefill your cron job.
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CRON_TEMPLATE_OPTIONS.map((option) => {
                      const active = option.id === cronDraft.templateId;
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-label={option.title}
                          className={`rounded-md border px-3 py-3 text-left transition ${
                            active
                              ? `${option.accent} border-border`
                              : "border-border/80 bg-card/75 hover:border-border hover:bg-muted/60"
                          }`}
                          onClick={() => selectCronTemplate(option.id)}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-foreground" />
                            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                              {option.title}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{option.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {cronCreateStep === 1 ? (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Define what this cron job should do.
                  </div>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                      Job name
                    </span>
                    <input
                      aria-label="Job name"
                      className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                      value={cronDraft.name}
                      onChange={(event) => updateCronDraft({ name: event.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                      Task
                    </span>
                    <textarea
                      aria-label="Task"
                      className="min-h-28 rounded-md border border-border bg-card/75 px-3 py-2 text-sm text-foreground outline-none"
                      value={cronDraft.taskText}
                      onChange={(event) => updateCronDraft({ taskText: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}
              {cronCreateStep === 2 ? (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">Choose when this should run.</div>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                      Schedule type
                    </span>
                    <select
                      className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                      value={cronDraft.scheduleKind}
                      onChange={(event) =>
                        updateCronDraft({ scheduleKind: event.target.value as CronCreateDraft["scheduleKind"] })
                      }
                    >
                      <option value="every">Every</option>
                      <option value="at">One time</option>
                      <option value="cron">Advanced cron</option>
                    </select>
                  </label>
                  {cronDraft.scheduleKind === "every" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                          Every
                        </span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                          value={String(cronDraft.everyAmount ?? 30)}
                          onChange={(event) =>
                            updateCronDraft({
                              everyAmount: Number.parseInt(event.target.value, 10) || 0,
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                          Unit
                        </span>
                        <select
                          className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                          value={cronDraft.everyUnit ?? "minutes"}
                          onChange={(event) =>
                            updateCronDraft({
                              everyUnit: event.target.value as CronCreateDraft["everyUnit"],
                            })
                          }
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {cronDraft.scheduleKind === "at" ? (
                    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                        Run at
                      </span>
                      <input
                        type="datetime-local"
                        className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                        value={cronDraft.scheduleAt ?? ""}
                        onChange={(event) => updateCronDraft({ scheduleAt: event.target.value })}
                      />
                    </label>
                  ) : null}
                  {cronDraft.scheduleKind === "cron" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                          Expression
                        </span>
                        <input
                          className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                          value={cronDraft.cronExpr ?? ""}
                          onChange={(event) => updateCronDraft({ cronExpr: event.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                          Timezone
                        </span>
                        <input
                          className="h-10 rounded-md border border-border bg-card/75 px-3 text-sm text-foreground outline-none"
                          value={cronDraft.cronTz ?? ""}
                          onChange={(event) => updateCronDraft({ cronTz: event.target.value })}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {cronCreateStep === 3 ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div>Review your cron job configuration before creating it.</div>
                  <div className="rounded-md border border-border/80 bg-card/75 px-3 py-2">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                      {cronDraft.name || "Untitled cron job"}
                    </div>
                    <div className="mt-1 text-[11px]">{cronDraft.taskText || "No task provided."}</div>
                    <div className="mt-2 text-[11px]">
                      Schedule:{" "}
                      {cronDraft.scheduleKind === "every"
                        ? `Every ${cronDraft.everyAmount ?? 0} ${cronDraft.everyUnit ?? "minutes"}`
                        : cronDraft.scheduleKind === "at"
                          ? `At ${cronDraft.scheduleAt ?? ""}`
                          : `Cron ${cronDraft.cronExpr ?? ""}${cronDraft.cronTz ? ` (${cronDraft.cronTz})` : ""}`}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border/80 px-4 py-3">
              <div className="text-[11px] text-muted-foreground">Step {cronCreateStep + 1} of 4</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={moveCronCreateBack}
                  disabled={cronCreateStep === 0 || cronCreateBusy}
                >
                  Back
                </button>
                {cronCreateStep < 3 ? (
                  <button
                    type="button"
                    className="rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={moveCronCreateNext}
                    disabled={
                      cronCreateBusy ||
                      (cronCreateStep === 1 && !canMoveToScheduleStep) ||
                      (cronCreateStep === 2 && !canMoveToReviewStep)
                    }
                  >
                    Next
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-transparent bg-primary/90 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                  onClick={() => {
                    void submitCronCreate();
                  }}
                  disabled={cronCreateBusy || cronCreateStep !== 3 || !canSubmitCronCreate}
                >
                  Create cron job
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

type AgentBrainPanelProps = {
  client: GatewayClient;
  agents: AgentState[];
  selectedAgentId: string | null;
  onClose: () => void;
};

type AgentFilesState = ReturnType<typeof createAgentFilesState>;

type UseAgentFilesEditorResult = {
  agentFiles: AgentFilesState;
  agentFileTab: AgentFileName;
  agentFilesLoading: boolean;
  agentFilesSaving: boolean;
  agentFilesDirty: boolean;
  agentFilesError: string | null;
  setAgentFileContent: (value: string) => void;
  handleAgentFileTabChange: (nextTab: AgentFileName) => Promise<void>;
  saveAgentFiles: () => Promise<boolean>;
  reloadAgentFiles: () => Promise<void>;
};

const useAgentFilesEditor = (params: {
  client: GatewayClient | null | undefined;
  agentId: string | null | undefined;
}): UseAgentFilesEditorResult => {
  const { client, agentId } = params;
  const [agentFiles, setAgentFiles] = useState(createAgentFilesState);
  const [agentFileTab, setAgentFileTab] = useState<AgentFileName>(AGENT_FILE_NAMES[0]);
  const [agentFilesLoading, setAgentFilesLoading] = useState(false);
  const [agentFilesSaving, setAgentFilesSaving] = useState(false);
  const [agentFilesDirty, setAgentFilesDirty] = useState(false);
  const [agentFilesError, setAgentFilesError] = useState<string | null>(null);

  const loadAgentFiles = useCallback(async () => {
    setAgentFilesLoading(true);
    setAgentFilesError(null);
    try {
      const trimmedAgentId = agentId?.trim();
      if (!trimmedAgentId) {
        setAgentFiles(createAgentFilesState());
        setAgentFilesDirty(false);
        setAgentFilesError("Agent ID is missing for this agent.");
        return;
      }
      if (!client) {
        setAgentFilesError("Gateway client is not available.");
        return;
      }
      const results = await Promise.all(
        AGENT_FILE_NAMES.map(async (name) => {
          const file = await readGatewayAgentFile({ client, agentId: trimmedAgentId, name });
          return { name, content: file.content, exists: file.exists };
        })
      );
      const nextState = createAgentFilesState();
      for (const file of results) {
        if (!isAgentFileName(file.name)) continue;
        nextState[file.name] = {
          content: file.content ?? "",
          exists: Boolean(file.exists),
        };
      }
      setAgentFiles(nextState);
      setAgentFilesDirty(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agent files.";
      setAgentFilesError(message);
    } finally {
      setAgentFilesLoading(false);
    }
  }, [agentId, client]);

  const saveAgentFiles = useCallback(async () => {
    setAgentFilesSaving(true);
    setAgentFilesError(null);
    try {
      const trimmedAgentId = agentId?.trim();
      if (!trimmedAgentId) {
        setAgentFilesError("Agent ID is missing for this agent.");
        return false;
      }
      if (!client) {
        setAgentFilesError("Gateway client is not available.");
        return false;
      }
      await Promise.all(
        AGENT_FILE_NAMES.map(async (name) => {
          await writeGatewayAgentFile({
            client,
            agentId: trimmedAgentId,
            name,
            content: agentFiles[name].content,
          });
        })
      );
      const nextState = createAgentFilesState();
      for (const name of AGENT_FILE_NAMES) {
        nextState[name] = {
          content: agentFiles[name].content,
          exists: true,
        };
      }
      setAgentFiles(nextState);
      setAgentFilesDirty(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save agent files.";
      setAgentFilesError(message);
      return false;
    } finally {
      setAgentFilesSaving(false);
    }
  }, [agentFiles, agentId, client]);

  const handleAgentFileTabChange = useCallback(
    async (nextTab: AgentFileName) => {
      if (nextTab === agentFileTab) return;
      if (agentFilesDirty && !agentFilesSaving) {
        const saved = await saveAgentFiles();
        if (!saved) return;
      }
      setAgentFileTab(nextTab);
    },
    [agentFileTab, agentFilesDirty, agentFilesSaving, saveAgentFiles]
  );

  const setAgentFileContent = useCallback(
    (value: string) => {
      setAgentFiles((prev) => ({
        ...prev,
        [agentFileTab]: { ...prev[agentFileTab], content: value },
      }));
      setAgentFilesDirty(true);
    },
    [agentFileTab]
  );

  useEffect(() => {
    void loadAgentFiles();
  }, [loadAgentFiles]);

  useEffect(() => {
    if (!AGENT_FILE_NAMES.includes(agentFileTab)) {
      setAgentFileTab(AGENT_FILE_NAMES[0]);
    }
  }, [agentFileTab]);

  return {
    agentFiles,
    agentFileTab,
    agentFilesLoading,
    agentFilesSaving,
    agentFilesDirty,
    agentFilesError,
    setAgentFileContent,
    handleAgentFileTabChange,
    saveAgentFiles,
    reloadAgentFiles: loadAgentFiles,
  };
};

export const AgentBrainPanel = ({
  client,
  agents,
  selectedAgentId,
  onClose,
}: AgentBrainPanelProps) => {
  const selectedAgent = useMemo(
    () =>
      selectedAgentId
        ? agents.find((entry) => entry.agentId === selectedAgentId) ?? null
        : null,
    [agents, selectedAgentId]
  );

  const {
    agentFiles,
    agentFileTab,
    agentFilesLoading,
    agentFilesSaving,
    agentFilesDirty,
    agentFilesError,
    setAgentFileContent,
    handleAgentFileTabChange,
    saveAgentFiles,
    reloadAgentFiles,
  } = useAgentFilesEditor({ client, agentId: selectedAgent?.agentId ?? null });
  const [previewMode, setPreviewMode] = useState(true);

  const handleTabChange = useCallback(
    async (nextTab: AgentFileName) => {
      await handleAgentFileTabChange(nextTab);
    },
    [handleAgentFileTabChange]
  );

  const handleClose = useCallback(async () => {
    if (agentFilesSaving) return;
    if (agentFilesDirty) {
      const saved = await saveAgentFiles();
      if (!saved) return;
    }
    onClose();
  }, [agentFilesDirty, agentFilesSaving, onClose, saveAgentFiles]);

  return (
    <div
      className="agent-inspect-panel flex min-h-0 flex-col overflow-hidden"
      data-testid="agent-brain-panel"
      style={{ position: "relative", left: "auto", top: "auto", width: "100%", height: "100%" }}
    >
      <AgentInspectHeader
        label="Brain files"
        title={selectedAgent?.name ?? "No agent selected"}
        onClose={() => {
          void handleClose();
        }}
        closeTestId="agent-brain-close"
        closeDisabled={agentFilesSaving}
      />

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <section className="flex min-h-0 flex-1 flex-col" data-testid="agent-brain-files">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {AGENT_FILE_META[agentFileTab].hint}
            </div>
          </div>
          {agentFilesError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {agentFilesError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            {AGENT_FILE_NAMES.map((name) => {
              const active = name === agentFileTab;
              const label = AGENT_FILE_META[name].title.replace(".md", "");
              return (
                <button
                  key={name}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                    active
                      ? "border-border bg-background text-foreground shadow-sm"
                      : "border-transparent bg-muted/60 text-muted-foreground hover:border-border/80 hover:bg-muted"
                  }`}
                  onClick={() => {
                    void handleTabChange(name);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-end gap-1">
            <button
              type="button"
              className="rounded-md border border-border/70 bg-card/60 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:bg-muted/70 disabled:opacity-50"
              disabled={agentFilesLoading || agentFilesSaving || agentFilesDirty}
              onClick={() => {
                void reloadAgentFiles();
              }}
              title={agentFilesDirty ? "Save changes before reloading." : "Reload from gateway"}
            >
              Reload
            </button>
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                previewMode
                  ? "border-border bg-background text-foreground"
                  : "border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/70"
              }`}
              onClick={() => setPreviewMode(true)}
            >
              Preview
            </button>
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                previewMode
                  ? "border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/70"
                  : "border-border bg-background text-foreground"
              }`}
              onClick={() => setPreviewMode(false)}
            >
              Edit
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 rounded-md bg-muted/30 p-2">
            {previewMode ? (
              <div className="agent-markdown h-full overflow-y-auto rounded-md border border-border/80 bg-background/80 px-3 py-2 text-xs text-foreground">
                {agentFiles[agentFileTab].content.trim().length === 0 ? (
                  <p className="text-muted-foreground">
                    {AGENT_FILE_PLACEHOLDERS[agentFileTab]}
                  </p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {agentFiles[agentFileTab].content}
                  </ReactMarkdown>
                )}
              </div>
            ) : (
              <textarea
                className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-md border border-border/80 bg-background/80 px-3 py-2 font-mono text-xs text-foreground outline-none"
                value={agentFiles[agentFileTab].content}
                placeholder={
                  agentFiles[agentFileTab].content.trim().length === 0
                    ? AGENT_FILE_PLACEHOLDERS[agentFileTab]
                    : undefined
                }
                disabled={agentFilesLoading || agentFilesSaving}
                onChange={(event) => {
                  setAgentFileContent(event.target.value);
                }}
              />
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 pt-2">
            <div className="text-xs text-muted-foreground">All changes saved</div>
          </div>
        </section>
      </div>
    </div>
  );
};
