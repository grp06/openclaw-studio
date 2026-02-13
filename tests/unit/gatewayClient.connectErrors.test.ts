import { describe, expect, it, vi } from "vitest";

import { GatewayResponseError } from "@/lib/gateway/errors";
import { GatewayClient } from "@/lib/gateway/GatewayClient";

let lastOpts: Record<string, unknown> | null = null;

vi.mock("@/lib/gateway/openclaw/GatewayBrowserClient", () => {
  class GatewayBrowserClient {
    connected = false;
    constructor(opts: Record<string, unknown>) {
      lastOpts = opts;
    }
    start() {}
    stop() {}
    request() {
      return Promise.resolve({});
    }
  }

  return { GatewayBrowserClient };
});

describe("GatewayClient connect failures", () => {
  it("rejects connect with GatewayResponseError when close reason encodes connect failed", async () => {
    const client = new GatewayClient();

    const connectPromise = client.connect({ gatewayUrl: "ws://example.invalid" });

    if (!lastOpts) {
      throw new Error("Expected GatewayBrowserClient to be constructed");
    }

    const onClose = lastOpts.onClose as ((info: { code: number; reason: string }) => void) | undefined;
    if (!onClose) {
      throw new Error("Expected onClose callback");
    }

    onClose({
      code: 4008,
      reason:
        "connect failed: studio.gateway_token_missing Upstream gateway token is not configured on the Studio host.",
    });

    await expect(connectPromise).rejects.toBeInstanceOf(GatewayResponseError);
    await expect(connectPromise).rejects.toMatchObject({
      name: "GatewayResponseError",
      code: "studio.gateway_token_missing",
    });
  });
});

