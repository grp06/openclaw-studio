import { describe, expect, it } from "vitest";

import {
  extractThinking,
  extractThinkingFromTaggedStream,
  extractThinkingFromTaggedText,
  formatThinkingMarkdown,
  isTraceMarkdown,
  stripTraceMarkdown,
} from "@/lib/text/message-extract";

describe("extractThinking", () => {
  it("extracts thinking blocks from content arrays", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "First idea" },
        { type: "text", text: "Reply" },
      ],
    };

    expect(extractThinking(message)).toBe("First idea");
  });

  it("joins multiple thinking blocks in order", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "One" },
        { type: "thinking", thinking: "Two" },
      ],
    };

    expect(extractThinking(message)).toBe("One\nTwo");
  });

  it("extracts thinking from <thinking> tags", () => {
    const message = {
      role: "assistant",
      content: "<thinking>Plan A</thinking>\nOk.",
    };

    expect(extractThinking(message)).toBe("Plan A");
  });

  it("returns null when no thinking exists", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    };

    expect(extractThinking(message)).toBeNull();
  });

  it("returns null for whitespace-only thinking", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "   " }],
    };

    expect(extractThinking(message)).toBeNull();
  });
});

describe("formatThinkingMarkdown", () => {
  it("formats multi-line thinking into prefixed italic lines", () => {
    const input = "Line 1\n\n  Line 2  ";
    const formatted = formatThinkingMarkdown(input);
    expect(isTraceMarkdown(formatted)).toBe(true);
    expect(stripTraceMarkdown(formatted)).toBe("_Line 1_\n_Line 2_");
  });
});

describe("extractThinkingFromTaggedText", () => {
  it("extracts from closed thinking tags", () => {
    expect(extractThinkingFromTaggedText("<thinking>Plan A</thinking>\nOk")).toBe("Plan A");
  });
});

describe("extractThinkingFromTaggedStream", () => {
  it("extracts partial thinking from an open thinking tag", () => {
    expect(extractThinkingFromTaggedStream("Hello <think>Plan A so far")).toBe("Plan A so far");
  });
});
