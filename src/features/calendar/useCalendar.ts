"use client";

import { useCallback, useEffect, useState } from "react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { listCronJobs, runCronJobNow, removeCronJob } from "@/lib/cron/types";
import type { CronJobSummary } from "@/lib/cron/types";
import { startOfWeek, getWeekDays } from "@/lib/datetime/format";
import { projectAllJobsToSlots } from "./cronProjection";
import type { CalendarDay } from "./types";

export type UseCalendarReturn = {
  weekStart: Date;
  days: CalendarDay[];
  jobs: CronJobSummary[];
  loading: boolean;
  error: string | null;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToThisWeek: () => void;
  runJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useCalendar(
  client: GatewayClient | null | undefined
): UseCalendarReturn {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [jobs, setJobs] = useState<CronJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listCronJobs(client, { includeDisabled: true });
      setJobs(result.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch cron jobs");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const weekDays = getWeekDays(weekStart);
  const weekEndMs = new Date(weekStart).setDate(weekStart.getDate() + 7);
  const slots = projectAllJobsToSlots(jobs, weekStart.getTime(), weekEndMs);

  const days: CalendarDay[] = weekDays.map((date) => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return {
      date,
      slots: slots.filter(
        (s) => s.startMs >= dayStart.getTime() && s.startMs <= dayEnd.getTime()
      ),
    };
  });

  const goToPrevWeek = useCallback(() => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }, []);

  const goToThisWeek = useCallback(() => {
    setWeekStart(startOfWeek(new Date()));
  }, []);

  const runJob = useCallback(
    async (jobId: string) => {
      if (!client) return;
      try {
        await runCronJobNow(client, jobId);
        await fetchJobs();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to run cron job");
      }
    },
    [client, fetchJobs]
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      if (!client) return;
      try {
        await removeCronJob(client, jobId);
        await fetchJobs();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete cron job"
        );
      }
    },
    [client, fetchJobs]
  );

  return {
    weekStart,
    days,
    jobs,
    loading,
    error,
    goToPrevWeek,
    goToNextWeek,
    goToThisWeek,
    runJob,
    deleteJob,
    refresh: fetchJobs,
  };
}
