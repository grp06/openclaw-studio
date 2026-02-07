export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export const isNearBottom = (metrics: ScrollMetrics, thresholdPx: number = 40): boolean => {
  const remaining = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return remaining <= thresholdPx;
};

