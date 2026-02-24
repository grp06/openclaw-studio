import { describe, expect, it } from "vitest";

import { shouldStartNextConfigMutation } from "@/features/agents/operations/configMutationGatePolicy";

describe("shouldStartNextConfigMutation", () => {
  it("returns_false_when_queue_empty", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 0,
      })
    ).toBe(false);
  });

  it("returns_false_when_not_connected", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connecting",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(false);
  });

  it("returns_false_when_running_agents_and_next_mutation_requires_idle_agents", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: true,
        nextMutationRequiresIdleAgents: true,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(false);
  });

  it("returns_true_when_running_agents_but_next_mutation_does_not_require_idle_agents", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: true,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(true);
  });

  it("returns_false_when_active_mutation", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: true,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(false);
  });

  it("returns_false_when_restart_block_in_progress", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: true,
        queuedCount: 1,
      })
    ).toBe(false);
  });

  it("returns_true_when_connected_idle_and_queue_non_empty", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(true);
  });
});
