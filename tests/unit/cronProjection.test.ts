import { describe, it, expect } from "vitest";
import {
  projectJobToSlots,
  projectAllJobsToSlots,
} from "@/features/calendar/cronProjection";
import type { CronJobSummary } from "@/lib/cron/types";

const makeJob = (
  id: string,
  schedule: CronJobSummary["schedule"],
  enabled = true
): CronJobSummary => ({
  id,
  name: `Job ${id}`,
  agentId: "test-agent",
  enabled,
  updatedAtMs: Date.now(),
  schedule,
  sessionTarget: "main",
  wakeMode: "next-heartbeat",
  payload: { kind: "systemEvent", text: "test" },
  state: {},
});

describe("projectJobToSlots", () => {
  it("projects a daily cron job to 7 slots in a week", () => {
    const mon = new Date(2024, 0, 8, 0, 0, 0, 0); // Monday
    const sun = new Date(2024, 0, 14, 23, 59, 59, 999);
    const job = makeJob("j1", { kind: "cron", expr: "30 9 * * *" });
    const slots = projectJobToSlots(job, mon.getTime(), sun.getTime());
    expect(slots.length).toBe(7);
    slots.forEach((s) => {
      const d = new Date(s.startMs);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(30);
    });
  });

  it("projects an every-ms job", () => {
    const start = new Date(2024, 0, 8, 0, 0, 0, 0).getTime();
    const end = start + 6 * 60 * 60 * 1000; // 6 hours
    const job = makeJob("j2", { kind: "every", everyMs: 3600000 }); // every hour
    const slots = projectJobToSlots(job, start, end);
    expect(slots.length).toBe(6);
  });

  it("projects an at-schedule within range", () => {
    const start = new Date(2024, 0, 8).getTime();
    const end = new Date(2024, 0, 15).getTime();
    const at = new Date(2024, 0, 10, 14, 0).toISOString();
    const job = makeJob("j3", { kind: "at", at });
    const slots = projectJobToSlots(job, start, end);
    expect(slots.length).toBe(1);
  });

  it("returns empty for at-schedule outside range", () => {
    const start = new Date(2024, 0, 8).getTime();
    const end = new Date(2024, 0, 9).getTime();
    const at = new Date(2024, 0, 15).toISOString();
    const job = makeJob("j3", { kind: "at", at });
    const slots = projectJobToSlots(job, start, end);
    expect(slots.length).toBe(0);
  });
});

describe("projectAllJobsToSlots", () => {
  it("excludes disabled jobs", () => {
    const start = new Date(2024, 0, 8).getTime();
    const end = new Date(2024, 0, 15).getTime();
    const enabled = makeJob("j1", { kind: "cron", expr: "0 12 * * *" }, true);
    const disabled = makeJob("j2", { kind: "cron", expr: "0 12 * * *" }, false);
    const slots = projectAllJobsToSlots([enabled, disabled], start, end);
    expect(slots.every((s) => s.job.id === "j1")).toBe(true);
  });

  it("sorts by startMs", () => {
    const start = new Date(2024, 0, 8).getTime();
    const end = new Date(2024, 0, 15).getTime();
    const j1 = makeJob("j1", { kind: "cron", expr: "0 14 * * *" });
    const j2 = makeJob("j2", { kind: "cron", expr: "0 8 * * *" });
    const slots = projectAllJobsToSlots([j1, j2], start, end);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startMs).toBeGreaterThanOrEqual(slots[i - 1].startMs);
    }
  });
});
