import Link from "next/link";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import type { SessionStatus } from "../state/types";

type ObserveHeaderBarProps = {
  status: GatewayStatus;
  paused: boolean;
  sessions: SessionStatus[];
  interventionCount: number;
  onTogglePause: () => void;
  onClear: () => void;
};

const statusStyles: Record<
  GatewayStatus,
  { label: string; className: string }
> = {
  disconnected: {
    label: "Disconnected",
    className: "border border-border/70 bg-muted text-muted-foreground",
  },
  connecting: {
    label: "Connecting...",
    className: "border border-border/70 bg-secondary text-secondary-foreground",
  },
  connected: {
    label: "Live",
    className: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  },
};

const buildSummary = (sessions: SessionStatus[]): string => {
  const running = sessions.filter((s) => s.status === "running");
  const errors = sessions.filter((s) => s.status === "error");

  if (running.length === 0 && errors.length === 0) {
    return "All sessions idle";
  }

  const parts: string[] = [];

  for (const s of running) {
    const name = s.displayName ?? s.agentId ?? "session";
    if (s.currentActivity) {
      parts.push(`${name}: ${s.currentActivity}`);
    } else {
      parts.push(`${name} is running`);
    }
  }

  for (const s of errors) {
    const name = s.displayName ?? s.agentId ?? "session";
    parts.push(`${name} has errors`);
  }

  return parts.join("  \u2022  ");
};

export const ObserveHeaderBar = ({
  status,
  paused,
  sessions,
  interventionCount,
  onTogglePause,
  onClear,
}: ObserveHeaderBarProps) => {
  const statusConfig = statusStyles[status];
  const runningSessions = sessions.filter((s) => s.status === "running");
  const summary = buildSummary(sessions);

  return (
    <header className="glass-panel flex flex-col gap-2 rounded-xl px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl tracking-wide text-foreground">
            Milo Observe
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] ${statusConfig.className}`}
          >
            {status === "connected" && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            )}
            {statusConfig.label}
          </span>
          {runningSessions.length > 0 && (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
              {runningSessions.length} active
            </span>
          )}
          {interventionCount > 0 && (
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
              {interventionCount} error{interventionCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePause}
            className="rounded-md border border-input/90 bg-background/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-muted/65"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-input/90 bg-background/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-muted/65"
          >
            Clear
          </button>
          <Link
            href="/"
            target="_blank"
            className="rounded-md border border-input/90 bg-background/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-muted/65"
          >
            Studio
          </Link>
        </div>
      </div>

      {/* High-level activity summary */}
      {status === "connected" && (
        <div className="text-[12px] leading-relaxed text-muted-foreground">
          {summary}
        </div>
      )}
    </header>
  );
};
