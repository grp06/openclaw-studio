import { describe, expect, it } from "vitest";

import {
  buildChatFirstPaintCycleKey,
  resolveChatFirstPaint,
} from "@/features/agents/operations/chatFirstPaintWorkflow";

describe("chatFirstPaintWorkflow", () => {
  it("builds cycle key from agent, session, and normalized epoch", () => {
    expect(
      buildChatFirstPaintCycleKey({
        agentId: " agent-1 ",
        sessionKey: " agent:agent-1:main ",
        sessionEpoch: 4.9,
      })
    ).toBe("agent-1:agent:agent-1:main:4");
  });

  it("prefers transcript source when transcript items exist", () => {
    const result = resolveChatFirstPaint({
      transcriptItemCount: 2,
      lastUserMessage: "hello",
      latestPreview: "world",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      sessionEpoch: 2,
      focusStartedAtMs: 1_000,
      nowMs: 1_250,
    });

    expect(result).toEqual({
      cycleKey: "agent-1:agent:agent-1:main:2",
      source: "transcript",
      elapsedMs: 250,
      hasLastUserMessage: true,
      hasLatestPreview: true,
    });
  });

  it("resolves provisional source when transcript is empty and preview exists", () => {
    const result = resolveChatFirstPaint({
      transcriptItemCount: 0,
      lastUserMessage: "",
      latestPreview: "assistant preview",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      sessionEpoch: 3,
      focusStartedAtMs: 2_000,
      nowMs: 2_260,
    });

    expect(result.source).toBe("provisional");
    expect(result.elapsedMs).toBe(260);
    expect(result.hasLastUserMessage).toBe(false);
    expect(result.hasLatestPreview).toBe(true);
  });

  it("returns none and null elapsed when no transcript or preview content exists", () => {
    const result = resolveChatFirstPaint({
      transcriptItemCount: 0,
      lastUserMessage: "   ",
      latestPreview: null,
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      sessionEpoch: 0,
      focusStartedAtMs: 1_000,
      nowMs: 1_400,
    });

    expect(result.source).toBe("none");
    expect(result.elapsedMs).toBeNull();
  });
});
