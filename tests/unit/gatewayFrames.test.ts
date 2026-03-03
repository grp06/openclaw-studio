import { describe, expect, it } from "vitest";

import { parseGatewayFrame } from "@/lib/gateway/gateway-frames";

describe("gateway frames", () => {
  it("parses event stateVersion objects", () => {
    const raw = JSON.stringify({
      type: "event",
      event: "presence",
      payload: { presence: [] },
      stateVersion: { presence: 2, health: 5 },
    });

    const frame = parseGatewayFrame(raw);

    expect(frame?.type).toBe("event");
    if (frame?.type !== "event") {
      throw new Error("Expected event frame");
    }
    expect(frame.stateVersion?.presence).toBe(2);
    expect(frame.stateVersion?.health).toBe(5);
  });
});
