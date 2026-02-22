'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, Clock } from 'lucide-react';

type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string };

type CronJobState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
};

type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
};

const POLL_INTERVAL = 30_000;

const formatSchedule = (schedule: CronSchedule): string => {
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs;
    if (ms % 86400000 === 0) return `${ms / 86400000}d`;
    if (ms % 3600000 === 0) return `${ms / 3600000}h`;
    if (ms % 60000 === 0) return `${ms / 60000}m`;
    return `${ms / 1000}s`;
  }
  if (schedule.kind === 'cron') return schedule.expr;
  return 'once';
};

const formatNextRun = (ms?: number): string | null => {
  if (!ms) return null;
  const diff = ms - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.ceil(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
};

export const CronWidget = () => {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [expanded, setExpanded] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/cron');
      if (response.ok) {
        const result = await response.json();
        setJobs(result.jobs || []);
      }
    } catch (err) {
      console.error('Failed to fetch cron jobs:', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL);
    const handleVisibility = () => { if (!document.hidden) fetchJobs(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchJobs]);

  if (jobs.length === 0) return null;

  const enabledJobs = jobs.filter(j => j.enabled);
  const disabledJobs = jobs.filter(j => !j.enabled);
  const errorJobs = jobs.filter(j => j.state.lastStatus === 'error');

  // Find earliest next run
  const nextRun = enabledJobs
    .map(j => j.state.nextRunAtMs)
    .filter((ms): ms is number => ms != null && ms > 0)
    .sort((a, b) => a - b)[0];

  return (
    <div className="w-full ui-panel">
      {/* Collapsed banner bar */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Cron Jobs
          </span>
          <div className="flex items-center gap-2">
            {enabledJobs.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                {enabledJobs.length} active
              </span>
            )}
            {disabledJobs.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {disabledJobs.length} disabled
              </span>
            )}
            {errorJobs.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                {errorJobs.length} error
              </span>
            )}
            {nextRun && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                next: {formatNextRun(nextRun)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/cron"
            className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
            onClick={e => e.stopPropagation()}
          >
            Manage <ChevronRight className="w-3 h-3" />
          </Link>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-3 pt-2 space-y-3 max-h-72 overflow-y-auto">
          {/* Active jobs */}
          {enabledJobs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Active</p>
              <div className="space-y-1.5">
                {enabledJobs.map(job => (
                  <div
                    key={job.id}
                    className="bg-green-500/10 border border-green-500/20 rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">{job.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {formatSchedule(job.schedule)}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message}
                    </p>
                    {job.state.nextRunAtMs && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Next: {formatNextRun(job.state.nextRunAtMs)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disabled jobs */}
          {disabledJobs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Disabled</p>
              <div className="space-y-1.5">
                {disabledJobs.map(job => (
                  <div
                    key={job.id}
                    className="bg-muted/30 border border-muted/50 rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">{job.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {formatSchedule(job.schedule)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
