import { describe, expect, it } from "vitest";

import {
  buildAgentInstruction,
  extractText,
  extractTextCached,
  extractThinking,
  extractThinkingCached,
  extractToolLines,
  isUiMetadataPrefix,
  stripUiMetadata,
} from "@/lib/text/message-extract";

describe("message-extract", () => {
  it("strips envelope headers from user messages", () => {
    const message = {
      role: "user",
      content:
        "[Discord Guild #openclaw-studio channel id:123 +0s 2026-02-01 00:00 UTC] hello there",
    };

    expect(extractText(message)).toBe("hello there");
  });

  it("removes <thinking>/<analysis> blocks from assistant-visible text", () => {
    const message = {
      role: "assistant",
      content: "<thinking>Plan A</thinking>\n<analysis>Details</analysis>\nOk.",
    };

    expect(extractText(message)).toBe("Ok.");
  });

  it("extractTextCached matches extractText and is consistent", () => {
    const message = { role: "user", content: "plain text" };

    expect(extractTextCached(message)).toBe(extractText(message));
    expect(extractTextCached(message)).toBe("plain text");
    expect(extractTextCached(message)).toBe("plain text");
  });

  it("extractThinkingCached matches extractThinking and is consistent", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Plan A" }],
    };

    expect(extractThinkingCached(message)).toBe(extractThinking(message));
    expect(extractThinkingCached(message)).toBe("Plan A");
    expect(extractThinkingCached(message)).toBe("Plan A");
  });

  it("formats tool call + tool result lines", () => {
    const callMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "functions.exec",
          arguments: { command: "echo hi" },
        },
      ],
    };

    const resultMessage = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "functions.exec",
      details: { status: "ok", exitCode: 0 },
      content: "hi\n",
    };

    const callLines = extractToolLines(callMessage).join("\n");
    expect(callLines).toContain("[[tool]] functions.exec (call-1)");
    expect(callLines).toContain("\"command\": \"echo hi\"");

    const resultLines = extractToolLines(resultMessage).join("\n");
    expect(resultLines).toContain("[[tool-result]] functions.exec (call-1)");
    expect(resultLines).toContain("ok");
    expect(resultLines).toContain("hi");
  });

  it("does not treat normal messages as UI metadata", () => {
    const built = buildAgentInstruction({
      message: "hello",
    });

    expect(isUiMetadataPrefix(built)).toBe(false);
    expect(stripUiMetadata(built)).toContain("hello");
    expect(stripUiMetadata(built)).not.toContain("Execution approval policy:");
  });

  it("strips leading system event blocks from queued session updates", () => {
    const raw = `System: [2026-02-12 01:09:16 UTC] Exec failed (mild-she, signal SIGKILL)

[Thu 2026-02-12 01:14 UTC] nope none of those are it. keep looking
[message_id: e050a641-aa32-4950-8083-c3bb7efdfc6d]`;

    expect(stripUiMetadata(raw)).toBe("[Thu 2026-02-12 01:14 UTC] nope none of those are it. keep looking");
  });
});
