import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  removeCronJobsForAgentWithBackup,
  restoreCronJobs,
  type CronJobRestoreInput,
} from "@/lib/cron/types";
import { deleteGatewayAgent } from "@/lib/gateway/agentConfig";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import { createRuntimeWriteTransport } from "@/features/agents/operations/runtimeWriteTransport";

vi.mock("@/lib/cron/types", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cron/types")>("@/lib/cron/types");
  return {
    ...actual,
    removeCronJobsForAgentWithBackup: vi.fn(),
    restoreCronJobs: vi.fn(),
  };
});

vi.mock("@/lib/gateway/agentConfig", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gateway/agentConfig")>(
    "@/lib/gateway/agentConfig"
  );
  return { ...actual, deleteGatewayAgent: vi.fn() };
});

type FetchJson = <T>(input: RequestInfo | URL, init?: RequestInit) => Promise<T>;

const createTrashResult = (overrides?: {
  trashDir?: string;
  moved?: Array<{ from: string; to: string }>;
}) => ({
  trashDir: "/tmp/trash",
  moved: [],
  ...(overrides ?? {}),
});

const createCronRestoreInput = (name = "Job 1", agentId = "agent-1"): CronJobRestoreInput => ({
  name,
  agentId,
  enabled: true,
  schedule: { kind: "every", everyMs: 60_000 },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Run checks." },
});

describe("delete agent via studio operation", () => {
  const mockedRemoveCronJobsForAgentWithBackup = vi.mocked(removeCronJobsForAgentWithBackup);
  const mockedRestoreCronJobs = vi.mocked(restoreCronJobs);
  const mockedDeleteGatewayAgent = vi.mocked(deleteGatewayAgent);

  beforeEach(() => {
    mockedRemoveCronJobsForAgentWithBackup.mockReset();
    mockedRestoreCronJobs.mockReset();
    mockedDeleteGatewayAgent.mockReset();
  });

  it("runs_steps_in_order_on_success", async () => {
    const calls: string[] = [];
    const fetchJson: FetchJson = vi.fn(async (_input, init) => {
      if (init?.method === "POST") {
        calls.push("trash");
        return { result: createTrashResult() } as never;
      }
      throw new Error("Unexpected fetchJson call");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      calls.push("removeCron");
      return [];
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      calls.push("restoreCron");
    });
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      calls.push("deleteGatewayAgent");
      return { removed: true, removedBindings: 0 };
    });

    await expect(
      deleteAgentViaStudio({ client: {} as never, agentId: "agent-1", fetchJson })
    ).resolves.toEqual({
      trashed: createTrashResult(),
      restored: null,
    });

    expect(calls).toEqual(["trash", "removeCron", "deleteGatewayAgent"]);
  });

  it("attempts_restore_when_remove_cron_fails_and_trash_moved_paths", async () => {
    const calls: string[] = [];
    const originalErr = new Error("boom");
    const trash = createTrashResult({
      trashDir: "/tmp/trash-2",
      moved: [{ from: "/a", to: "/b" }],
    });

    const fetchJson: FetchJson = vi.fn(async (_input, init) => {
      if (init?.method === "POST") {
        calls.push("trash");
        return { result: trash } as never;
      }
      if (init?.method === "PUT") {
        calls.push("restore:agent-1:/tmp/trash-2");
        return { result: { restored: [] } } as never;
      }
      throw new Error("Unexpected fetchJson call");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      calls.push("removeCron");
      throw originalErr;
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      calls.push("restoreCron");
    });
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      calls.push("deleteGatewayAgent");
      return { removed: true, removedBindings: 0 };
    });

    await expect(
      deleteAgentViaStudio({ client: {} as never, agentId: "agent-1", fetchJson })
    ).rejects.toBe(originalErr);

    expect(calls).toEqual(["trash", "removeCron", "restore:agent-1:/tmp/trash-2"]);
    expect(mockedRestoreCronJobs).not.toHaveBeenCalled();
    expect(mockedDeleteGatewayAgent).not.toHaveBeenCalled();
  });

  it("attempts_cron_restore_then_state_restore_when_gateway_delete_fails_and_trash_moved_paths", async () => {
    const calls: string[] = [];
    const originalErr = new Error("boom");
    const backups = [createCronRestoreInput("Job X", "agent-1")];

    const fetchJson: FetchJson = vi.fn(async (_input, init) => {
      if (init?.method === "POST") {
        calls.push("trash");
        return {
          result: createTrashResult({
            trashDir: "/tmp/trash-3",
            moved: [{ from: "/a", to: "/b" }],
          }),
        } as never;
      }
      if (init?.method === "PUT") {
        calls.push("restore:agent-1:/tmp/trash-3");
        return { result: { restored: [] } } as never;
      }
      throw new Error("Unexpected fetchJson call");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      calls.push("removeCron");
      return backups;
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      calls.push("restoreCron");
    });
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      calls.push("deleteGatewayAgent");
      throw originalErr;
    });

    await expect(
      deleteAgentViaStudio({ client: {} as never, agentId: "agent-1", fetchJson })
    ).rejects.toBe(originalErr);

    expect(calls).toEqual([
      "trash",
      "removeCron",
      "deleteGatewayAgent",
      "restoreCron",
      "restore:agent-1:/tmp/trash-3",
    ]);
    expect(mockedRestoreCronJobs).toHaveBeenCalledWith(expect.anything(), backups);
  });

  it("does_not_restore_when_trash_moved_is_empty", async () => {
    const originalErr = new Error("boom");
    const methods: string[] = [];

    const fetchJson: FetchJson = vi.fn(async (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") {
        return { result: createTrashResult({ moved: [] }) } as never;
      }
      if (method === "PUT") {
        throw new Error("restore should not be called");
      }
      throw new Error("Unexpected fetchJson call");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      throw originalErr;
    });
    mockedRestoreCronJobs.mockResolvedValue(undefined);
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      return { removed: true, removedBindings: 0 };
    });

    await expect(
      deleteAgentViaStudio({ client: {} as never, agentId: "agent-1", fetchJson })
    ).rejects.toBe(originalErr);

    expect(methods).toEqual(["POST"]);
    expect(mockedDeleteGatewayAgent).not.toHaveBeenCalled();
    expect(mockedRestoreCronJobs).not.toHaveBeenCalled();
  });

  it("logs_cron_and_state_restore_failures_and_still_throws_original_error", async () => {
    const originalErr = new Error("boom");
    const cronRestoreErr = new Error("cron-restore-failed");
    const restoreErr = new Error("restore-failed");
    const logError = vi.fn();
    const backups = [createCronRestoreInput("Job Z", "agent-1")];

    const fetchJson: FetchJson = vi.fn(async (_input, init) => {
      if (init?.method === "POST") {
        return {
          result: createTrashResult({
            trashDir: "/tmp/trash-4",
            moved: [{ from: "/a", to: "/b" }],
          }),
        } as never;
      }
      if (init?.method === "PUT") {
        throw restoreErr;
      }
      throw new Error("Unexpected fetchJson call");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      return backups;
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      throw cronRestoreErr;
    });
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      throw originalErr;
    });

    await expect(
      deleteAgentViaStudio({
        client: {} as never,
        agentId: "agent-1",
        fetchJson,
        logError,
      })
    ).rejects.toBe(originalErr);

    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenNthCalledWith(
      1,
      "Failed to restore removed cron jobs.",
      cronRestoreErr
    );
    expect(logError).toHaveBeenNthCalledWith(2, "Failed to restore trashed agent state.", restoreErr);
  });

  it("fails_fast_when_agent_id_is_missing", async () => {
    const fetchJson: FetchJson = vi.fn(async () => {
      throw new Error("fetch should not be called");
    });

    await expect(
      deleteAgentViaStudio({ client: {} as never, agentId: "   ", fetchJson })
    ).rejects.toThrow("Agent id is required.");

    expect(fetchJson).not.toHaveBeenCalled();
    expect(mockedRemoveCronJobsForAgentWithBackup).not.toHaveBeenCalled();
    expect(mockedRestoreCronJobs).not.toHaveBeenCalled();
    expect(mockedDeleteGatewayAgent).not.toHaveBeenCalled();
  });

  it("uses domain cron intents instead of browser cron rpc when domain intents are enabled", async () => {
    const fetchJson: FetchJson = vi.fn(async (input, init) => {
      if (input === "/api/runtime/agent-state" && init?.method === "POST") {
        return { result: createTrashResult() } as never;
      }
      if (input === "/api/intents/cron-remove-agent" && init?.method === "POST") {
        return { ok: true, payload: { removedJobs: [createCronRestoreInput("Job A", "agent-1")] } } as never;
      }
      throw new Error(`Unexpected fetchJson call: ${String(input)} ${init?.method ?? "GET"}`);
    });
    const postIntent = vi.fn(async (path: string) => {
      if (path === "/api/intents/agent-delete") {
        return { ok: true };
      }
      throw new Error(`Unexpected intent path: ${path}`);
    });
    const call = vi.fn(async () => {
      throw new Error("browser client unavailable");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      throw new Error("browser cron helper should not be used in domain mode");
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      throw new Error("browser cron restore helper should not be used in domain mode");
    });
    mockedDeleteGatewayAgent.mockImplementation(async () => {
      throw new Error("legacy delete should not be used in domain mode");
    });

    const runtimeWriteTransport = createRuntimeWriteTransport({
      client: { call } as never,
      useDomainIntents: true,
      postIntent,
    });

    await expect(
      deleteAgentViaStudio({
        client: { call } as never,
        runtimeWriteTransport,
        agentId: "agent-1",
        fetchJson,
      })
    ).resolves.toEqual({
      trashed: createTrashResult(),
      restored: null,
    });

    expect(fetchJson).toHaveBeenCalledWith(
      "/api/intents/cron-remove-agent",
      expect.objectContaining({ method: "POST" })
    );
    expect(postIntent).toHaveBeenCalledWith("/api/intents/agent-delete", { agentId: "agent-1" });
    expect(mockedRemoveCronJobsForAgentWithBackup).not.toHaveBeenCalled();
    expect(mockedRestoreCronJobs).not.toHaveBeenCalled();
    expect(mockedDeleteGatewayAgent).not.toHaveBeenCalled();
  });

  it("restores cron jobs via domain intent when delete fails after domain cron removals", async () => {
    const backups = [createCronRestoreInput("Job R", "agent-1")];
    const callOrder: string[] = [];
    const fetchJson: FetchJson = vi.fn(async (input, init) => {
      if (input === "/api/runtime/agent-state" && init?.method === "POST") {
        callOrder.push("trash");
        return {
          result: createTrashResult({
            trashDir: "/tmp/trash-domain",
            moved: [{ from: "/from", to: "/to" }],
          }),
        } as never;
      }
      if (input === "/api/intents/cron-remove-agent" && init?.method === "POST") {
        callOrder.push("cron-remove");
        return { ok: true, payload: { removedJobs: backups } } as never;
      }
      if (input === "/api/intents/cron-restore" && init?.method === "POST") {
        callOrder.push("cron-restore");
        return { ok: true, payload: { restored: backups.length } } as never;
      }
      if (input === "/api/runtime/agent-state" && init?.method === "PUT") {
        callOrder.push("state-restore");
        return { result: { restored: [] } } as never;
      }
      throw new Error(`Unexpected fetchJson call: ${String(input)} ${init?.method ?? "GET"}`);
    });
    const deleteErr = new Error("delete failed");
    const postIntent = vi.fn(async (path: string) => {
      if (path === "/api/intents/agent-delete") {
        throw deleteErr;
      }
      throw new Error(`Unexpected intent path: ${path}`);
    });
    const call = vi.fn(async () => {
      throw new Error("browser client unavailable");
    });

    mockedRemoveCronJobsForAgentWithBackup.mockImplementation(async () => {
      throw new Error("browser cron helper should not be used in domain mode");
    });
    mockedRestoreCronJobs.mockImplementation(async () => {
      throw new Error("browser cron restore helper should not be used in domain mode");
    });

    const runtimeWriteTransport = createRuntimeWriteTransport({
      client: { call } as never,
      useDomainIntents: true,
      postIntent,
    });

    await expect(
      deleteAgentViaStudio({
        client: { call } as never,
        runtimeWriteTransport,
        agentId: "agent-1",
        fetchJson,
      })
    ).rejects.toBe(deleteErr);

    expect(callOrder).toEqual(["trash", "cron-remove", "cron-restore", "state-restore"]);
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/intents/cron-restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockedRemoveCronJobsForAgentWithBackup).not.toHaveBeenCalled();
    expect(mockedRestoreCronJobs).not.toHaveBeenCalled();
  });
});
