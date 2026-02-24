import { describe, expect, it } from "vitest";

import type { AgentState } from "@/features/agents/state/store";
import {
  createRuntimeEventCoordinatorState,
  markChatRunSeen,
  reduceClearRunTracking,
  reduceLifecycleFallbackFired,
  reduceMarkActivityThrottled,
  reduceRuntimeAgentWorkflowCommands,
  reduceRuntimePolicyIntents,
} from "@/features/agents/state/runtimeEventCoordinatorWorkflow";
import {
  applyTerminalCommit,
  createRuntimeTerminalState,
  deriveLifecycleTerminalDecision,
} from "@/features/agents/state/runtimeTerminalWorkflow";
import type { AgentEventPayload } from "@/features/agents/state/runtimeEventBridge";

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "running",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: "run-1",
  runStartedAt: 100,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
  ...(overrides ?? {}),
});

const createAgentPayload = (overrides?: Partial<AgentEventPayload>): AgentEventPayload => ({
  runId: "run-1",
  sessionKey: "agent:agent-1:studio:test-session",
  stream: "assistant",
  data: { delta: "hello" },
  ...(overrides ?? {}),
});

describe("runtimeEventCoordinatorWorkflow", () => {
  it("reduces runtime policy intents into effects and run cleanup", () => {
    let state = createRuntimeEventCoordinatorState();
    state = markChatRunSeen(state, "run-1");
    state.thinkingStartedAtByRun.set("run-1", 900);

    const reduced = reduceRuntimePolicyIntents({
      state,
      nowMs: 1000,
      intents: [
        { kind: "queueLivePatch", agentId: "agent-1", patch: { streamText: "stream" } },
        {
          kind: "dispatchUpdateAgent",
          agentId: "agent-1",
          patch: { status: "running", runId: "run-1" },
        },
        {
          kind: "requestHistoryRefresh",
          agentId: "agent-1",
          reason: "chat-final-no-trace",
        },
        {
          kind: "scheduleSummaryRefresh",
          delayMs: 750,
          includeHeartbeatRefresh: true,
        },
        { kind: "clearRunTracking", runId: "run-1" },
      ],
    });

    expect(reduced.effects).toEqual(
      expect.arrayContaining([
        {
          kind: "queueLivePatch",
          agentId: "agent-1",
          patch: { streamText: "stream" },
        },
        {
          kind: "dispatch",
          action: {
            type: "updateAgent",
            agentId: "agent-1",
            patch: { status: "running", runId: "run-1" },
          },
        },
        {
          kind: "requestHistoryRefresh",
          agentId: "agent-1",
          reason: "chat-final-no-trace",
          deferMs: 0,
        },
        {
          kind: "scheduleSummaryRefresh",
          delayMs: 750,
          includeHeartbeatRefresh: true,
        },
        {
          kind: "cancelLifecycleFallback",
          runId: "run-1",
        },
      ])
    );
    expect(reduced.state.chatRunSeen.has("run-1")).toBe(false);
    expect(reduced.state.thinkingStartedAtByRun.has("run-1")).toBe(false);
  });

  it("reduces lifecycle decision into fallback scheduling/cancellation effects", () => {
    const initial = createRuntimeEventCoordinatorState();
    const scheduleDecision = deriveLifecycleTerminalDecision({
      mode: "event",
      state: initial.runtimeTerminalState,
      runId: "run-1",
      phase: "end",
      hasPendingFallbackTimer: false,
      fallbackDelayMs: 250,
      fallbackFinalText: "fallback final",
      transitionClearsRunTracking: true,
    });

    const scheduleReduced = reduceRuntimeAgentWorkflowCommands({
      state: initial,
      payload: createAgentPayload({
        stream: "lifecycle",
        data: { phase: "end" },
      }),
      agentId: "agent-1",
      agent: createAgent(),
      nowMs: 1000,
      commands: [
        {
          kind: "applyLifecycleDecision",
          decision: scheduleDecision,
          transitionPatch: { status: "idle", runId: null },
          shouldClearPendingLivePatch: true,
        },
      ],
    });

    expect(scheduleReduced.effects).toEqual(
      expect.arrayContaining([
        { kind: "clearPendingLivePatch", agentId: "agent-1" },
        { kind: "cancelLifecycleFallback", runId: "run-1" },
        {
          kind: "scheduleLifecycleFallback",
          runId: "run-1",
          delayMs: 250,
          agentId: "agent-1",
          sessionKey: "agent:agent-1:studio:test-session",
          finalText: "fallback final",
          transitionPatch: { status: "idle", runId: null },
        },
      ])
    );
    expect(
      scheduleReduced.effects.some(
        (effect) =>
          effect.kind === "dispatch" &&
          effect.action.type === "updateAgent" &&
          effect.action.patch.status === "idle"
      )
    ).toBe(false);

    const cancelDecision = deriveLifecycleTerminalDecision({
      mode: "event",
      state: initial.runtimeTerminalState,
      runId: "run-2",
      phase: "start",
      hasPendingFallbackTimer: true,
      fallbackDelayMs: 250,
      fallbackFinalText: null,
      transitionClearsRunTracking: false,
    });
    const cancelReduced = reduceRuntimeAgentWorkflowCommands({
      state: initial,
      payload: createAgentPayload({ runId: "run-2", stream: "lifecycle", data: { phase: "start" } }),
      agentId: "agent-1",
      agent: createAgent({ runId: "run-2" }),
      nowMs: 1000,
      commands: [
        {
          kind: "applyLifecycleDecision",
          decision: cancelDecision,
          transitionPatch: { status: "running", runId: "run-2" },
          shouldClearPendingLivePatch: false,
        },
      ],
    });

    expect(
      cancelReduced.effects.some(
        (effect) => effect.kind === "cancelLifecycleFallback" && effect.runId === "run-2"
      )
    ).toBe(true);
  });

  it("applies fallback-fired commits only when chat final has not already committed", () => {
    const baseDecision = deriveLifecycleTerminalDecision({
      mode: "event",
      state: createRuntimeTerminalState(),
      runId: "run-1",
      phase: "end",
      hasPendingFallbackTimer: false,
      fallbackDelayMs: 0,
      fallbackFinalText: "fallback final",
      transitionClearsRunTracking: true,
    });

    const state = {
      ...createRuntimeEventCoordinatorState(),
      runtimeTerminalState: baseDecision.state,
      thinkingStartedAtByRun: new Map<string, number>([["run-1", 1000]]),
    };

    const committed = reduceLifecycleFallbackFired({
      state,
      runId: "run-1",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:studio:test-session",
      finalText: "fallback final",
      transitionPatch: { status: "idle", runId: null },
      nowMs: 1300,
    });

    expect(
      committed.effects.some(
        (effect) =>
          effect.kind === "dispatch" &&
          effect.action.type === "appendOutput" &&
          effect.action.transcript?.kind === "meta"
      )
    ).toBe(true);
    expect(
      committed.effects.some(
        (effect) =>
          effect.kind === "dispatch" &&
          effect.action.type === "appendOutput" &&
          effect.action.line === "fallback final"
      )
    ).toBe(true);
    expect(
      committed.effects.some(
        (effect) =>
          effect.kind === "dispatch" &&
          effect.action.type === "updateAgent" &&
          effect.action.patch.lastResult === "fallback final"
      )
    ).toBe(true);

    const chatFinalCommittedState = {
      ...state,
      runtimeTerminalState: applyTerminalCommit(state.runtimeTerminalState, {
        runId: "run-1",
        source: "chat-final",
        seq: 1,
      }),
    };

    const skipped = reduceLifecycleFallbackFired({
      state: chatFinalCommittedState,
      runId: "run-1",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:studio:test-session",
      finalText: "fallback final",
      transitionPatch: { status: "idle", runId: null },
      nowMs: 1400,
    });

    expect(skipped.effects).toEqual([]);
  });

  it("tracks history refresh state per run and clears it with run cleanup", () => {
    const reduced = reduceRuntimeAgentWorkflowCommands({
      state: createRuntimeEventCoordinatorState(),
      payload: createAgentPayload({
        stream: "tool",
        data: { phase: "result" },
      }),
      agentId: "agent-1",
      agent: createAgent(),
      nowMs: 2000,
      commands: [
        { kind: "markHistoryRefreshRequested", runId: "run-1" },
        {
          kind: "scheduleHistoryRefresh",
          delayMs: 750,
          reason: "chat-final-no-trace",
        },
      ],
    });

    expect(reduced.state.historyRefreshRequestedByRun.has("run-1")).toBe(true);
    expect(reduced.effects).toContainEqual({
      kind: "requestHistoryRefresh",
      agentId: "agent-1",
      reason: "chat-final-no-trace",
      deferMs: 750,
    });

    const cleared = reduceClearRunTracking({ state: reduced.state, runId: "run-1" });
    expect(cleared.state.historyRefreshRequestedByRun.has("run-1")).toBe(false);
    expect(cleared.effects).toContainEqual({
      kind: "cancelLifecycleFallback",
      runId: "run-1",
    });
  });

  it("throttles mark-activity effects by agent", () => {
    const first = reduceMarkActivityThrottled({
      state: createRuntimeEventCoordinatorState(),
      agentId: "agent-1",
      at: 1000,
    });
    expect(first.effects).toContainEqual({
      kind: "dispatch",
      action: {
        type: "markActivity",
        agentId: "agent-1",
        at: 1000,
      },
    });

    const second = reduceMarkActivityThrottled({
      state: first.state,
      agentId: "agent-1",
      at: 1100,
    });
    expect(second.effects).toEqual([]);

    const third = reduceMarkActivityThrottled({
      state: second.state,
      agentId: "agent-1",
      at: 1301,
    });
    expect(third.effects).toContainEqual({
      kind: "dispatch",
      action: {
        type: "markActivity",
        agentId: "agent-1",
        at: 1301,
      },
    });
  });
});
