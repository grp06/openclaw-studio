/**
 * DASH-012: Project cron schedules into calendar time slots for a given week.
 */

import type { CronJobSummary, CronSchedule } from "@/lib/cron/types";
import type { CalendarSlot } from "./types";

/**
 * Simple cron expression parser for common patterns.
 * Supports: "m h * * *" (daily at h:m), "m h * * d" (weekly on day d).
 * Returns occurrences within [startMs, endMs).
 */
const projectCronExpr = (
  expr: string,
  tz: string | undefined,
  startMs: number,
  endMs: number
): number[] => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return [];

  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  const dayOfWeek = parts[4];

  if (isNaN(minute) || isNaN(hour)) return [];

  const results: number[] = [];
  const current = new Date(startMs);
  current.setHours(hour, minute, 0, 0);

  // Walk day by day
  const start = new Date(startMs);
  start.setHours(0, 0, 0, 0);

  for (let d = 0; d < 7; d++) {
    const day = new Date(start);
    day.setDate(day.getDate() + d);
    day.setHours(hour, minute, 0, 0);

    const ts = day.getTime();
    if (ts < startMs || ts >= endMs) continue;

    if (dayOfWeek === "*") {
      results.push(ts);
    } else {
      const dow = parseInt(dayOfWeek, 10);
      if (!isNaN(dow) && day.getDay() === dow) {
        results.push(ts);
      }
    }
  }

  return results;
};

const projectEveryMs = (
  everyMs: number,
  anchorMs: number | undefined,
  startMs: number,
  endMs: number
): number[] => {
  if (everyMs <= 0) return [];

  const anchor = anchorMs ?? startMs;
  const results: number[] = [];

  // Find first occurrence >= startMs
  let t = anchor;
  if (t < startMs) {
    const skip = Math.ceil((startMs - t) / everyMs);
    t += skip * everyMs;
  }

  // Limit to avoid huge loops for very small intervals
  const maxSlots = 200;
  let count = 0;
  while (t < endMs && count < maxSlots) {
    results.push(t);
    t += everyMs;
    count++;
  }

  return results;
};

export const projectJobToSlots = (
  job: CronJobSummary,
  startMs: number,
  endMs: number
): CalendarSlot[] => {
  const schedule = job.schedule;
  let timestamps: number[] = [];

  if (schedule.kind === "cron") {
    timestamps = projectCronExpr(schedule.expr, schedule.tz, startMs, endMs);
  } else if (schedule.kind === "every") {
    timestamps = projectEveryMs(schedule.everyMs, schedule.anchorMs, startMs, endMs);
  } else if (schedule.kind === "at") {
    const atMs = new Date(schedule.at).getTime();
    if (!isNaN(atMs) && atMs >= startMs && atMs < endMs) {
      timestamps = [atMs];
    }
  }

  return timestamps.map((ts) => ({
    job,
    startMs: ts,
    label: job.name,
  }));
};

export const projectAllJobsToSlots = (
  jobs: CronJobSummary[],
  startMs: number,
  endMs: number
): CalendarSlot[] => {
  return jobs
    .filter((j) => j.enabled)
    .flatMap((j) => projectJobToSlots(j, startMs, endMs))
    .sort((a, b) => a.startMs - b.startMs);
};
