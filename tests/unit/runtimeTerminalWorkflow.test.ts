import { describe, expect, it } from "vitest";

import {
  applyTerminalCommit,
  createRuntimeTerminalState,
  deriveChatTerminalDecision,
  deriveLifecycleTerminalDecision,
  isClosedRun,
  markClosedRun,
  pruneClosedRuns,
} from "@/features/agents/state/runtimeTerminalWorkflow";

describe("runtime terminal workflow", () => {
  it("marks same-or-lower chat final sequence as stale, but accepts higher sequence", () => {
    let state = createRuntimeTerminalState();
    state = applyTerminalCommit(state, {
      runId: "run-1",
      source: "chat-final",
      seq: 4,
    });

    const sameSeq = deriveChatTerminalDecision({
      state,
      runId: "run-1",
      isFinal: true,
      seq: 4,
    });
    expect(sameSeq.isStaleTerminal).toBe(true);
    expect(sameSeq.lastTerminalSeqBeforeFinal).toBe(4);
    expect(sameSeq.commitSourceBeforeFinal).toBe("chat-final");

    const lowerSeq = deriveChatTerminalDecision({
      state,
      runId: "run-1",
      isFinal: true,
      seq: 3,
    });
    expect(lowerSeq.isStaleTerminal).toBe(true);

    const higherSeq = deriveChatTerminalDecision({
      state,
      runId: "run-1",
      isFinal: true,
      seq: 5,
    });
    expect(higherSeq.isStaleTerminal).toBe(false);
  });

  it("schedules lifecycle fallback only when lifecycle end arrives before chat final", () => {
    const freshState = createRuntimeTerminalState();
    const pendingFallback = deriveLifecycleTerminalDecision({
      mode: "event",
      state: freshState,
      runId: "run-2",
      phase: "end",
      hasPendingFallbackTimer: false,
      fallbackDelayMs: 250,
      fallbackFinalText: "fallback final",
      transitionClearsRunTracking: true,
    });
    expect(pendingFallback.deferTransitionPatch).toBe(true);
    expect(pendingFallback.commands).toEqual(
      expect.arrayContaining([
        { kind: "cancelLifecycleFallback", runId: "run-2" },
        {
          kind: "scheduleLifecycleFallback",
          runId: "run-2",
          delayMs: 250,
          finalText: "fallback final",
        },
      ])
    );

    let chatSeenState = createRuntimeTerminalState();
    chatSeenState = applyTerminalCommit(chatSeenState, {
      runId: "run-2",
      source: "chat-final",
      seq: 1,
    });
    const noFallback = deriveLifecycleTerminalDecision({
      mode: "event",
      state: chatSeenState,
      runId: "run-2",
      phase: "end",
      hasPendingFallbackTimer: false,
      fallbackDelayMs: 250,
      fallbackFinalText: "fallback final",
      transitionClearsRunTracking: true,
    });
    expect(noFallback.deferTransitionPatch).toBe(false);
    expect(
      noFallback.commands.find((command) => command.kind === "scheduleLifecycleFallback")
    ).toBeUndefined();
    expect(noFallback.commands).toEqual(
      expect.arrayContaining([
        { kind: "markRunClosed", runId: "run-2" },
        { kind: "clearRunTracking", runId: "run-2" },
      ])
    );
  });

  it("supports closed-run mark, lookup, and prune semantics", () => {
    let state = createRuntimeTerminalState();
    state = applyTerminalCommit(state, {
      runId: "run-closed",
      source: "lifecycle-fallback",
      seq: null,
    });
    state = markClosedRun(state, {
      runId: "run-closed",
      now: 1000,
      ttlMs: 30,
    });

    expect(isClosedRun(state, "run-closed")).toBe(true);
    const beforeExpiry = pruneClosedRuns(state, { at: 1029 });
    expect(beforeExpiry.expiredRunIds).toEqual([]);
    expect(isClosedRun(beforeExpiry.state, "run-closed")).toBe(true);

    const afterExpiry = pruneClosedRuns(beforeExpiry.state, { at: 1030 });
    expect(afterExpiry.expiredRunIds).toEqual(["run-closed"]);
    expect(isClosedRun(afterExpiry.state, "run-closed")).toBe(false);
  });

  it("transitions commit source from lifecycle fallback to chat final", () => {
    let state = createRuntimeTerminalState();
    state = applyTerminalCommit(state, {
      runId: "run-3",
      source: "lifecycle-fallback",
      seq: null,
    });

    const missingSeqAfterFallback = deriveChatTerminalDecision({
      state,
      runId: "run-3",
      isFinal: true,
      seq: null,
    });
    expect(missingSeqAfterFallback.isStaleTerminal).toBe(false);
    expect(missingSeqAfterFallback.commitSourceBeforeFinal).toBe("lifecycle-fallback");

    state = applyTerminalCommit(state, {
      runId: "run-3",
      source: "chat-final",
      seq: 2,
    });
    const missingSeqAfterChatFinal = deriveChatTerminalDecision({
      state,
      runId: "run-3",
      isFinal: true,
      seq: null,
    });
    expect(missingSeqAfterChatFinal.isStaleTerminal).toBe(true);
    expect(missingSeqAfterChatFinal.commitSourceBeforeFinal).toBe("chat-final");
  });

  it("generates fallback schedule intent with explicit delay and no timer handles", () => {
    const decision = deriveLifecycleTerminalDecision({
      mode: "event",
      state: createRuntimeTerminalState(),
      runId: "run-4",
      phase: "end",
      hasPendingFallbackTimer: false,
      fallbackDelayMs: 777,
      fallbackFinalText: "fallback",
      transitionClearsRunTracking: true,
    });

    const schedule = decision.commands.find(
      (command) => command.kind === "scheduleLifecycleFallback"
    );
    expect(schedule).toEqual({
      kind: "scheduleLifecycleFallback",
      runId: "run-4",
      delayMs: 777,
      finalText: "fallback",
    });
  });
});
