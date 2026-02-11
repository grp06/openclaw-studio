import type { ObserveEntry } from "../state/types";

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const severityClass: Record<ObserveEntry["severity"], string> = {
  info: "",
  warn: "text-amber-400",
  error: "text-red-400",
};

const streamIcon = (entry: ObserveEntry): string => {
  if (entry.stream === "tool") {
    if (entry.toolPhase === "result") return "\u2713"; // checkmark
    return "\u25B6"; // play triangle
  }
  if (entry.stream === "lifecycle") {
    if (entry.text === "start") return "\u25CF"; // filled circle
    if (entry.text === "end") return "\u25CB"; // empty circle
    if (entry.text === "error") return "\u2717"; // X mark
    return "\u25CF";
  }
  if (entry.stream === "assistant") return "\u270E"; // pencil
  if (entry.eventType === "chat") return "\u2709"; // envelope
  return "\u2022"; // bullet
};

const streamColor = (entry: ObserveEntry): string => {
  if (entry.severity === "error") return "text-red-400";
  if (entry.stream === "tool" && entry.toolPhase !== "result")
    return "text-blue-400";
  if (entry.stream === "tool" && entry.toolPhase === "result")
    return "text-emerald-400";
  if (entry.stream === "lifecycle") return "text-amber-400";
  if (entry.stream === "assistant") return "text-purple-400";
  return "text-muted-foreground";
};

type ActivityFeedEntryProps = {
  entry: ObserveEntry;
};

export const ActivityFeedEntry = ({ entry }: ActivityFeedEntryProps) => {
  const agentLabel = entry.agentId ?? entry.sessionKey?.slice(0, 16) ?? "-";

  return (
    <div
      className={`flex items-start gap-2 border-b border-border/20 px-3 py-2 text-[12px] leading-relaxed ${severityClass[entry.severity]}`}
    >
      <span className="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground/40">
        {formatTime(entry.timestamp)}
      </span>
      <span
        className={`shrink-0 pt-0.5 text-[11px] ${streamColor(entry)}`}
      >
        {streamIcon(entry)}
      </span>
      <span className="shrink-0 min-w-[80px] max-w-[120px] truncate font-semibold text-foreground/70">
        {agentLabel}
      </span>
      <span className={`flex-1 ${entry.severity === "error" ? "text-red-400" : "text-foreground/90"}`}>
        {entry.description}
      </span>
    </div>
  );
};
