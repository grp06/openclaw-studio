'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Pencil, Power, PowerOff, X, FileText, ChevronRight, Play, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { GatewayClient, GatewayStatus } from '@/lib/gateway/GatewayClient';
import {
  listCronJobs,
  createCronJob,
  updateCronJob,
  removeCronJob,
  runCronJobNow,
  type CronJobSummary,
  type CronSchedule,
  type CronPayload,
  type CronDelivery,
} from '@/lib/cron/types';

type ReportFile = {
  name: string;
  size: number;
  modified: string;
};

const POLL_INTERVAL = 20_000;

const formatSchedule = (schedule: CronSchedule): string => {
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs;
    if (ms % 86400000 === 0) return `Every ${ms / 86400000}d`;
    if (ms % 3600000 === 0) return `Every ${ms / 3600000}h`;
    if (ms % 60000 === 0) return `Every ${ms / 60000}m`;
    return `Every ${ms / 1000}s`;
  }
  if (schedule.kind === 'cron') {
    return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr;
  }
  try {
    return `Once: ${new Date(schedule.at).toLocaleString()}`;
  } catch {
    return `Once: ${schedule.at}`;
  }
};

const formatPayload = (payload: CronPayload): string => {
  if (payload.kind === 'systemEvent') return payload.text;
  return payload.message;
};

const formatTime = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '-';
  }
};

const formatRelativeTime = (ms: number): string => {
  const diff = ms - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.ceil(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const decomposeEveryMs = (ms: number): { amount: string; unit: 'minutes' | 'hours' | 'days' } => {
  if (ms % 86400000 === 0) return { amount: String(ms / 86400000), unit: 'days' };
  if (ms % 3600000 === 0) return { amount: String(ms / 3600000), unit: 'hours' };
  if (ms % 60000 === 0) return { amount: String(ms / 60000), unit: 'minutes' };
  return { amount: String(ms / 60000), unit: 'minutes' };
};

type CronTabProps = {
  client: GatewayClient;
  gwStatus: GatewayStatus;
};

export const CronTab = ({ client, gwStatus }: CronTabProps) => {
  const [jobs, setJobs] = useState<CronJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formScheduleKind, setFormScheduleKind] = useState<'every' | 'cron' | 'at'>('every');
  const [formEveryAmount, setFormEveryAmount] = useState('1');
  const [formEveryUnit, setFormEveryUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [formCronExpr, setFormCronExpr] = useState('0 9 * * *');
  const [formAtTime, setFormAtTime] = useState('');
  const [formPayload, setFormPayload] = useState('');
  const [formSessionTarget, setFormSessionTarget] = useState<'isolated' | 'main'>('isolated');
  const [formNotifyTelegram, setFormNotifyTelegram] = useState(false);

  // Run now state
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  // Reports state
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [reportFiles, setReportFiles] = useState<ReportFile[]>([]);
  const [reportContent, setReportContent] = useState<{ name: string; content: string } | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);

  const isEditing = editingJobId !== null;

  const resetForm = () => {
    setShowForm(false);
    setEditingJobId(null);
    setFormName('');
    setFormScheduleKind('every');
    setFormEveryAmount('1');
    setFormEveryUnit('hours');
    setFormCronExpr('0 9 * * *');
    setFormAtTime('');
    setFormPayload('');
    setFormSessionTarget('isolated');
    setFormNotifyTelegram(false);
  };

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (job: CronJobSummary) => {
    setEditingJobId(job.id);
    setFormName(job.name);
    setFormSessionTarget(job.sessionTarget);
    setFormPayload(formatPayload(job.payload));
    setFormNotifyTelegram(job.delivery?.mode === 'announce');

    if (job.schedule.kind === 'every') {
      setFormScheduleKind('every');
      const { amount, unit } = decomposeEveryMs(job.schedule.everyMs);
      setFormEveryAmount(amount);
      setFormEveryUnit(unit);
    } else if (job.schedule.kind === 'cron') {
      setFormScheduleKind('cron');
      setFormCronExpr(job.schedule.expr);
    } else {
      setFormScheduleKind('at');
      try {
        setFormAtTime(new Date(job.schedule.at).toISOString().slice(0, 16));
      } catch {
        setFormAtTime('');
      }
    }

    setShowForm(true);
  };

  const fetchJobs = useCallback(async () => {
    if (gwStatus !== 'connected') return;
    try {
      const result = await listCronJobs(client, { includeDisabled: true });
      setJobs(result.jobs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cron jobs');
    } finally {
      setLoading(false);
    }
  }, [client, gwStatus]);

  useEffect(() => {
    if (gwStatus !== 'connected') {
      if (gwStatus === 'disconnected') setLoading(false);
      return;
    }
    fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL);
    const handleVisibility = () => { if (!document.hidden) fetchJobs(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchJobs, gwStatus]);

  const toggleReports = async (job: CronJobSummary) => {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      setReportFiles([]);
      setReportContent(null);
      return;
    }

    if (!job.outputDir) return;

    setExpandedJobId(job.id);
    setReportContent(null);
    setLoadingReports(true);

    try {
      const res = await fetch(`/api/cron/reports?dir=${encodeURIComponent(job.outputDir)}`);
      if (res.ok) {
        const data = await res.json();
        setReportFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoadingReports(false);
    }
  };

  const openReport = async (outputDir: string, fileName: string) => {
    try {
      const res = await fetch(`/api/cron/reports?dir=${encodeURIComponent(outputDir)}&file=${encodeURIComponent(fileName)}`);
      if (res.ok) {
        const data = await res.json();
        setReportContent({ name: data.name, content: data.content });
      }
    } catch (err) {
      console.error('Failed to read report:', err);
    }
  };

  const buildSchedule = (): CronSchedule => {
    if (formScheduleKind === 'every') {
      const multiplier = formEveryUnit === 'minutes' ? 60000 :
                        formEveryUnit === 'hours' ? 3600000 : 86400000;
      return { kind: 'every', everyMs: parseInt(formEveryAmount, 10) * multiplier };
    }
    if (formScheduleKind === 'cron') {
      return { kind: 'cron', expr: formCronExpr.trim() };
    }
    return { kind: 'at', at: new Date(formAtTime).toISOString() };
  };

  const buildPayload = (): CronPayload => {
    if (formSessionTarget === 'main') {
      return { kind: 'systemEvent', text: formPayload.trim() };
    }
    return { kind: 'agentTurn', message: formPayload.trim() };
  };

  const handleToggle = async (id: string) => {
    setBusy(true);
    try {
      const job = jobs.find(j => j.id === id);
      if (!job) return;
      await updateCronJob(client, id, { enabled: !job.enabled });
      await fetchJobs();
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await removeCronJob(client, id);
      await fetchJobs();
    } catch (err) {
      console.error('Remove failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async (id: string) => {
    setRunningJobId(id);
    try {
      await runCronJobNow(client, id);
      await fetchJobs();
    } catch (err) {
      console.error('Run failed:', err);
    } finally {
      setTimeout(() => setRunningJobId(null), 2000);
    }
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formPayload.trim()) return;
    setBusy(true);
    try {
      const schedule = buildSchedule();
      const payload = buildPayload();

      const delivery: CronDelivery = formNotifyTelegram
        ? { mode: 'announce', channel: 'last' }
        : { mode: 'none' };

      if (isEditing) {
        await updateCronJob(client, editingJobId!, {
          name: formName.trim(),
          schedule,
          payload,
          delivery,
        });
        await fetchJobs();
        resetForm();
      } else {
        await createCronJob(client, {
          name: formName.trim(),
          agentId: 'studio',
          schedule,
          sessionTarget: formSessionTarget,
          wakeMode: 'now',
          payload,
          delivery,
        });
        await fetchJobs();
        resetForm();
      }
    } catch (err) {
      console.error('Submit failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setBusy(false);
    }
  };

  if (gwStatus === 'connecting' || (gwStatus === 'connected' && loading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">
            {gwStatus === 'connecting' ? 'Connecting...' : 'Loading jobs...'}
          </p>
        </div>
      </div>
    );
  }

  if (gwStatus === 'disconnected') {
    return (
      <div className="p-4">
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff className="w-4 h-4 text-destructive" />
            <p className="text-destructive text-sm font-medium">Gateway Disconnected</p>
          </div>
          <p className="text-destructive/80 text-xs">
            Cannot reach the OpenClaw gateway. Make sure it is running.
          </p>
        </div>
      </div>
    );
  }

  const enabledCount = jobs.filter(j => j.enabled).length;
  const disabledCount = jobs.filter(j => !j.enabled).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header actions */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-muted-foreground">
              {enabledCount} active / {disabledCount} disabled
            </span>
          </div>
          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={fetchJobs}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          type="button"
          className="ui-btn-primary w-full px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
          onClick={openAddForm}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Job
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-destructive text-xs">{error}</p>
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="ui-panel p-3 space-y-2.5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold">
                {isEditing ? 'Edit Job' : 'New Job'}
              </h3>
              <button
                type="button"
                className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-muted"
                onClick={resetForm}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <input
              type="text"
              className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
              placeholder="Job name"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />

            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Schedule</label>
              <div className="ui-segment grid-cols-3" style={{ display: 'inline-grid' }}>
                {(['every', 'cron', 'at'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className="ui-segment-item px-2 py-1 text-[11px] font-medium capitalize"
                    data-active={formScheduleKind === kind ? 'true' : 'false'}
                    onClick={() => setFormScheduleKind(kind)}
                  >
                    {kind === 'every' ? 'Interval' : kind === 'cron' ? 'Cron' : 'Once'}
                  </button>
                ))}
              </div>
            </div>

            {formScheduleKind === 'every' && (
              <div className="flex gap-2 items-center">
                <span className="text-[10px] text-muted-foreground">Every</span>
                <input
                  type="number"
                  className="ui-input w-16 rounded-md px-2 py-1 text-xs"
                  min="1"
                  value={formEveryAmount}
                  onChange={e => setFormEveryAmount(e.target.value)}
                />
                <select
                  className="ui-input rounded-md px-2 py-1 text-[10px]"
                  value={formEveryUnit}
                  onChange={e => setFormEveryUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                >
                  <option value="minutes">min</option>
                  <option value="hours">hrs</option>
                  <option value="days">days</option>
                </select>
              </div>
            )}
            {formScheduleKind === 'cron' && (
              <input
                type="text"
                className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs font-mono"
                placeholder="0 9 * * *"
                value={formCronExpr}
                onChange={e => setFormCronExpr(e.target.value)}
              />
            )}
            {formScheduleKind === 'at' && (
              <input
                type="datetime-local"
                className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
                value={formAtTime}
                onChange={e => setFormAtTime(e.target.value)}
              />
            )}

            {!isEditing && (
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Session</label>
                <div className="ui-segment grid-cols-2" style={{ display: 'inline-grid' }}>
                  {(['isolated', 'main'] as const).map(target => (
                    <button
                      key={target}
                      type="button"
                      className="ui-segment-item px-2 py-1 text-[11px] font-medium capitalize"
                      data-active={formSessionTarget === target ? 'true' : 'false'}
                      onClick={() => setFormSessionTarget(target)}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                className={`flex-shrink-0 h-4 w-7 rounded-full transition-colors relative ${
                  formNotifyTelegram ? 'bg-primary' : 'bg-muted'
                }`}
                onClick={() => setFormNotifyTelegram(v => !v)}
              >
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  formNotifyTelegram ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-[10px] text-muted-foreground">
                Notify via Telegram
              </span>
            </label>

            <textarea
              className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs min-h-[60px] resize-y"
              placeholder="Task/prompt..."
              value={formPayload}
              onChange={e => setFormPayload(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                type="button"
                className="ui-btn-primary flex-1 px-3 py-1.5 text-[11px] font-medium"
                onClick={handleSubmit}
                disabled={busy || !formName.trim() || !formPayload.trim()}
              >
                {isEditing ? 'Save' : 'Create'}
              </button>
              <button
                type="button"
                className="ui-btn-secondary px-3 py-1.5 text-[11px] font-medium"
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Report Viewer */}
        {reportContent && (
          <div className="ui-panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-semibold">{reportContent.name}</h3>
              </div>
              <button
                type="button"
                className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-muted"
                onClick={() => setReportContent(null)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className="bg-muted/30 border border-border rounded-md p-3 text-[10px] font-mono overflow-auto max-h-[300px] whitespace-pre-wrap">
              {reportContent.content}
            </pre>
          </div>
        )}

        {/* Jobs list */}
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No scheduled jobs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {[...jobs].sort((a, b) => b.updatedAtMs - a.updatedAtMs).map(job => {
              const isExpanded = expandedJobId === job.id;
              const hasOutputDir = !!job.outputDir;

              return (
                <div
                  key={job.id}
                  className={`ui-panel border-l-4 transition-opacity ${
                    job.enabled
                      ? 'border-green-500/50'
                      : 'border-muted opacity-60'
                  } ${busy ? 'pointer-events-none' : ''}`}
                >
                  <div className="flex items-start justify-between px-3 py-2 group">
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-xs">{job.name}</p>
                        {job.enabled ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-1 py-0.5 text-[9px] font-semibold text-green-700 dark:text-green-400">
                            <span className="inline-block h-1 w-1 rounded-full bg-green-500" />
                            on
                          </span>
                        ) : (
                          <span className="inline-flex rounded-md bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                            off
                          </span>
                        )}
                        {(job.state.runningAtMs || runningJobId === job.id) && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/15 px-1 py-0.5 text-[9px] font-semibold text-yellow-700 dark:text-yellow-400">
                            <Loader2 className="w-2 h-2 animate-spin" />
                          </span>
                        )}
                        {job.delivery?.mode === 'announce' && (
                          <span className="inline-flex rounded-md bg-blue-500/15 px-1 py-0.5 text-[9px] font-medium text-blue-700 dark:text-blue-400">
                            TG
                          </span>
                        )}
                        {job.state.lastStatus === 'error' && (
                          <span className="inline-flex rounded-md bg-destructive/15 px-1 py-0.5 text-[9px] font-medium text-destructive">
                            err
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {formatSchedule(job.schedule)}
                      </p>

                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {formatPayload(job.payload)}
                      </p>

                      {job.state.nextRunAtMs && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          Next: {formatRelativeTime(job.state.nextRunAtMs)}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-green-500/10 text-muted-foreground hover:!text-green-600"
                        onClick={() => handleRun(job.id)}
                        disabled={runningJobId === job.id}
                        title="Run Now"
                      >
                        {runningJobId === job.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>
                      {hasOutputDir && (
                        <button
                          type="button"
                          className={`ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-primary/10 ${isExpanded ? 'text-primary' : 'text-muted-foreground hover:!text-primary'}`}
                          onClick={() => toggleReports(job)}
                          title="Reports"
                        >
                          <FileText className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-muted"
                        onClick={() => openEditForm(job)}
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-muted"
                        onClick={() => handleToggle(job.id)}
                        title={job.enabled ? 'Disable' : 'Enable'}
                      >
                        {job.enabled ? (
                          <PowerOff className="w-3 h-3" />
                        ) : (
                          <Power className="w-3 h-3 text-green-600" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="ui-btn-icon h-6 w-6 !bg-transparent hover:!bg-destructive/10 text-muted-foreground hover:!text-destructive"
                        onClick={() => handleRemove(job.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Reports */}
                  {isExpanded && hasOutputDir && (
                    <div className="border-t border-border px-3 pb-2 pt-1.5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FileText className="w-3 h-3 text-muted-foreground" />
                        <p className="text-[10px] font-semibold text-muted-foreground">Reports</p>
                      </div>

                      {loadingReports ? (
                        <div className="text-[10px] text-muted-foreground py-1">Loading...</div>
                      ) : reportFiles.length === 0 ? (
                        <div className="text-[10px] text-muted-foreground py-1">No reports yet.</div>
                      ) : (
                        <div className="space-y-0.5">
                          {reportFiles.map(file => (
                            <button
                              key={file.name}
                              type="button"
                              className="flex items-center justify-between w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/50 transition group/file"
                              onClick={() => openReport(job.outputDir!, file.name)}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <FileText className="w-3 h-3 text-primary flex-shrink-0" />
                                <span className="text-[10px] font-medium truncate">{file.name}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[9px] text-muted-foreground">
                                  {formatFileSize(file.size)}
                                </span>
                                <ChevronRight className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover/file:opacity-100" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
