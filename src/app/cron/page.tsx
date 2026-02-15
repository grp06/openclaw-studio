"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Play,
  Loader2,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useGatewayConnectionContext } from "@/lib/gateway/GatewayConnectionContext";

/* ── Types ────────────────────────────────────────────────── */

type CronSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  | { kind: "at"; at: string };

type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string; model?: string; timeoutSeconds?: number };

interface CronJob {
  jobId: string;
  name?: string;
  schedule: CronSchedule;
  payload: CronPayload;
  sessionTarget: "main" | "isolated";
  enabled: boolean;
  delivery?: unknown;
  lastRunAt?: string;
  nextRunAt?: string;
}

/* ── Helpers ──────────────────────────────────────────────── */

function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "cron":
      return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    case "every": {
      const ms = schedule.everyMs;
      if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
      if (ms < 86_400_000) return `every ${(ms / 3_600_000).toFixed(1)}h`;
      return `every ${(ms / 86_400_000).toFixed(1)}d`;
    }
    case "at":
      return `once at ${new Date(schedule.at).toLocaleString()}`;
  }
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/* ── Job Card ─────────────────────────────────────────────── */

function JobCard({
  job,
  onToggle,
  onDelete,
  onRunNow,
}: {
  job: CronJob;
  onToggle: (jobId: string, enabled: boolean) => void;
  onDelete: (jobId: string) => void;
  onRunNow: (jobId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onDelete(job.jobId);
    setConfirming(false);
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunNow(job.jobId);
    } finally {
      setTimeout(() => setRunning(false), 1000);
    }
  };

  const payloadText =
    job.payload.kind === "systemEvent" ? job.payload.text : job.payload.message;

  return (
    <div
      className={`bg-zinc-900 border rounded-md px-4 py-3 group transition-colors ${
        job.enabled ? "border-zinc-800" : "border-zinc-800/50 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">
              {job.name || job.jobId}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                job.enabled
                  ? "bg-green-900/40 text-green-400"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {job.enabled ? "enabled" : "disabled"}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                job.sessionTarget === "main"
                  ? "bg-blue-900/40 text-blue-400"
                  : "bg-purple-900/40 text-purple-400"
              }`}
            >
              {job.sessionTarget}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                job.payload.kind === "systemEvent"
                  ? "bg-amber-900/40 text-amber-400"
                  : "bg-cyan-900/40 text-cyan-400"
              }`}
            >
              {job.payload.kind}
            </span>
          </div>
          <div className="text-xs text-zinc-400 mt-1">{formatSchedule(job.schedule)}</div>
          <div className="text-xs text-zinc-500 mt-1 truncate">{payloadText}</div>
          <div className="flex gap-4 mt-2 text-[10px] text-zinc-600">
            <span>Last run: {formatTime(job.lastRunAt)}</span>
            <span>Next run: {formatTime(job.nextRunAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleRun}
            disabled={running}
            className="p-1.5 rounded text-zinc-600 hover:text-green-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Run now"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
          <button
            onClick={() => onToggle(job.jobId, !job.enabled)}
            className={`p-1.5 rounded transition-colors ${
              job.enabled
                ? "text-green-500 hover:text-yellow-400 hover:bg-zinc-800"
                : "text-zinc-600 hover:text-green-400 hover:bg-zinc-800"
            }`}
            title={job.enabled ? "Disable" : "Enable"}
          >
            {job.enabled ? <Power size={14} /> : <PowerOff size={14} />}
          </button>
          <button
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
            className={`p-1.5 rounded transition-colors ${
              confirming
                ? "text-red-400 bg-red-900/30"
                : "text-zinc-600 hover:text-red-400 hover:bg-zinc-800"
            }`}
            title={confirming ? "Click again to confirm" : "Delete"}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Create Form ──────────────────────────────────────────── */

type ScheduleKind = "cron" | "every";
type SessionTarget = "main" | "isolated";

function CronCreateForm({ onAdd }: { onAdd: (job: {
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  sessionTarget: SessionTarget;
  enabled: boolean;
}) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("cron");
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [tz, setTz] = useState("");
  const [everyMinutes, setEveryMinutes] = useState(60);
  const [sessionTarget, setSessionTarget] = useState<SessionTarget>("isolated");
  const [payloadText, setPayloadText] = useState("");

  const payloadKind = sessionTarget === "main" ? "systemEvent" : "agentTurn";

  const resetForm = () => {
    setName("");
    setScheduleKind("cron");
    setCronExpr("0 9 * * *");
    setTz("");
    setEveryMinutes(60);
    setSessionTarget("isolated");
    setPayloadText("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payloadText.trim()) return;

    const schedule: CronSchedule =
      scheduleKind === "cron"
        ? { kind: "cron", expr: cronExpr.trim(), ...(tz.trim() ? { tz: tz.trim() } : {}) }
        : { kind: "every", everyMs: everyMinutes * 60_000 };

    const payload: CronPayload =
      payloadKind === "systemEvent"
        ? { kind: "systemEvent", text: payloadText.trim() }
        : { kind: "agentTurn", message: payloadText.trim() };

    onAdd({
      name: name.trim() || payloadText.trim().slice(0, 40),
      schedule,
      payload,
      sessionTarget,
      enabled: true,
    });

    resetForm();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Plus size={14} />
        New Cron Job
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">New Cron Job</span>
        <button
          type="button"
          onClick={() => { resetForm(); setOpen(false); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Name */}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Job name (optional)"
        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
      />

      {/* Schedule */}
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Schedule type</label>
          <select
            value={scheduleKind}
            onChange={(e) => setScheduleKind(e.target.value as ScheduleKind)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="cron">Cron expression</option>
            <option value="every">Every interval</option>
          </select>
        </div>

        {scheduleKind === "cron" ? (
          <>
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] text-zinc-500 block mb-1">Expression</label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Timezone (opt)</label>
              <input
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="America/Los_Angeles"
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-44"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Every (minutes)</label>
            <input
              type="number"
              min={1}
              value={everyMinutes}
              onChange={(e) => setEveryMinutes(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 w-24"
            />
          </div>
        )}
      </div>

      {/* Session target */}
      <div className="flex items-end gap-2">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Session target</label>
          <select
            value={sessionTarget}
            onChange={(e) => setSessionTarget(e.target.value as SessionTarget)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="isolated">isolated (agentTurn)</option>
            <option value="main">main (systemEvent)</option>
          </select>
        </div>
        <span className="text-[10px] text-zinc-600 pb-1">
          {sessionTarget === "main" ? "→ systemEvent payload" : "→ agentTurn payload"}
        </span>
      </div>

      {/* Payload */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">
          {payloadKind === "systemEvent" ? "Event text" : "Agent message"}
        </label>
        <textarea
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          placeholder={
            payloadKind === "systemEvent"
              ? "System event text..."
              : "Message for the agent..."
          }
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
        />
      </div>

      <button
        type="submit"
        className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded transition-colors"
      >
        Create Job
      </button>
    </form>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function CronPage() {
  const { client, status } = useGatewayConnectionContext();
  const connected = status === "connected";

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  /* ── Fetch jobs ─────────────────────────────────────────── */
  const loadJobs = useCallback(async () => {
    if (!connected) return;
    try {
      const result = (await client.call("cron.list", { includeDisabled: true })) as {
        jobs: CronJob[];
      };
      setJobs(result.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  }, [client, connected]);

  useEffect(() => {
    setLoading(true);
    void loadJobs();
  }, [loadJobs]);

  /* ── Actions ────────────────────────────────────────────── */
  const handleAdd = async (job: {
    name: string;
    schedule: CronSchedule;
    payload: CronPayload;
    sessionTarget: SessionTarget;
    enabled: boolean;
  }) => {
    try {
      await client.call("cron.add", { job });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add job");
    }
  };

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      await client.call("cron.update", { jobId, patch: { enabled } });
      setJobs((prev) =>
        prev.map((j) => (j.jobId === jobId ? { ...j, enabled } : j)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update job");
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await client.call("cron.remove", { jobId });
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job");
    }
  };

  const handleRunNow = async (jobId: string) => {
    try {
      await client.call("cron.run", { jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run job");
    }
  };

  /* ── Sort ───────────────────────────────────────────────── */
  const sortedJobs = [...jobs].sort((a, b) => {
    const nameA = (a.name ?? a.jobId).toLowerCase();
    const nameB = (b.name ?? b.jobId).toLowerCase();
    return sortAsc ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });

  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950">
      <header className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Cron Jobs</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Scheduled tasks and recurring jobs
              {connected ? (
                <span className="text-green-500 ml-2">● Connected</span>
              ) : (
                <span className="text-zinc-600 ml-2">● Disconnected</span>
              )}
              {jobs.length > 0 && (
                <span className="text-zinc-600 ml-2">
                  · {enabledCount}/{jobs.length} active
                </span>
              )}
            </p>
          </div>
          <CronCreateForm onAdd={handleAdd} />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded text-xs text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-300"
            >
              ×
            </button>
          </div>
        )}

        {loading && connected && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-zinc-600 animate-spin" />
          </div>
        )}

        {!connected && (
          <div className="text-xs text-zinc-600 text-center py-12">
            Connect to gateway to manage cron jobs
          </div>
        )}

        {connected && !loading && jobs.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-12">
            No cron jobs configured. Create one above.
          </div>
        )}

        {connected && !loading && jobs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                {jobs.length} job{jobs.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setSortAsc(!sortAsc)}
                className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Name {sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            </div>
            {sortedJobs.map((job) => (
              <JobCard
                key={job.jobId}
                job={job}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onRunNow={handleRunNow}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
