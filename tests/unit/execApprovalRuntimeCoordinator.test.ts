import { describe, expect, it } from "vitest";

import type { ExecApprovalEventEffects } from "@/features/agents/approvals/execApprovalLifecycleWorkflow";
import type { PendingExecApproval } from "@/features/agents/approvals/types";
import {
  applyApprovalIngressEffects,
  deriveAwaitingUserInputPatches,
  derivePendingApprovalPruneDelayMs,
  prunePendingApprovalState,
  resolveApprovalAutoResumeDispatch,
  resolveApprovalAutoResumePreflight,
  type ApprovalPendingState,
} from "@/features/agents/approvals/execApprovalRuntimeCoordinator";
import type { AgentState } from "@/features/agents/state/store";

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

const createPendingState = (overrides?: Partial<ApprovalPendingState>): ApprovalPendingState => ({
  approvalsByAgentId: {},
  unscopedApprovals: [],
  ...overrides,
});

describe("execApprovalRuntimeCoordinator", () => {
  it("applies scoped/unscoped upserts and removals while deriving pause requests", () => {
    const existingScoped = createApproval("existing-scoped");
    const existingUnscoped = createApproval("existing-unscoped", { agentId: null, sessionKey: "agent:other:main" });
    const scopedUpsert = createApproval("approval-scoped", { ask: "always" });
    const unscopedUpsert = createApproval("approval-unscoped", {
      agentId: null,
      sessionKey: "agent:other:main",
      ask: "on-miss",
    });

    const pendingState = createPendingState({
      approvalsByAgentId: { "agent-1": [existingScoped] },
      unscopedApprovals: [existingUnscoped],
    });

    const effects: ExecApprovalEventEffects = {
      scopedUpserts: [{ agentId: "agent-1", approval: scopedUpsert }],
      unscopedUpserts: [unscopedUpsert],
      removals: ["existing-scoped", "existing-unscoped"],
      markActivityAgentIds: ["agent-1"],
    };

    const result = applyApprovalIngressEffects({
      pendingState,
      approvalEffects: effects,
      agents: [createAgent(), createAgent({ agentId: "other", sessionKey: "agent:other:main", runId: "run-2", sessionExecAsk: "on-miss" })],
      pausedRunIdByAgentId: new Map(),
    });

    expect(result.pendingState.approvalsByAgentId).toEqual({
      "agent-1": [scopedUpsert],
    });
    expect(result.pendingState.unscopedApprovals).toEqual([unscopedUpsert]);
    expect(result.markActivityAgentIds).toEqual(["agent-1"]);
    expect(result.pauseRequests).toEqual([{ approval: scopedUpsert, preferredAgentId: "agent-1" }]);
  });

  it("does not emit pause request when run is already paused for the same run id", () => {
    const scopedUpsert = createApproval("approval-scoped", { ask: "always" });
    const effects: ExecApprovalEventEffects = {
      scopedUpserts: [{ agentId: "agent-1", approval: scopedUpsert }],
      unscopedUpserts: [],
      removals: [],
      markActivityAgentIds: [],
    };

    const result = applyApprovalIngressEffects({
      pendingState: createPendingState(),
      approvalEffects: effects,
      agents: [createAgent({ runId: "run-1" })],
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
    });

    expect(result.pauseRequests).toEqual([]);
  });

  it("blocks preflight auto-resume when sibling pending approvals exist", () => {
    const pendingState = createPendingState({
      approvalsByAgentId: {
        "agent-1": [createApproval("a-1"), createApproval("a-2")],
      },
      unscopedApprovals: [],
    });

    const preflight = resolveApprovalAutoResumePreflight({
      approval: createApproval("a-1"),
      targetAgentId: "agent-1",
      pendingState,
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
    });

    expect(preflight).toEqual({ kind: "skip", reason: "blocking-pending-approvals" });
  });

  it("allows preflight auto-resume when no blocking approvals remain", () => {
    const preflight = resolveApprovalAutoResumePreflight({
      approval: createApproval("a-1"),
      targetAgentId: "agent-1",
      pendingState: createPendingState(),
      pausedRunIdByAgentId: new Map([["agent-1", "run-1"]]),
    });

    expect(preflight).toEqual({
      kind: "resume",
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
    });
  });

  it("derives dispatch auto-resume intent only when run ownership is still valid", () => {
    const replacedRun = resolveApprovalAutoResumeDispatch({
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      agents: [createAgent({ status: "running", runId: "run-2" })],
    });
    expect(replacedRun).toEqual({ kind: "skip", reason: "run-replaced" });

    const resume = resolveApprovalAutoResumeDispatch({
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      agents: [createAgent({ status: "running", runId: "run-1", sessionKey: "agent:agent-1:main" })],
    });
    expect(resume).toEqual({
      kind: "resume",
      targetAgentId: "agent-1",
      pausedRunId: "run-1",
      sessionKey: "agent:agent-1:main",
    });
  });

  it("derives awaiting-user-input patches from scoped pending approvals", () => {
    const agents = [
      createAgent({ agentId: "agent-1", awaitingUserInput: false }),
      createAgent({ agentId: "agent-2", awaitingUserInput: true, runId: "run-2", sessionKey: "agent:agent-2:main" }),
      createAgent({ agentId: "agent-3", awaitingUserInput: false, runId: "run-3", sessionKey: "agent:agent-3:main" }),
    ];

    const patches = deriveAwaitingUserInputPatches({
      agents,
      approvalsByAgentId: {
        "agent-1": [createApproval("a-1")],
      },
    });

    expect(patches).toEqual([
      { agentId: "agent-1", awaitingUserInput: true },
      { agentId: "agent-2", awaitingUserInput: false },
    ]);
  });

  it("derives prune delay and pruned pending state", () => {
    const pendingState = createPendingState({
      approvalsByAgentId: {
        "agent-1": [createApproval("a-1", { expiresAtMs: 6_000 })],
      },
      unscopedApprovals: [createApproval("u-1", { agentId: null, expiresAtMs: 7_500 })],
    });

    const delay = derivePendingApprovalPruneDelayMs({
      pendingState,
      nowMs: 5_000,
      graceMs: 500,
    });
    expect(delay).toBe(1_500);

    const pruned = prunePendingApprovalState({
      pendingState: {
        approvalsByAgentId: {
          "agent-1": [
            createApproval("expired", { expiresAtMs: 4_000 }),
            createApproval("active", { expiresAtMs: 6_000 }),
          ],
        },
        unscopedApprovals: [
          createApproval("expired-u", { agentId: null, expiresAtMs: 4_100 }),
          createApproval("active-u", { agentId: null, expiresAtMs: 8_000 }),
        ],
      },
      nowMs: 5_000,
      graceMs: 500,
    });

    expect(pruned.pendingState.approvalsByAgentId).toEqual({
      "agent-1": [createApproval("active", { expiresAtMs: 6_000 })],
    });
    expect(pruned.pendingState.unscopedApprovals).toEqual([
      createApproval("active-u", { agentId: null, expiresAtMs: 8_000 }),
    ]);
  });
});
