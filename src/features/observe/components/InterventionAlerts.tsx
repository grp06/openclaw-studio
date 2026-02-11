import type { ObserveEntry } from "../state/types";

type InterventionAlertsProps = {
  entries: ObserveEntry[];
};

const MAX_ALERTS = 5;

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export const InterventionAlerts = ({ entries }: InterventionAlertsProps) => {
  const errors = entries.filter((e) => e.severity === "error");
  if (errors.length === 0) return null;

  const recent = errors.slice(-MAX_ALERTS).reverse();

  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-red-400">
        Needs Attention ({errors.length})
      </h2>
      <div className="flex flex-col gap-1">
        {recent.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 text-[12px]">
            <span className="shrink-0 font-mono text-[10px] text-red-400/40">
              {formatTime(entry.timestamp)}
            </span>
            <span className="shrink-0 font-semibold text-foreground/80">
              {entry.agentId ?? entry.sessionKey?.slice(0, 16) ?? "-"}
            </span>
            <span className="text-red-300">{entry.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
