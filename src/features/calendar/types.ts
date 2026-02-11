import type { CronJobSummary, CronSchedule } from "@/lib/cron/types";

export type CalendarSlot = {
  job: CronJobSummary;
  startMs: number;
  label: string;
};

export type CalendarDay = {
  date: Date;
  slots: CalendarSlot[];
};
