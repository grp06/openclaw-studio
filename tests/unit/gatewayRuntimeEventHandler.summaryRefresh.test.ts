import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";
import type { AgentState } from "@/features/agents/state/store";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

const createAgent = (): AgentState => ({
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
});

describe("gateway runtime event handler (summary refresh)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces summary refresh events and loads summary once", async () => {
    vi.useFakeTimers();
    const loadSummarySnapshot = vi.fn(async () => {});
    const bumpHeartbeatTick = vi.fn();
    const refreshHeartbeatLatestUpdate = vi.fn();

    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "connected",
      getAgents: () => [createAgent()],
      dispatch: vi.fn(),
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot,
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate,
      bumpHeartbeatTick,
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    const presence: EventFrame = { type: "event", event: "presence", payload: {} };
    handler.handleEvent(presence);
    handler.handleEvent(presence);
    handler.handleEvent({ type: "event", event: "heartbeat", payload: {} });

    expect(bumpHeartbeatTick).toHaveBeenCalledTimes(1);
    expect(refreshHeartbeatLatestUpdate).toHaveBeenCalledTimes(1);
    expect(loadSummarySnapshot).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(749);
    expect(loadSummarySnapshot).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(loadSummarySnapshot).toHaveBeenCalledTimes(1);

    handler.dispose();
  });

  it("ignores summary refresh when not connected", async () => {
    vi.useFakeTimers();
    const loadSummarySnapshot = vi.fn(async () => {});
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => "disconnected",
      getAgents: () => [createAgent()],
      dispatch: vi.fn(),
      queueLivePatch: vi.fn(),
      clearPendingLivePatch: vi.fn(),
      now: () => 1000,
      loadSummarySnapshot,
      requestHistoryRefresh: vi.fn(async () => {}),
      refreshHeartbeatLatestUpdate: vi.fn(),
      bumpHeartbeatTick: vi.fn(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      updateSpecialLatestUpdate: vi.fn(),
    });

    handler.handleEvent({ type: "event", event: "presence", payload: {} });
    await vi.runAllTimersAsync();

    expect(loadSummarySnapshot).toHaveBeenCalledTimes(0);
    handler.dispose();
  });
});
