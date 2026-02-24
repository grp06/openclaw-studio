import { describe, expect, it } from "vitest";

import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  planApprovalIngressRunControl,
  planAutoResumeRunControl,
  planPauseRunControl,
} from "@/features/agents/approvals/execApprovalRunControlWorkflow";
import type { ExecApprovalPendingSnapshot } from "@/features/agents/approvals/execApprovalControlLoopWorkflow";
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

describe("execApprovalRunControlWorkflow", () => {
  it("plans stale paused-run cleanup together with pause intent", () => {
    const plan = planPauseRunControl({
      approval: createApproval("approval-1"),
      preferredAgentId: "agent-1",
      agents: [
        createAgent({ agentId: "agent-1", runId: "run-1" }),
        createAgent({
          agentId: "agent-2",
          sessionKey: "agent:agent-2:main",
          runId: "run-2",
        }),
      ],
      pausedRunIdByAgentId: new Map([
        ["agent-2", "stale-run"],
      ]),
    });

    expect(plan.stalePausedAgentIds).toEqual(["agent-2"]);
    expect(plan.pauseIntent).toEqual({
      kind: "pause",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      runId: "run-1",
    });
  });

  it("plans pre-wait and post-wait auto-resume intents", () => {
    const plan = planAutoResumeRunControl({
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
      agents: [createAgent({ status: "running", runId: "run-1" })],
    });

    expect(plan.preWaitIntent).toEqual({
      kind: "resume",
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      sessionKey: "agent:agent-1:main",
    });
    expect(plan.postWaitIntent).toEqual({
      kind: "resume",
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      sessionKey: "agent:agent-1:main",
    });
  });

  it("returns skip intents when pre-wait auto-resume is blocked", () => {
    const plan = planAutoResumeRunControl({
      approval: createApproval("approval-1"),
      targetAgentId: "agent-1",
      pendingState: createPendingState({
        approvalsByAgentId: {
          "agent-1": [createApproval("approval-1"), createApproval("approval-2")],
        },
      }),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
      agents: [createAgent({ status: "running", runId: "run-1" })],
    });

    expect(plan.preWaitIntent).toEqual({
      kind: "skip",
      reason: "blocking-pending-approvals",
    });
    expect(plan.postWaitIntent).toEqual({
      kind: "skip",
      reason: "blocking-pending-approvals",
    });
  });

  it("plans ingress run-control commands from gateway events", () => {
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

    const commands = planApprovalIngressRunControl({
      event,
      agents: [createAgent()],
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map(),
      seenCronDedupeKeys: new Set(),
      nowMs: 1_000,
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
});
