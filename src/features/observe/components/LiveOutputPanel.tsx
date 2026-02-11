import type { SessionStatus } from "../state/types";

type LiveOutputPanelProps = {
  session: SessionStatus;
};

export const LiveOutputPanel = ({ session }: LiveOutputPanelProps) => {
  const name =
    session.displayName ?? session.agentId ?? session.sessionKey.slice(0, 20);

  return (
    <div className="glass-panel flex flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-semibold text-foreground">{name}</span>
          {session.origin !== "unknown" && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {session.origin}
            </span>
          )}
        </div>
        {session.currentActivity && (
          <span className="text-[11px] text-muted-foreground">
            {session.currentActivity}
          </span>
        )}
      </div>

      {session.streamingText ? (
        <div className="max-h-[200px] overflow-y-auto px-4 py-3">
          <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/85">
            {session.streamingText.slice(-1000)}
          </pre>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground/60">
            {session.currentToolName ? (
              <>
                <span className="text-blue-400">{session.currentToolName}</span>
                {session.currentToolArgs && (
                  <span className="truncate">
                    {session.currentToolArgs.slice(0, 100)}
                  </span>
                )}
              </>
            ) : (
              <span>Waiting for output...</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
