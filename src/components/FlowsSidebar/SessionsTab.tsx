'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Clock, AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
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

export const SessionsTab = () => {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const result: SessionsData = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
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
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          Failed to load sessions.
        </div>
      </div>
    );
  }

  const staleCount = data.stale?.length || 0;
  const totalActive = data.active.length + data.paused.length + data.exited.length + staleCount;

  if (totalActive === 0 && data.completed.length === 0) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          No active sessions.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5" />
            <span>
              {totalActive} active / {data.completed.length} done
            </span>
          </div>
          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={fetchSessions}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {/* Paused - most prominent */}
        {data.paused.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                Needs Your Input
              </p>
            </div>
            <div className="space-y-2">
              {data.paused.map((session, i) => (
                <div
                  key={`${session.project}-paused-${i}`}
                  className="bg-yellow-500/15 border border-yellow-500/30 rounded-md p-3"
                >
                  <p className="text-xs font-semibold">{session.project}</p>
                  {session.details && (
                    <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-1">
                      {session.details}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Started: {formatTime(session.startTime)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active */}
        {data.active.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3.5 h-3.5 text-green-600 dark:text-green-400 animate-pulse" />
              <p className="text-xs font-semibold text-muted-foreground">Active</p>
            </div>
            <div className="space-y-2">
              {data.active.map((session, i) => (
                <div
                  key={`${session.project}-active-${i}`}
                  className="bg-green-500/10 border border-green-500/20 rounded-md p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">{session.project}</p>
                    <span className="inline-flex items-center gap-1 rounded-md bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                      <Clock className="w-2.5 h-2.5" />
                      {getElapsedTime(session.startTime)}
                    </span>
                  </div>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interrupted */}
        {data.exited.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
              <p className="text-xs font-semibold text-muted-foreground">Interrupted</p>
            </div>
            <div className="space-y-2">
              {data.exited.map((session, i) => (
                <div
                  key={`${session.project}-exited-${i}`}
                  className="bg-orange-500/10 border border-orange-500/20 rounded-md p-3"
                >
                  <p className="text-xs font-medium">{session.project}</p>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stale */}
        {data.stale && data.stale.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Stale</p>
            <div className="space-y-2">
              {data.stale.map((session, i) => (
                <div
                  key={`${session.project}-stale-${i}`}
                  className="bg-gray-500/10 border border-gray-500/20 rounded-md p-3 opacity-70"
                >
                  <p className="text-xs font-medium">{session.project}</p>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {data.completed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground">Completed</p>
            </div>
            <div className="space-y-2">
              {data.completed.map((session, i) => (
                <div
                  key={`${session.project}-completed-${i}`}
                  className="bg-muted/30 border border-muted/50 rounded-md p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">{session.project}</p>
                    {session.endTime && (
                      <span className="text-[10px] text-muted-foreground">
                        {getElapsedTime(session.startTime, session.endTime)}
                      </span>
                    )}
                  </div>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
