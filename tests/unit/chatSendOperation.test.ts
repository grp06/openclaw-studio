import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "@/features/agents/state/store";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "idle",
  sessionCreated: false,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
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
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
  ...(overrides ?? {}),
});

describe("sendChatMessageViaStudio", () => {
  it("handles_reset_command", async () => {
    const agent = createAgent({
      outputLines: ["old"],
      streamText: "stream",
      thinkingTrace: "thinking",
      lastResult: "result",
      sessionSettingsSynced: true,
    });

    const dispatch = vi.fn();
    const call = vi.fn(async () => ({}));
    const clearRunTracking = vi.fn();

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "/reset",
      clearRunTracking,
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(clearRunTracking).toHaveBeenCalledWith("run-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: agent.agentId,
      patch: {
        outputLines: [],
        streamText: null,
        thinkingTrace: null,
        lastResult: null,
      },
    });
  });

  it("syncs_session_settings_when_not_synced", async () => {
    const agent = createAgent({ sessionSettingsSynced: false, sessionCreated: false });
    const dispatch = vi.fn();
    const call = vi.fn(async (method: string) => {
      if (method === "sessions.patch") {
        return {
          ok: true,
          key: agent.sessionKey,
          entry: { thinkingLevel: "medium" },
          resolved: { modelProvider: "openai", model: "gpt-5" },
        };
      }
      return { ok: true };
    });

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    const methods = call.mock.calls.map((entry) => entry[0]);
    expect(methods).toEqual(["sessions.patch", "chat.send"]);
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: agent.agentId,
      patch: { sessionSettingsSynced: true, sessionCreated: true },
    });
  });

  it("does_not_sync_session_settings_when_already_synced", async () => {
    const agent = createAgent({ sessionSettingsSynced: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(call).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey: agent.sessionKey })
    );
    expect(call).not.toHaveBeenCalledWith(
      "sessions.patch",
      expect.anything()
    );
  });

  it("marks_error_on_gateway_failure", async () => {
    const agent = createAgent({ sessionSettingsSynced: true });
    const dispatch = vi.fn();
    const call = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        throw new Error("boom");
      }
      return { ok: true };
    });

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: agent.agentId,
      patch: { status: "error", runId: null, streamText: null, thinkingTrace: null },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendOutput",
      agentId: agent.agentId,
      line: "Error: boom",
    });
  });
});

