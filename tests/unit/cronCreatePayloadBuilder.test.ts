import { describe, expect, it } from "vitest";

import {
  buildCronJobCreateInput,
  type CronCreateDraft,
} from "@/lib/cron/createPayloadBuilder";

describe("cron create payload builder", () => {
  it("builds_agent_scoped_isolated_payload_from_template_defaults", () => {
    const draft: CronCreateDraft = {
      templateId: "morning-brief",
      name: "Morning brief",
      taskText: "Summarize overnight updates and priorities.",
      scheduleKind: "cron",
      cronExpr: "0 7 * * *",
      cronTz: "America/Chicago",
    };

    const input = buildCronJobCreateInput("agent-1", draft);

    expect(input).toEqual({
      name: "Morning brief",
      agentId: "agent-1",
      enabled: true,
      schedule: { kind: "cron", expr: "0 7 * * *", tz: "America/Chicago" },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message: "Summarize overnight updates and priorities.",
      },
      delivery: { mode: "announce", channel: "last" },
    });
  });

  it("builds_main_system_event_payload_when_advanced_mode_selected", () => {
    const draft: CronCreateDraft = {
      templateId: "reminder",
      name: "Standup reminder",
      taskText: "Reminder: standup starts in 10 minutes.",
      scheduleKind: "every",
      everyAmount: 30,
      everyUnit: "minutes",
      advancedSessionTarget: "main",
      advancedWakeMode: "next-heartbeat",
    };

    const input = buildCronJobCreateInput("agent-2", draft);

    expect(input).toEqual({
      name: "Standup reminder",
      agentId: "agent-2",
      enabled: true,
      schedule: { kind: "every", everyMs: 1_800_000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "systemEvent",
        text: "Reminder: standup starts in 10 minutes.",
      },
    });
  });

  it("rejects_invalid_one_time_schedule_input", () => {
    const draft: CronCreateDraft = {
      templateId: "custom",
      name: "One time",
      taskText: "Run once later.",
      scheduleKind: "at",
      scheduleAt: "not-a-date",
    };

    expect(() => buildCronJobCreateInput("agent-1", draft)).toThrow("Invalid run time.");
  });

  it("rejects_invalid_interval_amount_for_every_schedule", () => {
    const draft: CronCreateDraft = {
      templateId: "custom",
      name: "Invalid interval",
      taskText: "Run repeatedly.",
      scheduleKind: "every",
      everyAmount: 0,
      everyUnit: "minutes",
    };

    expect(() => buildCronJobCreateInput("agent-1", draft)).toThrow("Invalid interval amount.");
  });
});
