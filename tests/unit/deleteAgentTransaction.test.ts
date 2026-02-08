import { describe, expect, it, vi } from "vitest";

import {
  runDeleteAgentTransaction,
  type DeleteAgentTransactionDeps,
  type RestoreAgentStateResult,
  type TrashAgentStateResult,
} from "@/features/agents/operations/deleteAgentTransaction";

const createTrashResult = (overrides?: Partial<TrashAgentStateResult>): TrashAgentStateResult => ({
  trashDir: "/tmp/trash",
  moved: [],
  ...(overrides ?? {}),
});

describe("delete agent transaction", () => {
  it("runs_steps_in_order_on_success", async () => {
    const calls: string[] = [];
    const deps: DeleteAgentTransactionDeps = {
      trashAgentState: vi.fn(async () => {
        calls.push("trash");
        return createTrashResult();
      }),
      restoreAgentState: vi.fn(async () => {
        calls.push("restore");
        return { restored: [] };
      }),
      removeCronJobsForAgent: vi.fn(async () => {
        calls.push("removeCron");
      }),
      deleteGatewayAgent: vi.fn(async () => {
        calls.push("deleteGatewayAgent");
      }),
    };

    await expect(runDeleteAgentTransaction(deps, "agent-1")).resolves.toEqual({
      trashed: createTrashResult(),
      restored: null,
    });
    expect(calls).toEqual(["trash", "removeCron", "deleteGatewayAgent"]);
    expect(deps.restoreAgentState).not.toHaveBeenCalled();
  });

  it("attempts_restore_when_remove_cron_fails_and_trash_moved_paths", async () => {
    const calls: string[] = [];
    const originalErr = new Error("boom");
    const trash = createTrashResult({
      trashDir: "/tmp/trash-2",
      moved: [{ from: "/a", to: "/b" }],
    });

    const deps: DeleteAgentTransactionDeps = {
      trashAgentState: vi.fn(async () => {
        calls.push("trash");
        return trash;
      }),
      restoreAgentState: vi.fn(async (agentId, trashDir): Promise<RestoreAgentStateResult> => {
        calls.push(`restore:${agentId}:${trashDir}`);
        return { restored: [] };
      }),
      removeCronJobsForAgent: vi.fn(async () => {
        calls.push("removeCron");
        throw originalErr;
      }),
      deleteGatewayAgent: vi.fn(async () => {
        calls.push("deleteGatewayAgent");
      }),
    };

    await expect(runDeleteAgentTransaction(deps, "agent-1")).rejects.toBe(originalErr);
    expect(calls).toEqual(["trash", "removeCron", "restore:agent-1:/tmp/trash-2"]);
  });

  it("attempts_restore_when_delete_agent_fails_and_trash_moved_paths", async () => {
    const calls: string[] = [];
    const originalErr = new Error("boom");
    const trash = createTrashResult({
      trashDir: "/tmp/trash-3",
      moved: [{ from: "/a", to: "/b" }],
    });

    const deps: DeleteAgentTransactionDeps = {
      trashAgentState: vi.fn(async () => {
        calls.push("trash");
        return trash;
      }),
      restoreAgentState: vi.fn(async (agentId, trashDir): Promise<RestoreAgentStateResult> => {
        calls.push(`restore:${agentId}:${trashDir}`);
        return { restored: [] };
      }),
      removeCronJobsForAgent: vi.fn(async () => {
        calls.push("removeCron");
      }),
      deleteGatewayAgent: vi.fn(async () => {
        calls.push("deleteGatewayAgent");
        throw originalErr;
      }),
    };

    await expect(runDeleteAgentTransaction(deps, "agent-1")).rejects.toBe(originalErr);
    expect(calls).toEqual([
      "trash",
      "removeCron",
      "deleteGatewayAgent",
      "restore:agent-1:/tmp/trash-3",
    ]);
  });

  it("does_not_restore_when_trash_moved_is_empty", async () => {
    const originalErr = new Error("boom");
    const deps: DeleteAgentTransactionDeps = {
      trashAgentState: vi.fn(async () => createTrashResult({ moved: [] })),
      restoreAgentState: vi.fn(async () => ({ restored: [] })),
      removeCronJobsForAgent: vi.fn(async () => {
        throw originalErr;
      }),
      deleteGatewayAgent: vi.fn(async () => {}),
    };

    await expect(runDeleteAgentTransaction(deps, "agent-1")).rejects.toBe(originalErr);
    expect(deps.restoreAgentState).not.toHaveBeenCalled();
  });

  it("logs_restore_failure_and_still_throws_original_error", async () => {
    const originalErr = new Error("boom");
    const restoreErr = new Error("restore-failed");
    const logError = vi.fn();

    const deps: DeleteAgentTransactionDeps = {
      trashAgentState: vi.fn(async () =>
        createTrashResult({ trashDir: "/tmp/trash-4", moved: [{ from: "/a", to: "/b" }] })
      ),
      restoreAgentState: vi.fn(async () => {
        throw restoreErr;
      }),
      removeCronJobsForAgent: vi.fn(async () => {}),
      deleteGatewayAgent: vi.fn(async () => {
        throw originalErr;
      }),
      logError,
    };

    await expect(runDeleteAgentTransaction(deps, "agent-1")).rejects.toBe(originalErr);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Failed to restore trashed agent state.", restoreErr);
  });
});

