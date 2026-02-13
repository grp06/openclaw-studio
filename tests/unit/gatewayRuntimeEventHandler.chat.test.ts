import { describe, expect, it, vi } from "vitest";

import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";
import type { AgentState } from "@/features/agents/state/store";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

const createAgent = (overrides?: Partial<AgentState>): AgentState => {
  const base: AgentState = {
    agentId: "agent-1",
    name: "Agent One",
    sessionKey: "agent:agent-1:studio:test-session",
    status: "idle",
    sessionCreated: true,
    awaitingUserInput: false,
    hasUnseenActivity: false,
    outputLines: [],
    lastResult: null,
    lastDiff: null,
    runId: null,
    runStartedAt: null,
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
  };
  const merged = { ...base, ...(overrides ?? {}) };

  return {
    ...merged,
    historyFetchLimit: merged.historyFetchLimit ?? null,
    historyFetchedCount: merged.historyFetchedCount ?? null,
    historyMaybeTruncated: merged.historyMaybeTruncated ?? false,
  };
};

describe("gateway runtime event handler (chat)", () => {
  it("applies delta assistant chat stream via queueLivePatch", () => {
    const agents = [createAgent({ status: "running", runId: "run-1", runStartedAt: 900 })];
    const dispatch = vi.fn();
    const queueLivePatch = vi.fn();

    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    const event: EventFrame = {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "assistant", content: "Hello" },
      },
    };

    handler.handleEvent(event);

    expect(queueLivePatch).toHaveBeenCalledTimes(1);
    expect(queueLivePatch).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        streamText: "Hello",
        status: "running",
      })
    );
  });

  it("ignores user/system roles for streaming output", () => {
    const agents = [createAgent({ status: "running", runId: "run-1", runStartedAt: 900 })];
    const queueLivePatch = vi.fn();
    const dispatch = vi.fn();

    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "user", content: "Hello" },
      },
    });

    expect(queueLivePatch).not.toHaveBeenCalled();
  });

  it("ignores stale delta chat events for non-active runIds", () => {
    const agents = [
      createAgent({
        status: "running",
        runId: "run-2",
        runStartedAt: 900,
      }),
    ];
    const queueLivePatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch: vi.fn(),
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "assistant", content: "stale text" },
      },
    });

    expect(queueLivePatch).not.toHaveBeenCalled();
  });

  it("applies final assistant chat by appending output and clearing stream fields", async () => {
    const agents = [
      createAgent({
        lastUserMessage: "hello",
        latestOverride: null,
        status: "running",
        runId: "run-1",
        runStartedAt: 900,
      }),
    ];
    const dispatched: Array<{ type: string; agentId: string; line?: string; patch?: unknown }> = [];
    const dispatch = vi.fn((action) => {
      dispatched.push(action as never);
    });
    const updateSpecialLatestUpdate = vi.fn();
    const clearPendingLivePatch = vi.fn();

    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch,
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate,
    });

    const ts = "2024-01-01T00:00:00.000Z";
    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "final",
        message: { role: "assistant", content: "Done", timestamp: ts, thinking: "t" },
      },
    });

    expect(dispatched.some((entry) => entry.type === "appendOutput" && entry.line === "Done")).toBe(
      true
    );
    expect(
      dispatched.some((entry) => {
        if (entry.type !== "updateAgent") return false;
        const patch = entry.patch as Record<string, unknown>;
        return patch.streamText === null && patch.thinkingTrace === null;
      })
    ).toBe(true);
    expect(
      dispatched.some((entry) => {
        if (entry.type !== "updateAgent") return false;
        const patch = entry.patch as Record<string, unknown>;
        return patch.status === "idle" && patch.runId === null;
      })
    ).toBe(true);
    expect(
      dispatched.some((entry) => {
        if (entry.type !== "updateAgent") return false;
        const patch = entry.patch as Record<string, unknown>;
        return patch.lastAssistantMessageAt === Date.parse(ts);
      })
    ).toBe(true);

    expect(updateSpecialLatestUpdate).toHaveBeenCalledTimes(1);
    expect(updateSpecialLatestUpdate).toHaveBeenCalledWith("agent-1", agents[0], "hello");
    expect(clearPendingLivePatch).toHaveBeenCalledWith("agent-1");
  });

  it("requests history refresh through boundary command only when final assistant arrives without trace lines", () => {
    vi.useFakeTimers();
    try {
      const agents = [createAgent({ outputLines: [] })];
      const requestHistoryRefresh = vi.fn(async () => {});
      const handler = createGatewayRuntimeEventHandler({
        getStatus: () => "connected",
        getAgents: () => agents,
        dispatch: vi.fn(),
        queueLivePatch: vi.fn(),
        clearPendingLivePatch: vi.fn(),
        now: () => 1000,
        loadSummarySnapshot: vi.fn(async () => {}),
        requestHistoryRefresh,
        refreshHeartbeatLatestUpdate: vi.fn(),
        bumpHeartbeatTick: vi.fn(),
        setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
        isDisconnectLikeError: () => false,
        logWarn: vi.fn(),
        updateSpecialLatestUpdate: vi.fn(),
      });

      handler.handleEvent({
        type: "event",
        event: "chat",
        payload: {
          runId: "run-1",
          sessionKey: agents[0]!.sessionKey,
          state: "final",
          message: { role: "assistant", content: "Done" },
        },
      });

      expect(requestHistoryRefresh).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(requestHistoryRefresh).toHaveBeenCalledTimes(1);
      expect(requestHistoryRefresh).toHaveBeenCalledWith({
        agentId: "agent-1",
        reason: "chat-final-no-trace",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores_replayed_terminal_chat_events_for_same_run", () => {
    const agents = [createAgent({ status: "running", runId: "run-1", runStartedAt: 900 })];
    const dispatched: Array<{ type: string; agentId: string; line?: string }> = [];
    const dispatch = vi.fn((action) => {
      dispatched.push(action as never);
    });
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    const event: EventFrame = {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "final",
        message: { role: "assistant", content: "Done" },
      },
    };

    handler.handleEvent(event);
    handler.handleEvent(event);

    const doneLines = dispatched.filter(
      (entry) => entry.type === "appendOutput" && entry.line === "Done"
    );
    expect(doneLines).toHaveLength(1);
  });

  it("ignores terminal chat events for non-active runIds", () => {
    const agents = [
      createAgent({
        status: "running",
        runId: "run-2",
        runStartedAt: 900,
        streamText: "still streaming",
        thinkingTrace: "t",
      }),
    ];
    const dispatched: Array<{ type: string; agentId: string; patch?: unknown }> = [];
    const dispatch = vi.fn((action) => {
      if (action && typeof action === "object") {
        dispatched.push(action as never);
      }
    });
    const requestHistoryRefresh = vi.fn(async () => {});
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh,
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "final",
        message: { role: "assistant", content: "old done" },
      },
    });

    const terminalClears = dispatched.filter((entry) => {
      if (entry.type !== "updateAgent") return false;
      const patch = entry.patch as Record<string, unknown>;
      return patch.streamText === null || patch.thinkingTrace === null || patch.runStartedAt === null;
    });
    expect(terminalClears.length).toBe(0);
    expect(requestHistoryRefresh).not.toHaveBeenCalled();
  });

  it("handles aborted/error by appending output and clearing stream fields", () => {
    const agents = [createAgent({ status: "running", runId: "run-1", runStartedAt: 900 })];
    const dispatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "aborted",
        message: { role: "assistant", content: "" },
      },
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendOutput", agentId: "agent-1", line: "Run aborted." })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateAgent",
        agentId: "agent-1",
        patch: expect.objectContaining({ status: "idle" }),
      })
    );

    const errorDispatch = vi.fn();
    const errorHandler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch: errorDispatch,
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    errorHandler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "error",
        errorMessage: "bad",
        message: { role: "assistant", content: "" },
      },
    });

    expect(errorDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendOutput", agentId: "agent-1", line: "Error: bad" })
    );
    expect(errorDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateAgent",
        agentId: "agent-1",
        patch: expect.objectContaining({ status: "error" }),
      })
    );
  });

  it("ignores late delta chat events after a run has already finalized", () => {
    const agents = [createAgent({ status: "running", runId: "run-1", runStartedAt: 900 })];
    const queueLivePatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch: vi.fn(),
      queueLivePatch,
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot: vi.fn(async () => {}),
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "final",
        message: { role: "assistant", content: "done" },
      },
    });

    queueLivePatch.mockClear();

    handler.handleEvent({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "assistant", content: "late text" },
      },
    });

    expect(queueLivePatch).not.toHaveBeenCalled();
  });
});
