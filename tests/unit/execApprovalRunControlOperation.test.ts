import { describe, expect, it, vi } from "vitest";

import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS,
  runExecApprovalAutoResumeOperation,
  runGatewayEventIngressOperation,
  runPauseRunForExecApprovalOperation,
  runResolveExecApprovalOperation,
} from "@/features/agents/approvals/execApprovalRunControlOperation";
import type { ExecApprovalPendingSnapshot } from "@/features/agents/approvals/execApprovalControlLoopWorkflow";
import type { AgentState } from "@/features/agents/state/store";
import { EXEC_APPROVAL_AUTO_RESUME_MARKER } from "@/lib/text/message-extract";
import type { EventFrame } from "@/lib/gateway/GatewayClient";

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:main",
  status: "running",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: "run-1",
  runStartedAt: 1,
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
  sessionExecAsk: "always",
  ...overrides,
});

const createApproval = (id: string, overrides?: Partial<PendingExecApproval>): PendingExecApproval => ({
  id,
  agentId: "agent-1",
  sessionKey: "agent:agent-1:main",
  command: "npm run test",
  cwd: "/repo",
  host: "gateway",
  security: "allowlist",
  ask: "always",
  resolvedPath: "/usr/bin/npm",
  createdAtMs: 1,
  expiresAtMs: 10_000,
  resolving: false,
  error: null,
  ...overrides,
});

const createPendingState = (
  overrides?: Partial<ExecApprovalPendingSnapshot>
): ExecApprovalPendingSnapshot => ({
  approvalsByAgentId: {},
  unscopedApprovals: [],
  ...overrides,
});

describe("execApprovalRunControlOperation", () => {
  it("pauses a run for pending approval after stale paused-run cleanup", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const pausedRunIdByAgentId = new Map<string, string>([
      ["stale-agent", "stale-run"],
    ]);

    await runPauseRunForExecApprovalOperation({
      status: "connected",
      client: { call },
      approval: createApproval("approval-1"),
      preferredAgentId: "agent-1",
      getAgents: () => [createAgent({ runId: "run-1" })],
      pausedRunIdByAgentId,
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
    });

    expect(pausedRunIdByAgentId.has("stale-agent")).toBe(false);
    expect(pausedRunIdByAgentId.get("agent-1")).toBe("run-1");
    expect(call).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "agent:agent-1:main",
    });
  });

  it("reverts paused-run map entry when pause abort call fails", async () => {
    const call = vi.fn(async () => {
      throw new Error("abort failed");
    });
    const logWarn = vi.fn();
    const pausedRunIdByAgentId = new Map<string, string>();

    await runPauseRunForExecApprovalOperation({
      status: "connected",
      client: { call },
      approval: createApproval("approval-1"),
      preferredAgentId: "agent-1",
      getAgents: () => [createAgent({ runId: "run-1" })],
      pausedRunIdByAgentId,
      isDisconnectLikeError: () => false,
      logWarn,
    });

    expect(pausedRunIdByAgentId.has("agent-1")).toBe(false);
    expect(logWarn).toHaveBeenCalledWith(
      "Failed to pause run for pending exec approval.",
      expect.any(Error)
    );
  });

  it("auto-resumes in order: dispatch running, wait paused run, then send follow-up", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "agent.wait") return { status: "ok" };
      throw new Error(`Unexpected method ${method}`);
    });
    const dispatch = vi.fn();
    const sendChatMessage = vi.fn(async () => undefined);
    const pausedRunIdByAgentId = new Map<string, string>([["agent-1", "run-1"]]);

    await runExecApprovalAutoResumeOperation({
      client: { call },
      dispatch,
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      getAgents: () => [createAgent({ status: "running", runId: "run-1" })],
      getPendingState: () => createPendingState(),
      pausedRunIdByAgentId,
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      sendChatMessage,
      now: () => 777,
    });

    expect(pausedRunIdByAgentId.has("agent-1")).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: { status: "running", runId: "run-1", lastActivityAt: 777 },
    });
    expect(call).toHaveBeenCalledWith("agent.wait", {
      runId: "run-1",
      timeoutMs: EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS,
    });
    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        echoUserMessage: false,
        message: `${EXEC_APPROVAL_AUTO_RESUME_MARKER}\nContinue where you left off and finish the task.`,
      })
    );

    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0]);
    expect(call.mock.invocationCallOrder[0]).toBeLessThan(
      sendChatMessage.mock.invocationCallOrder[0]
    );
  });

  it("skips follow-up send when post-wait auto-resume intent no longer holds", async () => {
    const call = vi.fn(async () => ({ status: "ok" }));
    const dispatch = vi.fn();
    const sendChatMessage = vi.fn(async () => undefined);
    const pausedRunIdByAgentId = new Map<string, string>([["agent-1", "run-1"]]);

    let readCount = 0;
    const getAgents = () => {
      readCount += 1;
      if (readCount === 1) {
        return [createAgent({ status: "running", runId: "run-1" })];
      }
      return [createAgent({ status: "running", runId: "run-2" })];
    };

    await runExecApprovalAutoResumeOperation({
      client: { call },
      dispatch,
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      getAgents,
      getPendingState: () => createPendingState(),
      pausedRunIdByAgentId,
      isDisconnectLikeError: () => false,
      logWarn: vi.fn(),
      sendChatMessage,
    });

    expect(call).toHaveBeenCalledWith("agent.wait", {
      runId: "run-1",
      timeoutMs: EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS,
    });
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it("resolves approvals through resolver and delegates allow flow to auto-resume operation", async () => {
    const resolveExecApproval = vi.fn(async (params: { onAllowed?: (input: {
      approval: PendingExecApproval;
      targetAgentId: string;
    }) => Promise<void> }) => {
      await params.onAllowed?.({
        approval: createApproval("approval-1"),
        targetAgentId: "agent-1",
      });
    });
    const runAutoResume = vi.fn(async () => undefined);

    await runResolveExecApprovalOperation({
      client: { call: vi.fn(async () => ({ ok: true })) },
      approvalId: "approval-1",
      decision: "allow-once",
      getAgents: () => [createAgent()],
      getPendingState: () => createPendingState(),
      setPendingExecApprovalsByAgentId: vi.fn(),
      setUnscopedPendingExecApprovals: vi.fn(),
      requestHistoryRefresh: vi.fn(),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
      dispatch: vi.fn(),
      isDisconnectLikeError: () => false,
      resolveExecApproval: resolveExecApproval as never,
      runAutoResume,
    });

    expect(resolveExecApproval).toHaveBeenCalledTimes(1);
    expect(runAutoResume).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: expect.objectContaining({ id: "approval-1" }),
        targetAgentId: "agent-1",
      })
    );
  });

  it("executes ingress commands from gateway events", () => {
    const dispatch = vi.fn();
    const replacePendingState = vi.fn();
    const pauseRunForApproval = vi.fn(async () => undefined);
    const recordCronDedupeKey = vi.fn();

    const event: EventFrame = {
      type: "event",
      event: "cron",
      payload: {
        action: "finished",
        sessionKey: "agent:agent-1:main",
        jobId: "job-1",
        sessionId: "session-1",
        runAtMs: 123,
        status: "ok",
        summary: "cron summary",
      },
    };

    const commands = runGatewayEventIngressOperation({
      event,
      getAgents: () => [createAgent()],
      getPendingState: () => createPendingState(),
      pausedRunIdByAgentId: new Map(),
      seenCronDedupeKeys: new Set(),
      nowMs: 1_000,
      replacePendingState,
      pauseRunForApproval,
      dispatch,
      recordCronDedupeKey,
    });

    expect(commands).toHaveLength(2);
    expect(recordCronDedupeKey).toHaveBeenCalledWith("cron:job-1:session-1");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "appendOutput",
        agentId: "agent-1",
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "markActivity",
      agentId: "agent-1",
      at: 123,
    });
    expect(replacePendingState).not.toHaveBeenCalled();
    expect(pauseRunForApproval).not.toHaveBeenCalled();
  });
});
