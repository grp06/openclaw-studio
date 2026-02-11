import { describe, expect, it, vi } from "vitest";

import {
  createCronJob,
  listCronJobs,
  removeCronJob,
  removeCronJobsForAgent,
  runCronJobNow,
} from "@/lib/cron/types";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

describe("cron gateway client", () => {
  it("lists_jobs_via_cron_list_include_disabled_true", async () => {
    const client = {
      call: vi.fn(async () => ({ jobs: [] })),
    } as unknown as GatewayClient;

    await listCronJobs(client);

    expect(client.call).toHaveBeenCalledWith("cron.list", { includeDisabled: true });
  });

  it("runs_job_now_with_force_mode", async () => {
    const client = {
      call: vi.fn(async () => ({ ok: true, ran: true })),
    } as unknown as GatewayClient;

    await runCronJobNow(client, "job-1");

    expect(client.call).toHaveBeenCalledWith("cron.run", { id: "job-1", mode: "force" });
  });

  it("removes_job_by_id", async () => {
    const client = {
      call: vi.fn(async () => ({ ok: true, removed: true })),
    } as unknown as GatewayClient;

    await removeCronJob(client, "job-1");

    expect(client.call).toHaveBeenCalledWith("cron.remove", { id: "job-1" });
  });

  it("throws_when_job_id_missing_for_run_or_remove", async () => {
    const client = {
      call: vi.fn(async () => ({ ok: true })),
    } as unknown as GatewayClient;

    await expect(runCronJobNow(client, "   ")).rejects.toThrow("Cron job id is required.");
    await expect(removeCronJob(client, "")).rejects.toThrow("Cron job id is required.");
  });

  it("removes_all_jobs_for_agent", async () => {
    const client = {
      call: vi.fn(async (method: string, payload: { id?: string }) => {
        if (method === "cron.list") {
          return {
            jobs: [
              { id: "job-1", name: "Job 1", agentId: "agent-1" },
              { id: "job-2", name: "Job 2", agentId: "agent-2" },
              { id: "job-3", name: "Job 3", agentId: "agent-1" },
            ],
          };
        }
        if (method === "cron.remove") {
          return { ok: true, removed: payload.id !== "job-3" };
        }
        throw new Error(`Unexpected method: ${method}`);
      }),
    } as unknown as GatewayClient;

    await expect(removeCronJobsForAgent(client, "agent-1")).resolves.toBe(1);
    expect(client.call).toHaveBeenCalledWith("cron.list", { includeDisabled: true });
    expect(client.call).toHaveBeenCalledWith("cron.remove", { id: "job-1" });
    expect(client.call).toHaveBeenCalledWith("cron.remove", { id: "job-3" });
  });

  it("throws_when_agent_id_missing_for_bulk_remove", async () => {
    const client = {
      call: vi.fn(async () => ({ jobs: [] })),
    } as unknown as GatewayClient;

    await expect(removeCronJobsForAgent(client, "   ")).rejects.toThrow("Agent id is required.");
  });

  it("throws_when_any_bulk_remove_call_fails", async () => {
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "cron.list") {
          return {
            jobs: [{ id: "job-1", name: "Job 1", agentId: "agent-1" }],
          };
        }
        if (method === "cron.remove") {
          return { ok: false, removed: false };
        }
        throw new Error(`Unexpected method: ${method}`);
      }),
    } as unknown as GatewayClient;

    await expect(removeCronJobsForAgent(client, "agent-1")).rejects.toThrow(
      'Failed to delete cron job "Job 1" (job-1).'
    );
  });

  it("creates_job_via_cron_add", async () => {
    const client = {
      call: vi.fn(async () => ({ id: "job-1", name: "Morning brief" })),
    } as unknown as GatewayClient;

    const input = {
      name: "Morning brief",
      agentId: "agent-1",
      enabled: true,
      schedule: { kind: "cron" as const, expr: "0 7 * * *", tz: "America/Chicago" },
      sessionTarget: "isolated" as const,
      wakeMode: "now" as const,
      payload: { kind: "agentTurn" as const, message: "Summarize overnight updates." },
      delivery: { mode: "announce" as const, channel: "last" },
    };

    await createCronJob(client, input);

    expect(client.call).toHaveBeenCalledWith("cron.add", input);
  });

  it("throws_when_create_payload_missing_required_name", async () => {
    const client = {
      call: vi.fn(async () => ({ id: "job-1" })),
    } as unknown as GatewayClient;

    await expect(
      createCronJob(client, {
        name: "   ",
        agentId: "agent-1",
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Run checks." },
      })
    ).rejects.toThrow("Cron job name is required.");
  });
});
