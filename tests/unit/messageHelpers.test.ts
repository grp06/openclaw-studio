import { describe, expect, it } from "vitest";

import { buildAgentInstruction } from "@/lib/text/message-extract";

describe("buildAgentInstruction", () => {
  it("returns trimmed message for normal prompts", () => {
    const message = buildAgentInstruction({
      message: " Ship it ",
    });
    expect(message).toBe("Ship it");
  });

  it("returns command messages untouched", () => {
    const message = buildAgentInstruction({
      message: "/help",
    });
    expect(message).toBe("/help");
  });
});
