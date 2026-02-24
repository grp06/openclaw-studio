import { describe, expect, it } from "vitest";

import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  planAutoResumeIntent,
  planAwaitingUserInputPatches,
  planIngressCommands,
  planPausedRunMapCleanup,
  planPauseRunIntent,
  planPendingPruneDelay,
  planPrunedPendingState,
} from "@/features/agents/approvals/execApprovalControlLoopWorkflow";
import type { ApprovalPendingState } from "@/features/agents/approvals/execApprovalRuntimeCoordinator";
import type { AgentState } from "@/features/agents/state/store";
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

const createApproval = (
  id: string,
  overrides?: Partial<PendingExecApproval>
): PendingExecApproval => ({
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
  overrides?: Partial<ApprovalPendingState>
): ApprovalPendingState => ({
  approvalsByAgentId: {},
  unscopedApprovals: [],
  ...overrides,
});

describe("execApprovalControlLoopWorkflow", () => {
  it("plans stale paused-run cleanup from paused map", () => {
    const stale = planPausedRunMapCleanup({
      pausedRunIdByAgentId: new Map([
        ["agent-1", "run-1"],
        ["agent-2", "run-old"],
        ["missing-agent", "run-x"],
      ]),
      agents: [
        createAgent(),
        createAgent({
          agentId: "agent-2",
          sessionKey: "agent:agent-2:main",
          runId: "run-2",
        }),
      ],
    });

    expect(stale).toEqual(["agent-2", "missing-agent"]);
  });

  it("plans pause intent for a running agent that needs exec approval", () => {
    const intent = planPauseRunIntent({
      approval: createApproval("approval-1"),
      preferredAgentId: "agent-1",
      agents: [createAgent()],
      pausedRunIdByAgentId: new Map(),
    });

    expect(intent).toEqual({
      kind: "pause",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      runId: "run-1",
    });
  });

  it("skips pause intent when the run is already paused", () => {
    const intent = planPauseRunIntent({
      approval: createApproval("approval-1"),
      preferredAgentId: "agent-1",
      agents: [createAgent()],
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
    });

    expect(intent).toEqual({ kind: "skip", reason: "pause-policy-denied" });
  });

  it("plans ingress commands for approval requested events", () => {
    const event: EventFrame = {
      type: "event",
      event: "exec.approval.requested",
      payload: {
        id: "approval-1",
        request: {
          command: "npm run test",
          cwd: "/repo",
          host: "gateway",
          security: "allowlist",
          ask: "always",
          agentId: "agent-1",
          resolvedPath: "/usr/bin/npm",
          sessionKey: "agent:agent-1:main",
        },
        createdAtMs: 100,
        expiresAtMs: 200,
      },
    };

    const commands = planIngressCommands({
      event,
      agents: [createAgent()],
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map(),
      seenCronDedupeKeys: new Set(),
      nowMs: 150,
    });

    expect(commands[0]).toMatchObject({ kind: "replacePendingState" });
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pauseRunForApproval",
          preferredAgentId: "agent-1",
        }),
        { kind: "markActivity", agentId: "agent-1" },
      ])
    );
  });

  it("plans cron ingress commands with dedupe and transcript append", () => {
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

    const commands = planIngressCommands({
      event,
      agents: [createAgent()],
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map(),
      seenCronDedupeKeys: new Set(),
      nowMs: 1000,
    });

    expect(commands).toEqual([
      { kind: "recordCronDedupeKey", dedupeKey: "cron:job-1:session-1" },
      {
        kind: "appendCronTranscript",
        intent: {
          agentId: "agent-1",
          sessionKey: "agent:agent-1:main",
          dedupeKey: "cron:job-1:session-1",
          line: "Cron finished (ok): job-1\n\ncron summary",
          timestampMs: 123,
          activityAtMs: 123,
        },
      },
    ]);
  });

  it("plans prune delay, pruned state, and awaiting-user-input patches", () => {
    const pendingState = createPendingState({
      approvalsByAgentId: {
        "agent-1": [createApproval("a-1", { expiresAtMs: 6_000 })],
      },
      unscopedApprovals: [
        createApproval("a-2", {
          agentId: null,
          sessionKey: "agent:agent-2:main",
          expiresAtMs: 7_000,
        }),
      ],
    });

    const delay = planPendingPruneDelay({
      pendingState,
      nowMs: 5_000,
      graceMs: 500,
    });
    expect(delay).toBe(1_500);

    const pruned = planPrunedPendingState({
      pendingState: {
        approvalsByAgentId: {
          "agent-1": [
            createApproval("expired", { expiresAtMs: 4_000 }),
            createApproval("active", { expiresAtMs: 6_000 }),
          ],
        },
        unscopedApprovals: [
          createApproval("active-unscoped", {
            agentId: null,
            sessionKey: "agent:agent-2:main",
            expiresAtMs: 7_000,
          }),
          createApproval("expired-unscoped", {
            agentId: null,
            sessionKey: "agent:agent-2:main",
            expiresAtMs: 4_100,
          }),
        ],
      },
      nowMs: 5_000,
      graceMs: 500,
    });

    expect(pruned.approvalsByAgentId).toEqual({
      "agent-1": [createApproval("active", { expiresAtMs: 6_000 })],
    });
    expect(pruned.unscopedApprovals).toEqual([
      createApproval("active-unscoped", {
        agentId: null,
        sessionKey: "agent:agent-2:main",
        expiresAtMs: 7_000,
      }),
    ]);

    const patches = planAwaitingUserInputPatches({
      agents: [
        createAgent({ agentId: "agent-1", awaitingUserInput: false }),
        createAgent({
          agentId: "agent-2",
          sessionKey: "agent:agent-2:main",
          runId: "run-2",
          awaitingUserInput: true,
        }),
      ],
      approvalsByAgentId: {
        "agent-1": [createApproval("a-1")],
      },
    });

    expect(patches).toEqual([
      { agentId: "agent-1", awaitingUserInput: true },
      { agentId: "agent-2", awaitingUserInput: false },
    ]);
  });

  it("plans auto-resume intent only when preflight and dispatch both pass", () => {
    const skip = planAutoResumeIntent({
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      pendingState: createPendingState({
        approvalsByAgentId: {
          "agent-1": [createApproval("approval-1"), createApproval("sibling")],
        },
      }),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
      agents: [createAgent()],
    });
    expect(skip).toEqual({ kind: "skip", reason: "blocking-pending-approvals" });

    const resume = planAutoResumeIntent({
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
      agents: [createAgent({ status: "running", runId: "run-1" })],
    });

    expect(resume).toEqual({
      kind: "resume",
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      sessionKey: "agent:agent-1:main",
    });
  });
});
