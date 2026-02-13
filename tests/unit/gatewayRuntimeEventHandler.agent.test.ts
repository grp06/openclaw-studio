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

describe("gateway runtime event handler (agent)", () => {
  it("updates reasoning stream thinking trace via queueLivePatch", () => {
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
      event: "agent",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        stream: "reasoning",
        data: { text: "first" },
      },
    } as EventFrame);

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        stream: "reasoning",
        data: { text: "first second" },
      },
    } as EventFrame);

    expect(queueLivePatch).toHaveBeenCalled();
    expect(queueLivePatch).toHaveBeenLastCalledWith(
      "agent-1",
      expect.objectContaining({
        status: "running",
        runId: "run-1",
        thinkingTrace: "first second",
      })
    );
  });

  it("suppresses assistant stream publish when chat stream already owns it", () => {
    const agents = [
      createAgent({
        status: "running",
        runId: "run-2",
        runStartedAt: 900,
        streamText: "already streaming",
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
        runId: "run-2",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "user", content: "hi" },
      },
    });

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-2",
        sessionKey: agents[0]!.sessionKey,
        stream: "assistant",
        data: { delta: "hello" },
      },
    } as EventFrame);

    const lastCall = queueLivePatch.mock.calls[queueLivePatch.mock.calls.length - 1] as
      | [string, Partial<AgentState>]
      | undefined;
    if (!lastCall) throw new Error("Expected queueLivePatch to be called");
    const patch = lastCall[1];
    expect(patch.status).toBe("running");
    expect(patch.runId).toBe("run-2");
    expect("streamText" in patch).toBe(false);
  });

  it("allows assistant stream extension when chat stream stalls", () => {
    const agents = [
      createAgent({
        status: "running",
        runId: "run-2",
        runStartedAt: 900,
        streamText: "hello",
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
        runId: "run-2",
        sessionKey: agents[0]!.sessionKey,
        state: "delta",
        message: { role: "user", content: "hi" },
      },
    });

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-2",
        sessionKey: agents[0]!.sessionKey,
        stream: "assistant",
        data: { delta: "hello" },
      },
    } as EventFrame);

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-2",
        sessionKey: agents[0]!.sessionKey,
        stream: "assistant",
        data: { delta: " world" },
      },
    } as EventFrame);

    const lastCall = queueLivePatch.mock.calls[queueLivePatch.mock.calls.length - 1] as
      | [string, Partial<AgentState>]
      | undefined;
    if (!lastCall) throw new Error("Expected queueLivePatch to be called");
    const patch = lastCall[1];
    expect(patch.status).toBe("running");
    expect(patch.runId).toBe("run-2");
    expect(patch.streamText).toBe("hello world");
  });

  it("formats and dedupes tool call lines per run", () => {
    const agents = [createAgent({ status: "running", runId: "run-3", runStartedAt: 900 })];
    const actions: Array<{ type: string; line?: string }> = [];
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch: vi.fn((action) => {
        actions.push(action as never);
      }),
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

    const toolEvent: EventFrame = {
      type: "event",
      event: "agent",
      payload: {
        runId: "run-3",
        sessionKey: agents[0]!.sessionKey,
        stream: "tool",
        data: {
          phase: "call",
          name: "myTool",
          toolCallId: "id-1",
          arguments: { a: 1 },
        },
      },
    };

    handler.handleEvent(toolEvent);
    handler.handleEvent(toolEvent);

    const toolLines = actions
      .filter((a) => a.type === "appendOutput")
      .map((a) => a.line ?? "")
      .filter((line) => line.startsWith("[[tool]]"));
    expect(toolLines.length).toBe(1);
    expect(toolLines[0]).toContain("myTool");
  });

  it("ignores stale assistant stream events for non-active runIds", () => {
    const agents = [createAgent({ status: "running", runId: "run-2", runStartedAt: 900 })];
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
      event: "agent",
      payload: {
        runId: "run-1",
        sessionKey: agents[0]!.sessionKey,
        stream: "assistant",
        data: { text: "stale text" },
      },
    } as EventFrame);

    expect(queueLivePatch).not.toHaveBeenCalled();
  });

  it("applies lifecycle transitions and appends final stream text when no chat events", () => {
    const agents = [createAgent({ streamText: "final text", runId: "run-4" })];
    const actions: Array<{ type: string; agentId: string; line?: string; patch?: unknown }> = [];
    const clearPendingLivePatch = vi.fn();
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => agents,
      dispatch: vi.fn((action) => {
        actions.push(action as never);
      }),
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
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-4",
        sessionKey: agents[0]!.sessionKey,
        stream: "lifecycle",
        data: { phase: "start" },
      },
    } as EventFrame);

    expect(
      actions.some((a) => {
        if (a.type !== "updateAgent") return false;
        const patch = a.patch as Record<string, unknown>;
        return patch.status === "running" && patch.runId === "run-4";
      })
    ).toBe(true);

    actions.length = 0;

    handler.handleEvent({
      type: "event",
      event: "agent",
      payload: {
        runId: "run-4",
        sessionKey: agents[0]!.sessionKey,
        stream: "lifecycle",
        data: { phase: "end" },
      },
    } as EventFrame);

    expect(actions.some((a) => a.type === "appendOutput" && a.line === "final text")).toBe(true);
    expect(
      actions.some((a) => {
        if (a.type !== "updateAgent") return false;
        const patch = a.patch as Record<string, unknown>;
        return patch.lastResult === "final text" && patch.lastAssistantMessageAt === 1000;
      })
    ).toBe(true);
    expect(
      actions.some((a) => {
        if (a.type !== "updateAgent") return false;
        const patch = a.patch as Record<string, unknown>;
        return patch.status === "idle" && patch.runId === null;
      })
    ).toBe(true);
    expect(clearPendingLivePatch).toHaveBeenCalledWith("agent-1");
  });
});
