export type GatewayStatus = "disconnected" | "connecting" | "connected";

export type GatewayGapInfo = {
  expected: number;
  received: number;
};
