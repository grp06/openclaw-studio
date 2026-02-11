import type { SessionStatus } from "../state/types";

type SessionCardProps = {
  session: SessionStatus;
  isSelected: boolean;
  onSelect: (sessionKey: string | null) => void;
};

const statusStyles: Record<
  SessionStatus["status"],
  { label: string; className: string }
> = {
  idle: {
    label: "Idle",
    className: "border-border/50 bg-muted/20",
  },
  running: {
    label: "Running",
    className:
      "border-primary/40 bg-primary/5 shadow-[0_0_12px_rgba(var(--primary-rgb,100,100,255),0.12)]",
  },
  error: {
    label: "Error",
    className: "border-red-500/40 bg-red-500/5",
  },
};

const originBadge: Record<
  SessionStatus["origin"],
  { label: string; className: string }
> = {
  interactive: {
    label: "Interactive",
    className: "bg-blue-500/15 text-blue-400",
  },
  cron: {
    label: "Cron",
    className: "bg-amber-500/15 text-amber-400",
  },
  heartbeat: {
    label: "Heartbeat",
    className: "bg-muted text-muted-foreground",
  },
  unknown: {
    label: "Session",
    className: "bg-muted text-muted-foreground",
  },
};

const formatRelativeTime = (ts: number | null): string => {
  if (!ts) return "-";
  const diff = Date.now() - ts;
  if (diff < 1000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

export const SessionCard = ({
  session,
  isSelected,
  onSelect,
}: SessionCardProps) => {
  const statusConfig = statusStyles[session.status];
  const originConfig = originBadge[session.origin];
  const displayName =
    session.displayName ??
    session.agentId ??
    session.sessionKey.slice(0, 20);

  return (
    <button
      type="button"
      onClick={() => onSelect(isSelected ? null : session.sessionKey)}
      className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/20 ${statusConfig.className} ${isSelected ? "ring-1 ring-primary/50" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {displayName}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${originConfig.className}`}
        >
          {originConfig.label}
        </span>
      </div>

      {/* Status + current tool */}
      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <span
          className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider ${
            session.status === "running"
              ? "text-primary"
              : session.status === "error"
                ? "text-red-400"
                : "text-muted-foreground/60"
          }`}
        >
          {session.status === "running" && (
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
          {statusConfig.label}
        </span>
        <span className="text-muted-foreground/40">
          {formatRelativeTime(session.lastActivityAt)}
        </span>
      </div>

      {/* Current activity description */}
      {session.currentActivity && session.status === "running" && (
        <div className="mt-2 truncate rounded bg-muted/30 px-2 py-1 text-[11px] text-foreground/80">
          {session.currentActivity}
        </div>
      )}

      {/* Streaming text preview */}
      {session.streamingText && session.status === "running" && (
        <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/70 italic">
          {session.streamingText.slice(-200)}
        </div>
      )}

      {/* Error */}
      {session.lastError && session.status === "error" && (
        <div className="mt-2 truncate rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
          {session.lastError}
        </div>
      )}
    </button>
  );
};
