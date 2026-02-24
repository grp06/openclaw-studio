import { describe, expect, it } from "vitest";

import {
  planAgentSettingsMutation,
  type AgentSettingsMutationContext,
} from "@/features/agents/operations/agentSettingsMutationWorkflow";

const createContext = (
  overrides?: Partial<AgentSettingsMutationContext>
): AgentSettingsMutationContext => ({
  status: "connected",
  hasCreateBlock: false,
  hasRenameBlock: false,
  hasDeleteBlock: false,
  cronCreateBusy: false,
  cronRunBusyJobId: null,
  cronDeleteBusyJobId: null,
  ...(overrides ?? {}),
});

describe("agentSettingsMutationWorkflow", () => {
  it("denies_guarded_actions_when_not_connected", () => {
    const result = planAgentSettingsMutation(
      { kind: "rename-agent", agentId: "agent-1" },
      createContext({ status: "disconnected" })
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "start-guard-deny",
      message: null,
      guardReason: "not-connected",
    });
  });

  it("denies_delete_for_reserved_main_agent_with_actionable_message", () => {
    const result = planAgentSettingsMutation(
      { kind: "delete-agent", agentId: " main " },
      createContext()
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "reserved-main-delete",
      message: "The main agent cannot be deleted.",
    });
  });

  it("denies_guarded_actions_when_mutation_block_is_active", () => {
    const result = planAgentSettingsMutation(
      { kind: "update-agent-permissions", agentId: "agent-1" },
      createContext({ hasCreateBlock: true })
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "start-guard-deny",
      message: null,
      guardReason: "create-block-active",
    });
  });

  it("denies_cron_run_delete_when_other_cron_action_is_busy", () => {
    const result = planAgentSettingsMutation(
      { kind: "run-cron-job", agentId: "agent-1", jobId: "job-1" },
      createContext({ cronDeleteBusyJobId: "job-2" })
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "cron-action-busy",
      message: null,
    });
  });

  it("allows_with_normalized_agent_and_job_ids", () => {
    const runResult = planAgentSettingsMutation(
      { kind: "run-cron-job", agentId: " agent-1 ", jobId: " job-1 " },
      createContext()
    );
    const deleteResult = planAgentSettingsMutation(
      { kind: "delete-agent", agentId: " agent-2 " },
      createContext()
    );

    expect(runResult).toEqual({
      kind: "allow",
      normalizedAgentId: "agent-1",
      normalizedJobId: "job-1",
    });
    expect(deleteResult).toEqual({
      kind: "allow",
      normalizedAgentId: "agent-2",
    });
  });
});
