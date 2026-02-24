'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Clock, AlertCircle, CheckCircle, XCircle, RefreshCw, X, Check, Download, BarChart3 } from 'lucide-react';
import type { Session, SessionsData } from '@/types/sessions';
import { dismissSession, markSessionDone, exportSessions } from '@/lib/sessions/actions';
import {
  formatDuration,
  formatRelativeTime,
  getReasonIcon,
  getReasonLabel,
  getReasonColor,
} from '@/lib/sessions/formatting';

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

type SessionsTabProps = {
  isActive: boolean;
};

export const SessionsTab = ({ isActive }: SessionsTabProps) => {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  const handleDismiss = useCallback(async (project: string) => {
    if (!confirm(`Dismiss session "${project}"?`)) return;

    setActionLoading(project);
    try {
      const result = await dismissSession(project, 'User dismissed from UI');
      if (result.success) {
        await fetchSessions(); // Refresh to show updated state
      } else {
        alert(`Failed to dismiss: ${result.error}`);
      }
    } catch (err) {
      console.error('Error dismissing session:', err);
      alert('Failed to dismiss session');
    } finally {
      setActionLoading(null);
    }
  }, [fetchSessions]);

  const handleMarkDone = useCallback(async (project: string) => {
    const summary = prompt(`Mark "${project}" as done.\n\nOptional summary:`);
    if (summary === null) return; // User cancelled

    setActionLoading(project);
    try {
      const result = await markSessionDone(project, summary || 'Marked complete from UI');
      if (result.success) {
        await fetchSessions(); // Refresh to show updated state
      } else {
        alert(`Failed to mark done: ${result.error}`);
      }
    } catch (err) {
      console.error('Error marking session done:', err);
      alert('Failed to mark session done');
    } finally {
      setActionLoading(null);
    }
  }, [fetchSessions]);

  const handleExport = useCallback(async (format: 'json' | 'csv') => {
    try {
      await exportSessions(format);
    } catch (err) {
      console.error('Error exporting sessions:', err);
      alert('Failed to export sessions');
    }
  }, []);

  const handleViewStats = useCallback(() => {
    window.open('/api/sessions/stats', '_blank');
  }, []);

  // Refresh when tab becomes active
  useEffect(() => {
    if (isActive) {
      fetchSessions();
    }
  }, [isActive, fetchSessions]);

  // Poll only when tab is active
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(fetchSessions, POLL_INTERVAL);

    const handleVisibilityChange = () => {
      if (!document.hidden && isActive) {
        fetchSessions();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActive, fetchSessions]);

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

  const dismissedCount = data.dismissed?.length || 0;
  const totalActive = data.active.length + data.paused.length + data.exited.length;

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
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
              onClick={handleViewStats}
              title="View Statistics"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <div className="relative group">
              <button
                type="button"
                className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                title="Export Sessions"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              {/* Export dropdown */}
              <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[120px]">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                  onClick={() => handleExport('json')}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                  onClick={() => handleExport('csv')}
                >
                  Export CSV
                </button>
              </div>
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
              {data.exited.map((session, i) => {
                const ReasonIcon = session.interruptReason ? getReasonIcon(session.interruptReason) : XCircle;
                const reasonLabel = session.interruptReason ? getReasonLabel(session.interruptReason) : 'Unknown';
                const colors = session.interruptReason ? getReasonColor(session.interruptReason) : {
                  text: 'text-orange-700 dark:text-orange-400',
                  bg: 'bg-orange-500/10',
                  border: 'border-orange-500/20',
                };

                return (
                  <div
                    key={`${session.project}-exited-${i}`}
                    className={`${colors.bg} border ${colors.border} rounded-md p-3 group`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{session.project}</p>

                        {/* Reason */}
                        <div className="flex items-center gap-1 mt-1">
                          <ReasonIcon className={`w-3 h-3 ${colors.text}`} />
                          <span className={`text-[10px] ${colors.text}`}>{reasonLabel}</span>
                        </div>

                        {/* Duration & Last Activity */}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          {session.durationMs && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatDuration(session.durationMs)}
                            </span>
                          )}
                          {session.lastActivityTime && (
                            <span>• {formatRelativeTime(session.lastActivityTime)}</span>
                          )}
                        </div>

                        {/* Details */}
                        {session.details && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                            {session.details}
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="ui-btn-icon h-6 w-6 !bg-green-500/20 hover:!bg-green-500/30 text-green-700 dark:text-green-400"
                          onClick={() => handleMarkDone(session.project)}
                          disabled={actionLoading === session.project}
                          title="Mark as done"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-icon h-6 w-6 !bg-gray-500/20 hover:!bg-gray-500/30 text-gray-700 dark:text-gray-400"
                          onClick={() => handleDismiss(session.project)}
                          disabled={actionLoading === session.project}
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dismissed (hidden by default, toggle at bottom) */}
        {showDismissed && data.dismissed && data.dismissed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground">Dismissed</p>
            </div>
            <div className="space-y-2">
              {data.dismissed.map((session, i) => (
                <div
                  key={`${session.project}-dismissed-${i}`}
                  className="bg-muted/30 border border-muted/50 rounded-md p-3 opacity-60"
                >
                  <p className="text-xs font-medium">{session.project}</p>
                  {session.details && (
                    <p className="text-[10px] text-muted-foreground mt-1">{session.details}</p>
                  )}
                  {session.dismissedAt && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Dismissed {formatRelativeTime(session.dismissedAt)}
                    </p>
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

        {/* Show dismissed toggle */}
        {dismissedCount > 0 && (
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 px-3 rounded hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
              onClick={() => setShowDismissed(!showDismissed)}
            >
              {showDismissed ? 'Hide' : 'Show'} dismissed sessions ({dismissedCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
