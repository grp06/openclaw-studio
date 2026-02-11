import type { SessionStatus } from "../state/types";
import { SessionCard } from "./SessionCard";

type SessionOverviewProps = {
  sessions: SessionStatus[];
  selectedSession: string | null;
  onSelectSession: (sessionKey: string | null) => void;
};

const statusOrder: Record<SessionStatus["status"], number> = {
  error: 0,
  running: 1,
  idle: 2,
};

export const SessionOverview = ({
  sessions,
  selectedSession,
  onSelectSession,
}: SessionOverviewProps) => {
  const sorted = [...sessions].sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Sessions
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {sessions.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/50">
            No sessions
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((session) => (
              <SessionCard
                key={session.sessionKey}
                session={session}
                isSelected={selectedSession === session.sessionKey}
                onSelect={onSelectSession}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
