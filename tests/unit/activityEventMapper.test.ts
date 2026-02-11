import { describe, it, expect, beforeEach } from "vitest";
import {
  mapFrameToActivityEvent,
  resetEventIdCounter,
} from "@/features/activity/eventMapper";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

beforeEach(() => {
  resetEventIdCounter();
});

describe("mapFrameToActivityEvent", () => {
  it("classifies chat events", () => {
    const frame: EventFrame = {
      type: "event",
      event: "chat.message",
      payload: { message: "hello world", sessionKey: "agent:bot1:main" },
    };
    const result = mapFrameToActivityEvent(frame);
    expect(result.type).toBe("chat");
    expect(result.agentId).toBe("bot1");
    expect(result.summary).toBe("hello world");
  });

  it("classifies presence events", () => {
    const frame: EventFrame = {
      type: "event",
      event: "presence",
      payload: { agentId: "bot2", status: "online" },
    };
    const result = mapFrameToActivityEvent(frame);
    expect(result.type).toBe("presence");
    expect(result.agentId).toBe("bot2");
    expect(result.summary).toBe("online");
  });

  it("classifies unknown events as system", () => {
    const frame: EventFrame = {
      type: "event",
      event: "unknown.thing",
      payload: {},
    };
    const result = mapFrameToActivityEvent(frame);
    expect(result.type).toBe("system");
  });

  it("truncates long messages", () => {
    const longMsg = "x".repeat(200);
    const frame: EventFrame = {
      type: "event",
      event: "chat",
      payload: { message: longMsg },
    };
    const result = mapFrameToActivityEvent(frame);
    expect(result.summary.length).toBeLessThanOrEqual(120);
    expect(result.summary.endsWith("...")).toBe(true);
  });

  it("generates unique IDs", () => {
    const frame: EventFrame = { type: "event", event: "test", payload: {} };
    const a = mapFrameToActivityEvent(frame);
    const b = mapFrameToActivityEvent(frame);
    expect(a.id).not.toBe(b.id);
  });
});
