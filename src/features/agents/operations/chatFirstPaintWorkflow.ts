export type ChatFirstPaintSource = "transcript" | "provisional" | "none";

export type ResolveChatFirstPaintParams = {
  transcriptItemCount: number;
  lastUserMessage?: string | null;
  latestPreview?: string | null;
  agentId: string;
  sessionKey: string;
  sessionEpoch?: number;
  focusStartedAtMs: number;
  nowMs?: number;
};

export type ChatFirstPaintResolution = {
  cycleKey: string;
  source: ChatFirstPaintSource;
  elapsedMs: number | null;
  hasLastUserMessage: boolean;
  hasLatestPreview: boolean;
};

const normalizeEpoch = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const hasValue = (value: string | null | undefined): boolean => {
  return (value ?? "").trim().length > 0;
};

const toElapsedMs = (focusStartedAtMs: number, nowMs: number): number | null => {
  if (!Number.isFinite(focusStartedAtMs) || focusStartedAtMs <= 0) return null;
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, nowMs - focusStartedAtMs);
};

export const buildChatFirstPaintCycleKey = (params: {
  agentId: string;
  sessionKey: string;
  sessionEpoch?: number;
}): string => {
  return [
    params.agentId.trim(),
    params.sessionKey.trim(),
    String(normalizeEpoch(params.sessionEpoch)),
  ].join(":");
};

export const resolveChatFirstPaint = (
  params: ResolveChatFirstPaintParams
): ChatFirstPaintResolution => {
  const transcriptItemCount = Number.isFinite(params.transcriptItemCount)
    ? Math.max(0, Math.floor(params.transcriptItemCount))
    : 0;
  const hasLastUserMessage = hasValue(params.lastUserMessage);
  const hasLatestPreview = hasValue(params.latestPreview);
  const source: ChatFirstPaintSource =
    transcriptItemCount > 0
      ? "transcript"
      : hasLastUserMessage || hasLatestPreview
        ? "provisional"
        : "none";

  const nowMs = typeof params.nowMs === "number" ? params.nowMs : Date.now();
  const elapsedMs = source === "none" ? null : toElapsedMs(params.focusStartedAtMs, nowMs);

  return {
    cycleKey: buildChatFirstPaintCycleKey({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionEpoch: params.sessionEpoch,
    }),
    source,
    elapsedMs,
    hasLastUserMessage,
    hasLatestPreview,
  };
};
