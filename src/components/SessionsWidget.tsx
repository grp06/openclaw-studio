'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { Session, SessionsData } from '@/types/sessions';

const POLL_INTERVAL = 20_000;

const formatTime = (timestamp: string) => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

const getElapsedTime = (startTime: string, endTime?: string) => {
  try {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    }
    return `${diffMins}m`;
  } catch {
    return '-';
  }
};

export const SessionsWidget = () => {
  const [data, setData] = useState<SessionsData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const prevPausedRef = useRef(0);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const result: SessionsData = await response.json();
        setData(result);

        // Auto-expand if a new paused session appeared
        if (result.paused.length > prevPausedRef.current) {
          setExpanded(true);
        }
        prevPausedRef.current = result.paused.length;
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions();

    const interval = setInterval(fetchSessions, POLL_INTERVAL);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchSessions();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchSessions]);

  if (!data) return null;

  const totalActive = data.active.length + data.paused.length + data.exited.length;
  if (totalActive === 0 && data.completed.length === 0) return null;

  const hasPaused = data.paused.length > 0;

  return (
    <div
      className={`w-full ui-panel ${hasPaused ? 'session-needs-input' : ''}`}
    >
      {/* Collapsed banner bar */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Sessions
          </span>
          <div className="flex items-center gap-2">
            {data.active.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                {data.active.length} active
              </span>
            )}
            {data.paused.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/20 px-2 py-0.5 text-[11px] font-bold text-yellow-700 dark:text-yellow-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
                {data.paused.length} needs input
              </span>
            )}
            {data.exited.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">
                {data.exited.length} interrupted
              </span>
            )}
            {data.completed.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {data.completed.length} done
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/sessions"
            className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            View All <ChevronRight className="w-3 h-3" />
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
          {/* Paused - most prominent */}
          {data.paused.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1.5">
                Needs Your Input
              </p>
              <div className="space-y-1.5">
                {data.paused.map((session) => (
                  <div
                    key={session.project}
                    className="bg-yellow-500/15 border border-yellow-500/30 rounded-md p-2"
                  >
                    <p className="text-xs font-semibold">{session.project}</p>
                    {session.details && (
                      <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-0.5">
                        {session.details}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active */}
          {data.active.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Active</p>
              <div className="space-y-1.5">
                {data.active.map((session) => (
                  <div
                    key={session.project}
                    className="bg-green-500/10 border border-green-500/20 rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">{session.project}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {getElapsedTime(session.startTime)}
                      </p>
                    </div>
                    {session.details && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{session.details}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interrupted */}
          {data.exited.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Interrupted</p>
              <div className="space-y-1.5">
                {data.exited.map((session) => (
                  <div
                    key={`${session.project}-exited`}
                    className="bg-orange-500/10 border border-orange-500/20 rounded-md p-2"
                  >
                    <p className="text-xs font-medium">{session.project}</p>
                    {session.details && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{session.details}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed */}
          {data.completed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Completed</p>
              <div className="space-y-1.5">
                {data.completed.map((session) => (
                  <div
                    key={`${session.project}-${session.endTime}`}
                    className="bg-muted/30 border border-muted/50 rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">{session.project}</p>
                      {session.endTime && (
                        <p className="text-[10px] text-muted-foreground">
                          {getElapsedTime(session.startTime, session.endTime)}
                        </p>
                      )}
                    </div>
                    {session.details && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{session.details}</p>
                    )}
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
