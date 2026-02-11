import { describe, expect, it, vi } from "vitest";

import { performCronCreateFlow } from "@/features/agents/operations/cronCreateOperation";
import type { CronCreateDraft } from "@/lib/cron/createPayloadBuilder";
import type { CronJobCreateInput, CronJobSummary } from "@/lib/cron/types";

const createDraft = (): CronCreateDraft => ({
  templateId: "custom",
  name: "Nightly sync",
  taskText: "Sync project status and report blockers.",
  scheduleKind: "every",
  everyAmount: 30,
  everyUnit: "minutes",
  deliveryMode: "announce",
  deliveryChannel: "last",
});

const createJob = (id: string, agentId: string, updatedAtMs: number): CronJobSummary => ({
  id,
  name: id,
  agentId,
  enabled: true,
  updatedAtMs,
  schedule: { kind: "every", everyMs: 60_000 },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Run task" },
  state: {},
});

const createInput = (): CronJobCreateInput => ({
  name: "Nightly sync",
  agentId: "agent-1",
  enabled: true,
  schedule: { kind: "every", everyMs: 1_800_000 },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Sync project status and report blockers." },
  delivery: { mode: "announce", channel: "last" },
});

describe("cron create flow state", () => {
  it("successful_create_refreshes_list_for_selected_agent", async () => {
    const client = {} as never;
    const onBusyChange = vi.fn();
    const onError = vi.fn();
    const onJobs = vi.fn();

    const buildInput = vi.fn(() => createInput());
    const createCronJob = vi.fn(async () => createJob("created", "agent-1", 15));
    const listCronJobs = vi.fn(async () => ({
      jobs: [
        createJob("older", "agent-1", 10),
        createJob("newer", "agent-1", 20),
        createJob("other-agent", "agent-2", 30),
      ],
    }));

    await expect(
      performCronCreateFlow({
        client,
        agentId: "agent-1",
        draft: createDraft(),
        busy: { createBusy: false, runBusyJobId: null, deleteBusyJobId: null },
        onBusyChange,
        onError,
        onJobs,
        deps: { buildInput, createCronJob, listCronJobs },
      })
    ).resolves.toBe("created");

    expect(buildInput).toHaveBeenCalledWith("agent-1", expect.any(Object));
    expect(createCronJob).toHaveBeenCalledWith(client, createInput());
    expect(listCronJobs).toHaveBeenCalledWith(client, { includeDisabled: true });
    expect(onJobs).toHaveBeenCalledWith([
      createJob("newer", "agent-1", 20),
      createJob("older", "agent-1", 10),
    ]);
    expect(onError).toHaveBeenCalledWith(null);
    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenNthCalledWith(2, false);
  });

  it("create_failure_surfaces_cron_error_message", async () => {
    const onBusyChange = vi.fn();
    const onError = vi.fn();
    const onJobs = vi.fn();
    const expectedError = new Error("Gateway exploded");

    await expect(
      performCronCreateFlow({
        client: {} as never,
        agentId: "agent-1",
        draft: createDraft(),
        busy: { createBusy: false, runBusyJobId: null, deleteBusyJobId: null },
        onBusyChange,
        onError,
        onJobs,
        deps: {
          buildInput: vi.fn(() => createInput()),
          createCronJob: vi.fn(async () => {
            throw expectedError;
          }),
          listCronJobs: vi.fn(async () => ({ jobs: [] })),
        },
      })
    ).rejects.toThrow("Gateway exploded");

    expect(onError).toHaveBeenNthCalledWith(1, null);
    expect(onError).toHaveBeenNthCalledWith(2, "Gateway exploded");
    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenNthCalledWith(2, false);
    expect(onJobs).not.toHaveBeenCalled();
  });

  it("create_is_blocked_while_run_or_delete_busy", async () => {
    const onBusyChange = vi.fn();
    const onError = vi.fn();
    const onJobs = vi.fn();
    const buildInput = vi.fn(() => createInput());
    const createCronJob = vi.fn(async () => createJob("created", "agent-1", 15));
    const listCronJobs = vi.fn(async () => ({ jobs: [] }));

    await expect(
      performCronCreateFlow({
        client: {} as never,
        agentId: "agent-1",
        draft: createDraft(),
        busy: { createBusy: false, runBusyJobId: "job-1", deleteBusyJobId: null },
        onBusyChange,
        onError,
        onJobs,
        deps: { buildInput, createCronJob, listCronJobs },
      })
    ).rejects.toThrow("Please wait for the current cron action to finish.");

    expect(onError).toHaveBeenCalledWith("Please wait for the current cron action to finish.");
    expect(onBusyChange).not.toHaveBeenCalled();
    expect(onJobs).not.toHaveBeenCalled();
    expect(buildInput).not.toHaveBeenCalled();
    expect(createCronJob).not.toHaveBeenCalled();
    expect(listCronJobs).not.toHaveBeenCalled();
  });

  it("fails_fast_when_agent_id_missing", async () => {
    const onBusyChange = vi.fn();
    const onError = vi.fn();
    const onJobs = vi.fn();
    const buildInput = vi.fn(() => createInput());
    const createCronJob = vi.fn(async () => createJob("created", "agent-1", 15));
    const listCronJobs = vi.fn(async () => ({ jobs: [] }));

    await expect(
      performCronCreateFlow({
        client: {} as never,
        agentId: "   ",
        draft: createDraft(),
        busy: { createBusy: false, runBusyJobId: null, deleteBusyJobId: null },
        onBusyChange,
        onError,
        onJobs,
        deps: { buildInput, createCronJob, listCronJobs },
      })
    ).rejects.toThrow("Failed to create cron job: missing agent id.");

    expect(onError).toHaveBeenCalledWith("Failed to create cron job: missing agent id.");
    expect(onBusyChange).not.toHaveBeenCalled();
    expect(onJobs).not.toHaveBeenCalled();
    expect(buildInput).not.toHaveBeenCalled();
    expect(createCronJob).not.toHaveBeenCalled();
    expect(listCronJobs).not.toHaveBeenCalled();
  });
});
