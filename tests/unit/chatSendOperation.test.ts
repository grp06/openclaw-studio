import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "@/features/agents/state/store";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";
import { createRuntimeWriteTransport } from "@/features/agents/operations/runtimeWriteTransport";
import { GatewayResponseError } from "@/lib/gateway/errors";
import { formatMetaMarkdown } from "@/lib/text/message-extract";

const createAgent = (overrides?: Partial<AgentState>): AgentState => {
  const base: AgentState = {
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

const createWebchatBlockedPatchError = () =>
  new GatewayResponseError({
    code: "INVALID_REQUEST",
    message: "webchat clients cannot patch sessions; use chat.send for session-scoped updates",
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
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateAgent",
        agentId: agent.agentId,
        patch: expect.objectContaining({
          outputLines: [],
          streamText: null,
          thinkingTrace: null,
          lastResult: null,
          transcriptEntries: [],
        }),
      })
    );
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
    expect(call).toHaveBeenCalledWith(
      "sessions.patch",
      expect.objectContaining({
        key: agent.sessionKey,
        model: "openai/gpt-5",
        thinkingLevel: "medium",
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: agent.agentId,
      patch: { sessionSettingsSynced: true, sessionCreated: true },
    });
  });

  it("uses chat-send intent in domain mode", async () => {
    const agent = createAgent({ sessionSettingsSynced: true, sessionCreated: true });
    const dispatch = vi.fn();
    const call = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        throw new Error("chat.send should not be called in domain mode");
      }
      return { ok: true };
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, payload: { runId: "run-1", status: "started" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendChatMessageViaStudio({
      client: { call },
      runtimeWriteTransport: createRuntimeWriteTransport({
        client: { call } as never,
        useDomainIntents: true,
      }),
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/intents/chat-send",
      expect.objectContaining({ method: "POST" })
    );
    expect(call).not.toHaveBeenCalledWith("chat.send", expect.anything());
    vi.unstubAllGlobals();
  });

  it("uses session-settings-sync intent before chat-send in domain mode when unsynced", async () => {
    const agent = createAgent({ sessionSettingsSynced: false, sessionCreated: false });
    const dispatch = vi.fn();
    const call = vi.fn(async () => {
      throw new Error("gateway client should not be called in domain mode");
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/intents/session-settings-sync") {
        return new Response(JSON.stringify({ ok: true, payload: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/intents/chat-send") {
        return new Response(JSON.stringify({ ok: true, payload: { runId: "run-1", status: "started" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendChatMessageViaStudio({
      client: { call },
      runtimeWriteTransport: createRuntimeWriteTransport({
        client: { call } as never,
        useDomainIntents: true,
      }),
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/intents/session-settings-sync",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/intents/chat-send",
      expect.objectContaining({ method: "POST" })
    );
    expect(call).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("continues_send_when_webchat_patch_is_blocked", async () => {
    const agent = createAgent({ sessionSettingsSynced: false, sessionCreated: false });
    const dispatch = vi.fn();
    const call = vi.fn(async (method: string, payload?: unknown) => {
      if (method === "sessions.patch") {
        throw createWebchatBlockedPatchError();
      }
      if (method === "chat.send") {
        const runId =
          payload &&
          typeof payload === "object" &&
          "idempotencyKey" in payload &&
          typeof payload.idempotencyKey === "string"
            ? payload.idempotencyKey
            : "run";
        return { runId, status: "started" };
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

    const errorLines = dispatch.mock.calls
      .map((entry) => entry[0])
      .filter(
        (
          action
        ): action is {
          type: "appendOutput";
          line: string;
        } =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          action.type === "appendOutput" &&
          "line" in action &&
          typeof action.line === "string" &&
          action.line.startsWith("Error:")
      )
      .map((action) => action.line);
    expect(errorLines).toEqual([]);
  });

  it("fails_send_when_patch_error_is_not_webchat_blocked", async () => {
    const agent = createAgent({ sessionSettingsSynced: false, sessionCreated: false });
    const dispatch = vi.fn();
    const call = vi.fn(async (method: string) => {
      if (method === "sessions.patch") {
        throw new GatewayResponseError({
          code: "INVALID_REQUEST",
          message: "invalid model ref",
        });
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
    expect(methods).toEqual(["sessions.patch"]);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendOutput",
      agentId: agent.agentId,
      line: "Error: invalid model ref",
    });
  });

  it("suppresses_patch_retry_after_webchat_blocked_patch_error", async () => {
    let agent = createAgent({ sessionSettingsSynced: false, sessionCreated: false });
    const dispatch = vi.fn(
      (action: { type: string; agentId?: string; patch?: Partial<AgentState> }) => {
        if (action.type !== "updateAgent" || action.agentId !== agent.agentId || !action.patch) {
          return;
        }
        agent = { ...agent, ...action.patch };
      }
    );
    const call = vi.fn(async (method: string, payload?: unknown) => {
      if (method === "sessions.patch") {
        throw createWebchatBlockedPatchError();
      }
      if (method === "chat.send") {
        const runId =
          payload &&
          typeof payload === "object" &&
          "idempotencyKey" in payload &&
          typeof payload.idempotencyKey === "string"
            ? payload.idempotencyKey
            : "run";
        return { runId, status: "started" };
      }
      return { ok: true };
    });

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "first",
      now: () => 1234,
      generateRunId: () => "run-1",
    });
    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "second",
      now: () => 1240,
      generateRunId: () => "run-2",
    });

    const methods = call.mock.calls.map((entry) => entry[0]);
    expect(methods.filter((method) => method === "sessions.patch")).toHaveLength(1);
    expect(methods.filter((method) => method === "chat.send")).toHaveLength(2);
    expect(agent.sessionSettingsSynced).toBe(true);
    expect(agent.sessionCreated).toBe(true);
  });

  it("syncs exec session overrides for ask-first agents", async () => {
    const agent = createAgent({
      sessionSettingsSynced: false,
      sessionCreated: false,
      sessionExecHost: "gateway",
      sessionExecSecurity: "allowlist",
      sessionExecAsk: "always",
    });
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

    expect(call).toHaveBeenCalledWith(
      "sessions.patch",
      expect.objectContaining({
        key: agent.sessionKey,
        execHost: "gateway",
        execSecurity: "allowlist",
        execAsk: "always",
      })
    );
  });

  it("does_not_sync_session_settings_when_already_synced", async () => {
    const agent = createAgent({ sessionSettingsSynced: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ runId: "run-1", status: "started" }));

    const result = await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(result).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey: agent.sessionKey })
    );
    expect(call).not.toHaveBeenCalledWith(
      "sessions.patch",
      expect.anything()
    );
  });

  it("clears_running_state_for_unknown_success_payload_shape", async () => {
    const agent = createAgent({ sessionSettingsSynced: true, sessionCreated: true });
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

    const idlePatchAction = dispatch.mock.calls
      .map((entry) => entry[0])
      .find(
        (action) =>
          action?.type === "updateAgent" &&
          action?.agentId === agent.agentId &&
          action?.patch?.status === "idle" &&
          action?.patch?.runId === null
      );
    expect(idlePatchAction).toBeTruthy();
  });

  it("clears_running_state_for_stop_style_immediate_success_payload", async () => {
    const agent = createAgent({ sessionSettingsSynced: true, sessionCreated: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true, aborted: false, runIds: [] }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "stop please",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    const idlePatchAction = dispatch.mock.calls
      .map((entry) => entry[0])
      .find(
        (action) =>
          action?.type === "updateAgent" &&
          action?.agentId === agent.agentId &&
          action?.patch?.status === "idle" &&
          action?.patch?.runId === null &&
          action?.patch?.runStartedAt === null &&
          action?.patch?.streamText === null &&
          action?.patch?.thinkingTrace === null
      );
    expect(idlePatchAction).toBeTruthy();
  });

  it("keeps_running_state_for_matching_streaming_status_payloads", async () => {
    const payloads = [{ runId: "run-1", status: "started" }, { runId: "run-1", status: "in_flight" }];

    for (const payload of payloads) {
      const agent = createAgent({ sessionSettingsSynced: true, sessionCreated: true });
      const dispatch = vi.fn();
      const call = vi.fn(async () => payload);

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

      const idlePatchAction = dispatch.mock.calls
        .map((entry) => entry[0])
        .find(
          (action) =>
            action?.type === "updateAgent" &&
            action?.agentId === agent.agentId &&
            action?.patch?.status === "idle"
        );
      expect(idlePatchAction).toBeUndefined();
    }
  });

  it("clears_running_state_for_streaming_shape_with_mismatched_run_id", async () => {
    const agent = createAgent({ sessionSettingsSynced: true, sessionCreated: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ runId: "different-run", status: "started" }));

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

    const idlePatchAction = dispatch.mock.calls
      .map((entry) => entry[0])
      .find(
        (action) =>
          action?.type === "updateAgent" &&
          action?.agentId === agent.agentId &&
          action?.patch?.status === "idle" &&
          action?.patch?.runId === null
      );
    expect(idlePatchAction).toBeTruthy();
  });

  it("supports_internal_send_without_local_user_echo", async () => {
    const agent = createAgent({ sessionSettingsSynced: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "internal follow-up",
      echoUserMessage: false,
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    const dispatchedActions = dispatch.mock.calls.map((entry) => entry[0]);
    expect(
      dispatchedActions.some(
        (action) => action.type === "appendOutput" && action.line === "> internal follow-up"
      )
    ).toBe(false);
    const runningUpdate = dispatchedActions.find(
      (action) => action.type === "updateAgent" && action.patch?.status === "running"
    );
    expect(runningUpdate).toBeTruthy();
    if (runningUpdate && runningUpdate.type === "updateAgent") {
      expect(runningUpdate.patch.lastUserMessage).toBeUndefined();
    }
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

    const result = await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "hello",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    expect(result).toEqual({ ok: false });
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: agent.agentId,
      patch: { status: "error", runId: null, runStartedAt: null, streamText: null, thinkingTrace: null },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendOutput",
      agentId: agent.agentId,
      line: "Error: boom",
    });
  });

  it("optimistically_appends_only_user_content_line", async () => {
    const agent = createAgent({ sessionSettingsSynced: true });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "Hello world",
      now: () => 1234,
      generateRunId: () => "run-1",
    });

    const appendLines = dispatch.mock.calls
      .map((entry) => entry[0])
      .filter((action): action is { type: "appendOutput"; line: string } => {
        return Boolean(
          action &&
            typeof action === "object" &&
            "type" in action &&
            action.type === "appendOutput" &&
            "line" in action &&
            typeof action.line === "string"
        );
      })
      .map((action) => action.line);

    expect(appendLines).toContain("> Hello world");
    expect(appendLines.some((line) => line.startsWith("[[meta]]"))).toBe(false);
  });

  it("uses_monotonic_timestamp_for_optimistic_user_turn_ordering", async () => {
    const sessionKey = "agent:agent-1:studio:test-session";
    const agent = createAgent({
      sessionSettingsSynced: true,
      transcriptEntries: [
        {
          entryId: "history:assistant:1",
          role: "assistant",
          kind: "assistant",
          text: "previous assistant",
          sessionKey,
          runId: null,
          source: "history",
          timestampMs: 5000,
          sequenceKey: 10,
          confirmed: true,
          fingerprint: "fp-prev-assistant",
        },
      ],
    });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey: agent.sessionKey,
      message: "new message",
      now: () => 1000,
      generateRunId: () => "run-1",
    });

    const optimisticUserAppend = dispatch.mock.calls
      .map((entry) => entry[0])
      .find(
        (action) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          action.type === "appendOutput" &&
          "line" in action &&
          action.line === "> new message"
      );
    expect(optimisticUserAppend).toBeTruthy();
    expect((optimisticUserAppend as { transcript?: { timestampMs?: number } }).transcript?.timestampMs).toBe(5001);
  });

  it("uses_output_meta_timestamps_when_transcript_entries_are_missing", async () => {
    const sessionKey = "agent:agent-1:studio:test-session";
    const agent = createAgent({
      sessionSettingsSynced: true,
      transcriptEntries: undefined,
      outputLines: [
        formatMetaMarkdown({ role: "assistant", timestamp: 12_000 }),
        "previous assistant",
      ],
    });
    const dispatch = vi.fn();
    const call = vi.fn(async () => ({ ok: true }));

    await sendChatMessageViaStudio({
      client: { call },
      dispatch,
      getAgent: () => agent,
      agentId: agent.agentId,
      sessionKey,
      message: "new message",
      now: () => 1000,
      generateRunId: () => "run-1",
    });

    const optimisticUserAppend = dispatch.mock.calls
      .map((entry) => entry[0])
      .find(
        (action) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          action.type === "appendOutput" &&
          "line" in action &&
          action.line === "> new message"
      );
    expect(optimisticUserAppend).toBeTruthy();
    expect((optimisticUserAppend as { transcript?: { timestampMs?: number } }).transcript?.timestampMs).toBe(12_001);
  });
});
