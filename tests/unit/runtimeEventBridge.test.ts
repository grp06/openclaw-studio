import { describe, expect, it } from "vitest";

import {
  dedupeRunLines,
  getAgentSummaryPatch,
  getChatSummaryPatch,
  mergeRuntimeStream,
  resolveLifecyclePatch,
  shouldPublishAssistantStream,
} from "@/features/agents/state/runtimeEventBridge";

describe("runtime event bridge helpers", () => {
  it("merges assistant stream text deterministically", () => {
    expect(mergeRuntimeStream("", "delta")).toBe("delta");
    expect(mergeRuntimeStream("hello", "hello world")).toBe("hello world");
    expect(mergeRuntimeStream("hello", " world")).toBe("hello world");
    expect(mergeRuntimeStream("hello", "hello")).toBe("hello");
  });

  it("dedupes tool lines per run", () => {
    const first = dedupeRunLines(new Set<string>(), ["a", "b", "a"]);
    expect(first.appended).toEqual(["a", "b"]);
    const second = dedupeRunLines(first.nextSeen, ["b", "c"]);
    expect(second.appended).toEqual(["c"]);
  });

  it("resolves lifecycle transitions with run guards", () => {
    const started = resolveLifecyclePatch({
      phase: "start",
      incomingRunId: "run-1",
      currentRunId: null,
      lastActivityAt: 123,
    });
    expect(started.kind).toBe("start");
    if (started.kind !== "start") throw new Error("Expected start transition");
    expect(started.patch.status).toBe("running");
    expect(started.patch.runId).toBe("run-1");

    const ignored = resolveLifecyclePatch({
      phase: "end",
      incomingRunId: "run-2",
      currentRunId: "run-1",
      lastActivityAt: 456,
    });
    expect(ignored.kind).toBe("ignore");

    const ended = resolveLifecyclePatch({
      phase: "end",
      incomingRunId: "run-1",
      currentRunId: "run-1",
      lastActivityAt: 789,
    });
    expect(ended.kind).toBe("terminal");
    if (ended.kind !== "terminal") throw new Error("Expected terminal transition");
    expect(ended.patch.status).toBe("idle");
    expect(ended.patch.runId).toBeNull();
    expect(ended.clearRunTracking).toBe(true);
  });

  it("suppresses assistant stream publish when chat stream already owns it", () => {
    expect(
      shouldPublishAssistantStream({
        mergedRaw: "hello",
        rawText: "",
        hasChatEvents: true,
        currentStreamText: "already streaming",
      })
    ).toBe(false);
    expect(
      shouldPublishAssistantStream({
        mergedRaw: "hello",
        rawText: "",
        hasChatEvents: false,
        currentStreamText: "already streaming",
      })
    ).toBe(true);
    expect(
      shouldPublishAssistantStream({
        mergedRaw: "",
        rawText: "",
        hasChatEvents: false,
        currentStreamText: null,
      })
    ).toBe(false);
  });

  it("updates preview and activity from assistant chat", () => {
    const patch = getChatSummaryPatch(
      {
        runId: "run-1",
        sessionKey: "agent:main:studio:agent-1",
        state: "final",
        message: { role: "assistant", content: "Hello" },
      },
      123
    );

    expect(patch?.latestPreview).toBe("Hello");
    expect(patch?.lastActivityAt).toBe(123);
  });

  it("updates status from agent lifecycle events", () => {
    const patch = getAgentSummaryPatch(
      {
        runId: "run-2",
        stream: "lifecycle",
        data: { phase: "start" },
      },
      456
    );

    expect(patch?.status).toBe("running");
    expect(patch?.lastActivityAt).toBe(456);
  });
});
