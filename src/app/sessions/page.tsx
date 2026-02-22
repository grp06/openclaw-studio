'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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

export default function SessionsPage() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const result: SessionsData = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header - matching studio style */}
      <div className="glass-panel fade-up ui-panel ui-topbar relative z-[180] px-3.5 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="hover:opacity-70 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="console-title type-page-title">Claude Code Sessions</h1>
          </div>
          <div className="text-xs text-muted-foreground">
            Last updated: {data?.lastUpdated ? formatTime(data.lastUpdated) : 'never'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-destructive">Error: {error}</p>
            </div>
          )}

          {/* Active Sessions */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Active Sessions ({data?.active.length || 0})
            </h2>
            {data?.active && data.active.length > 0 ? (
              <div className="grid gap-3">
                {data.active.map((session) => (
                  <div
                    key={session.project}
                    className="glass-panel ui-panel border-l-4 border-green-500/50 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{session.project}</p>
                        {session.details && (
                          <p className="text-xs text-muted-foreground mt-1">{session.details}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Started: {formatTime(session.startTime)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Running for: {getElapsedTime(session.startTime)}
                        </p>
                      </div>
                      <div className="animate-pulse bg-green-500/50 rounded-full h-3 w-3"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel ui-panel p-4 text-muted-foreground text-sm">
                No active sessions
              </div>
            )}
          </div>

          {/* Paused Sessions - NEEDS INPUT */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Paused - Needs Your Input ({data?.paused.length || 0})
            </h2>
            {data?.paused && data.paused.length > 0 ? (
              <div className="grid gap-3">
                {data.paused.map((session) => (
                  <div
                    key={session.project}
                    className="glass-panel ui-panel border-l-4 border-yellow-500/50 p-4 session-needs-input"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{session.project}</p>
                        {session.details && (
                          <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 font-medium">
                            {session.details}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Started: {formatTime(session.startTime)}
                        </p>
                      </div>
                      <div className="animate-pulse bg-yellow-500/50 rounded-full h-3 w-3"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel ui-panel p-4 text-muted-foreground text-sm">
                No paused sessions
              </div>
            )}
          </div>

          {/* Interrupted Sessions */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Interrupted ({data?.exited.length || 0})
            </h2>
            {data?.exited && data.exited.length > 0 ? (
              <div className="grid gap-3">
                {data.exited.map((session) => (
                  <div
                    key={`${session.project}-exited`}
                    className="glass-panel ui-panel border-l-4 border-orange-500/50 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{session.project}</p>
                        {session.details && (
                          <p className="text-xs text-muted-foreground mt-1">{session.details}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Ended: {session.endTime ? formatTime(session.endTime) : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel ui-panel p-4 text-muted-foreground text-sm">
                No interrupted sessions
              </div>
            )}
          </div>

          {/* Completed Sessions */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Completed Sessions ({data?.completed.length || 0})
            </h2>
            {data?.completed && data.completed.length > 0 ? (
              <div className="grid gap-3">
                {data.completed.map((session) => (
                  <div
                    key={`${session.project}-${session.endTime}`}
                    className="glass-panel ui-panel p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{session.project}</p>
                        {session.details && (
                          <p className="text-xs text-muted-foreground mt-1">{session.details}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Started: {formatTime(session.startTime)}
                        </p>
                        {session.endTime && (
                          <p className="text-xs text-muted-foreground">
                            Duration: {getElapsedTime(session.startTime, session.endTime)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel ui-panel p-4 text-muted-foreground text-sm">
                No completed sessions yet
              </div>
            )}
          </div>

          {/* Refresh button */}
          <div className="flex justify-center">
            <button
              onClick={fetchSessions}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition text-sm"
            >
              Refresh Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
