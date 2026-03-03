import type { EventFrame } from "@/lib/gateway/gateway-frames";
import type { GatewayGapInfo } from "@/lib/gateway/gateway-status";

export type { EventFrame } from "@/lib/gateway/gateway-frames";
export type { GatewayGapInfo } from "@/lib/gateway/gateway-status";
export { GatewayResponseError } from "@/lib/gateway/errors";

export type GatewayClient = {
  call: <T = unknown>(method: string, params: unknown) => Promise<T>;
  onEvent?: (handler: (event: EventFrame) => void) => () => void;
  onGap?: (handler: (info: GatewayGapInfo) => void) => () => void;
};
