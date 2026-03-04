export const GATEWAY_CHAT_HISTORY_MAX_LIMIT = 1000;

export const clampGatewayChatHistoryLimit = (
  value: number | undefined
): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(GATEWAY_CHAT_HISTORY_MAX_LIMIT, Math.floor(value));
};
