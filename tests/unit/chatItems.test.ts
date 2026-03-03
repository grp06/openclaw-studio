import { describe, expect, it } from "vitest";

import {
  boundChatItemsBySemanticTurns,
  buildAgentChatItems,
  buildAgentChatRenderBlocks,
  buildFinalAgentChatItems,
  summarizeToolLabel,
} from "@/features/agents/components/chatItems";
import { formatMetaMarkdown, formatThinkingMarkdown, formatToolCallMarkdown, formatToolResultMarkdown } from "@/lib/text/message-extract";

describe("buildAgentChatItems", () => {
  it("keeps thinking traces aligned with each assistant turn", () => {
    const items = buildAgentChatItems({
      outputLines: [
        "> first question",
        formatThinkingMarkdown("first plan"),
        "first answer",
        "> second question",
        formatThinkingMarkdown("second plan"),
        "second answer",
      ],
      streamText: null,
      liveThinkingTrace: "",
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "thinking",
      "assistant",
      "user",
      "thinking",
      "assistant",
    ]);
    expect(items[1]).toMatchObject({ kind: "thinking", text: "_first plan_" });
    expect(items[4]).toMatchObject({ kind: "thinking", text: "_second plan_" });
  });

  it("does not include saved traces when thinking traces are disabled", () => {
    const items = buildAgentChatItems({
      outputLines: [
        "> first question",
        formatThinkingMarkdown("first plan"),
        "first answer",
      ],
      streamText: null,
      liveThinkingTrace: "live plan",
      showThinkingTraces: false,
      toolCallingEnabled: true,
    });

    expect(items.map((item) => item.kind)).toEqual(["user", "assistant"]);
  });

  it("adds a live trace before the live assistant stream", () => {
    const items = buildAgentChatItems({
      outputLines: ["first answer"],
      streamText: "stream answer",
      liveThinkingTrace: "first plan",
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items.map((item) => item.kind)).toEqual(["assistant", "thinking", "assistant"]);
    expect(items[1]).toMatchObject({ kind: "thinking", text: "_first plan_", live: true });
  });

  it("merges adjacent thinking traces into a single item", () => {
    const items = buildAgentChatItems({
      outputLines: [formatThinkingMarkdown("first plan"), formatThinkingMarkdown("second plan"), "answer"],
      streamText: null,
      liveThinkingTrace: "",
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items.map((item) => item.kind)).toEqual(["thinking", "assistant"]);
    expect(items[0]).toMatchObject({
      kind: "thinking",
      text: "_first plan_\n\n_second plan_",
    });
  });
});

describe("buildFinalAgentChatItems", () => {
  it("does not include live thinking or live assistant items", () => {
    const items = buildFinalAgentChatItems({
      outputLines: ["> question", formatThinkingMarkdown("plan"), "answer"],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items.map((item) => item.kind)).toEqual(["user", "thinking", "assistant"]);
  });

  it("propagates meta timestamps and thinking duration into subsequent items", () => {
    const items = buildFinalAgentChatItems({
      outputLines: [
        formatMetaMarkdown({ role: "user", timestamp: 1700000000000 }),
        "> hello",
        formatMetaMarkdown({ role: "assistant", timestamp: 1700000001234, thinkingDurationMs: 1800 }),
        formatThinkingMarkdown("plan"),
        "answer",
      ],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items[0]).toMatchObject({ kind: "user", text: "hello", timestampMs: 1700000000000 });
    expect(items[1]).toMatchObject({
      kind: "thinking",
      text: "_plan_",
      timestampMs: 1700000001234,
      thinkingDurationMs: 1800,
    });
    expect(items[2]).toMatchObject({
      kind: "assistant",
      text: "answer",
      timestampMs: 1700000001234,
      thinkingDurationMs: 1800,
    });
  });

  it("collapses adjacent duplicate user items when optimistic and persisted turns match", () => {
    const items = buildFinalAgentChatItems({
      outputLines: [
        "> hello\n\nworld",
        formatMetaMarkdown({ role: "user", timestamp: 1700000000000 }),
        "> hello world",
      ],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items).toEqual([
      {
        kind: "user",
        text: "hello world",
        timestampMs: 1700000000000,
      },
    ]);
  });

  it("does_not_collapse_repeated_user_message_when_second_turn_is_only_optimistic", () => {
    const items = buildFinalAgentChatItems({
      outputLines: [
        formatMetaMarkdown({ role: "user", timestamp: 1700000000000 }),
        "> repeat",
        "> repeat",
      ],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items).toEqual([
      {
        kind: "user",
        text: "repeat",
        timestampMs: 1700000000000,
      },
      {
        kind: "user",
        text: "repeat",
      },
    ]);
  });

  it("keeps assistant markdown as assistant content", () => {
    const items = buildFinalAgentChatItems({
      outputLines: ["- first item\n- second item"],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant" });
    expect(items[0]?.text).toContain("- first item");
  });

  it("classifies tool markdown as tool items when tool calling is enabled", () => {
    const callLine = formatToolCallMarkdown({
      id: "call_123",
      name: "exec",
      arguments: { command: "pwd" },
    });
    const toolLine = formatToolResultMarkdown({
      toolCallId: "call_123",
      toolName: "exec",
      details: { status: "completed", exitCode: 0 },
      text: "pwd",
      isError: false,
    });
    const items = buildFinalAgentChatItems({
      outputLines: [callLine, toolLine],
      showThinkingTraces: true,
      toolCallingEnabled: true,
    });

    expect(items).toEqual([
      {
        kind: "tool",
        text: callLine,
      },
      {
        kind: "tool",
        text: toolLine,
      },
    ]);
  });

  it("hides tool results when tool calling is disabled", () => {
    const toolLine = formatToolResultMarkdown({
      toolCallId: "call_456",
      toolName: "exec",
      details: { status: "completed", exitCode: 0 },
      text: "pwd",
      isError: false,
    });
    const items = buildFinalAgentChatItems({
      outputLines: [toolLine],
      showThinkingTraces: true,
      toolCallingEnabled: false,
    });

    expect(items).toEqual([]);
  });
});

describe("summarizeToolLabel", () => {
  it("hides long tool call ids and prefers showing the command/path/url value", () => {
    const toolCallLine = formatToolCallMarkdown({
      id: "call_ABC123|fc_456",
      name: "functions.exec",
      arguments: { command: "gh auth status" },
    });

    const { summaryText: callSummary } = summarizeToolLabel(toolCallLine);
    expect(callSummary).toContain("gh auth status");
    expect(callSummary).not.toContain("call_");

    const toolResultLine = formatToolResultMarkdown({
      toolCallId: "call_ABC123|fc_456",
      toolName: "functions.exec",
      details: { status: "completed", exitCode: 0, durationMs: 168 },
      isError: false,
      text: "ok",
    });

    const { summaryText: resultSummary } = summarizeToolLabel(toolResultLine);
    expect(resultSummary).toContain("completed");
    expect(resultSummary).toContain("exit 0");
    expect(resultSummary).not.toContain("call_");
  });

  it("renders read file calls as inline path labels without JSON body", () => {
    const toolCallLine = formatToolCallMarkdown({
      id: "call_read_1",
      name: "read",
      arguments: { file_path: "/Users/georgepickett/openclaw/shared/openclaw-agent-home/README.md" },
    });

    const summary = summarizeToolLabel(toolCallLine);
    expect(summary.summaryText).toBe(
      "read /Users/georgepickett/openclaw/shared/openclaw-agent-home/README.md"
    );
    expect(summary.inlineOnly).toBe(true);
    expect(summary.body).toBe("");
  });
});

describe("buildAgentChatRenderBlocks", () => {
  it("groups thinking and tool events into one assistant block in original order", () => {
    const toolCallLine = formatToolCallMarkdown({
      id: "call_1",
      name: "exec",
      arguments: { command: "pwd" },
    });
    const toolResultLine = formatToolResultMarkdown({
      toolCallId: "call_1",
      toolName: "exec",
      details: { status: "completed", exitCode: 0 },
      text: "/repo",
      isError: false,
    });

    const blocks = buildAgentChatRenderBlocks([
      { kind: "thinking", text: "_plan before tool_", timestampMs: 100 },
      { kind: "tool", text: toolCallLine, timestampMs: 101 },
      { kind: "thinking", text: "_plan after tool_", timestampMs: 102 },
      { kind: "tool", text: toolResultLine, timestampMs: 103 },
      { kind: "assistant", text: "done", timestampMs: 104 },
    ]);

    expect(blocks).toEqual([
      {
        kind: "assistant",
        text: "done",
        timestampMs: 100,
        traceEvents: [
          { kind: "thinking", text: "_plan before tool_" },
          { kind: "tool", text: toolCallLine },
          { kind: "thinking", text: "_plan after tool_" },
          { kind: "tool", text: toolResultLine },
        ],
      },
    ]);
  });

  it("starts a new assistant block after a user turn", () => {
    const blocks = buildAgentChatRenderBlocks([
      { kind: "thinking", text: "_first plan_", timestampMs: 10 },
      { kind: "assistant", text: "first answer", timestampMs: 11 },
      { kind: "user", text: "next question", timestampMs: 12 },
      { kind: "thinking", text: "_second plan_", timestampMs: 13 },
      { kind: "assistant", text: "second answer", timestampMs: 14 },
    ]);

    expect(blocks.map((block) => block.kind)).toEqual(["assistant", "user", "assistant"]);
  });

  it("merges adjacent incremental thinking updates", () => {
    const blocks = buildAgentChatRenderBlocks([
      { kind: "thinking", text: "_a_", timestampMs: 10 },
      { kind: "thinking", text: "_a_\n\n_b_", timestampMs: 10 },
      { kind: "assistant", text: "answer", timestampMs: 10 },
    ]);

    expect(blocks).toEqual([
      {
        kind: "assistant",
        text: "answer",
        timestampMs: 10,
        traceEvents: [{ kind: "thinking", text: "_a_\n\n_b_" }],
      },
    ]);
  });
});

describe("boundChatItemsBySemanticTurns", () => {
  it("keeps recent semantic turns while preserving attached tool/thinking items", () => {
    const items = boundChatItemsBySemanticTurns({
      items: [
        { kind: "user", text: "q1" },
        { kind: "assistant", text: "a1" },
        { kind: "user", text: "q2" },
        { kind: "thinking", text: "_plan_" },
        { kind: "tool", text: "tool-result" },
        { kind: "assistant", text: "a2" },
      ],
      turnLimit: 2,
    });

    expect(items).toEqual([
      { kind: "user", text: "q2" },
      { kind: "thinking", text: "_plan_" },
      { kind: "tool", text: "tool-result" },
      { kind: "assistant", text: "a2" },
    ]);
  });

  it("returns full list when semantic turns are within limit", () => {
    const original = [
      { kind: "user", text: "q1" } as const,
      { kind: "assistant", text: "a1" } as const,
      { kind: "tool", text: "tool-result" } as const,
    ];
    const items = boundChatItemsBySemanticTurns({
      items: original,
      turnLimit: 10,
    });

    expect(items).toEqual(original);
  });
});
