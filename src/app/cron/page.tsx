'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Pencil, Power, PowerOff, Clock, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';

type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string };

type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
};

type CronJob = {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: 'main' | 'isolated';
  wakeMode: 'next-heartbeat' | 'now';
  payload: CronPayload;
  state: CronJobState;
  outputDir?: string;
};

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

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
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

  const openEditForm = (job: CronJob) => {
    setEditingJobId(job.id);
    setFormName(job.name);
    setFormSessionTarget(job.sessionTarget);
    setFormPayload(formatPayload(job.payload));
    setFormNotifyTelegram((job as CronJob & { delivery?: { mode: string } }).delivery?.mode === 'announce');

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
    try {
      const response = await fetch('/api/cron');
      if (!response.ok) throw new Error('Failed to fetch cron jobs');
      const result = await response.json();
      setJobs(result.jobs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
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

  const toggleReports = async (job: CronJob) => {
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
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', id }),
      });
      if (res.ok) {
        const { jobs: updatedJobs } = await res.json();
        setJobs(updatedJobs);
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id }),
      });
      if (res.ok) {
        const { jobs: updatedJobs } = await res.json();
        setJobs(updatedJobs);
      }
    } catch (err) {
      console.error('Remove failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formPayload.trim()) return;
    setBusy(true);
    try {
      const schedule = buildSchedule();
      const payload = buildPayload();

      const delivery = formNotifyTelegram
        ? { mode: 'announce' as const, channel: 'last' }
        : { mode: 'none' as const };

      if (isEditing) {
        const res = await fetch('/api/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            id: editingJobId,
            name: formName.trim(),
            schedule,
            payload,
            delivery,
          }),
        });
        if (res.ok) {
          const { jobs: updatedJobs } = await res.json();
          setJobs(updatedJobs);
          resetForm();
        }
      } else {
        const res = await fetch('/api/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            name: formName.trim(),
            schedule,
            payload,
            sessionTarget: formSessionTarget,
            wakeMode: 'now',
            delivery,
          }),
        });
        if (res.ok) {
          const { jobs: updatedJobs } = await res.json();
          setJobs(updatedJobs);
          resetForm();
        }
      }
    } catch (err) {
      console.error('Submit failed:', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading cron jobs...</p>
        </div>
      </div>
    );
  }

  const enabledCount = jobs.filter(j => j.enabled).length;
  const disabledCount = jobs.filter(j => !j.enabled).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="glass-panel fade-up ui-panel ui-topbar relative z-[180] px-3.5 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="hover:opacity-70 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="console-title type-page-title">Scheduled Jobs</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {enabledCount} active / {disabledCount} disabled
            </div>
            <button
              type="button"
              className="ui-btn-primary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
              onClick={openAddForm}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Job
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-destructive">Error: {error}</p>
            </div>
          )}

          {/* Add/Edit Form */}
          {showForm && (
            <div className="ui-panel p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">
                  {isEditing ? 'Edit Job' : 'New Scheduled Job'}
                </h3>
                <button
                  type="button"
                  className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                  onClick={resetForm}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                className="ui-input w-full rounded-md px-3 py-2 text-sm"
                placeholder="Job name (e.g., Morning Brief)"
                value={formName}
                onChange={e => setFormName(e.target.value)}
              />

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Schedule</label>
                <div className="ui-segment grid-cols-3" style={{ display: 'inline-grid' }}>
                  {(['every', 'cron', 'at'] as const).map(kind => (
                    <button
                      key={kind}
                      type="button"
                      className="ui-segment-item px-3 py-1.5 text-[12px] font-medium capitalize"
                      data-active={formScheduleKind === kind ? 'true' : 'false'}
                      onClick={() => setFormScheduleKind(kind)}
                    >
                      {kind === 'every' ? 'Interval' : kind === 'cron' ? 'Cron Expr' : 'One-time'}
                    </button>
                  ))}
                </div>
              </div>

              {formScheduleKind === 'every' && (
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-muted-foreground">Every</span>
                  <input
                    type="number"
                    className="ui-input w-20 rounded-md px-2 py-1.5 text-sm"
                    min="1"
                    value={formEveryAmount}
                    onChange={e => setFormEveryAmount(e.target.value)}
                  />
                  <select
                    className="ui-input rounded-md px-2 py-1.5 text-xs"
                    value={formEveryUnit}
                    onChange={e => setFormEveryUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              )}
              {formScheduleKind === 'cron' && (
                <input
                  type="text"
                  className="ui-input w-full rounded-md px-3 py-2 text-sm font-mono"
                  placeholder="0 9 * * * (min hour dom mon dow)"
                  value={formCronExpr}
                  onChange={e => setFormCronExpr(e.target.value)}
                />
              )}
              {formScheduleKind === 'at' && (
                <input
                  type="datetime-local"
                  className="ui-input w-full rounded-md px-3 py-2 text-sm"
                  value={formAtTime}
                  onChange={e => setFormAtTime(e.target.value)}
                />
              )}

              {!isEditing && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Session</label>
                  <div className="ui-segment grid-cols-2" style={{ display: 'inline-grid' }}>
                    {(['isolated', 'main'] as const).map(target => (
                      <button
                        key={target}
                        type="button"
                        className="ui-segment-item px-3 py-1.5 text-[12px] font-medium capitalize"
                        data-active={formSessionTarget === target ? 'true' : 'false'}
                        onClick={() => setFormSessionTarget(target)}
                      >
                        {target}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Telegram notification */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  className={`flex-shrink-0 h-5 w-9 rounded-full transition-colors relative ${
                    formNotifyTelegram ? 'bg-primary' : 'bg-muted'
                  }`}
                  onClick={() => setFormNotifyTelegram(v => !v)}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    formNotifyTelegram ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-xs text-muted-foreground">
                  Notify via Telegram when complete
                </span>
              </label>

              <textarea
                className="ui-input w-full rounded-md px-3 py-2 text-sm min-h-[80px] resize-y"
                placeholder="Task/prompt for the agent..."
                value={formPayload}
                onChange={e => setFormPayload(e.target.value)}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn-primary px-4 py-1.5 text-xs font-medium"
                  onClick={handleSubmit}
                  disabled={busy || !formName.trim() || !formPayload.trim()}
                >
                  {isEditing ? 'Save Changes' : 'Create Job'}
                </button>
                <button
                  type="button"
                  className="ui-btn-secondary px-4 py-1.5 text-xs font-medium"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Report Viewer Modal */}
          {reportContent && (
            <div className="ui-panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">{reportContent.name}</h3>
                </div>
                <button
                  type="button"
                  className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                  onClick={() => setReportContent(null)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <pre className="bg-muted/30 border border-border rounded-md p-4 text-xs font-mono overflow-auto max-h-[500px] whitespace-pre-wrap">
                {reportContent.content}
              </pre>
            </div>
          )}

          {/* Jobs list */}
          {jobs.length === 0 ? (
            <div className="ui-panel p-8 text-center text-muted-foreground text-sm">
              No scheduled jobs. Create one above or use <code className="bg-muted px-1 rounded text-xs">openclaw cron add</code> via CLI.
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
                    <div className="flex items-start justify-between px-4 py-3 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{job.name}</p>
                          {job.enabled ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                              active
                            </span>
                          ) : (
                            <span className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              disabled
                            </span>
                          )}
                          {(job as CronJob & { delivery?: { mode: string } }).delivery?.mode === 'announce' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            TG
                          </span>
                        )}
                        {job.state.lastStatus === 'error' && (
                            <span className="inline-flex rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                              error
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 mt-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground font-mono">
                            {formatSchedule(job.schedule)}
                          </p>
                        </div>

                        <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">
                          {formatPayload(job.payload)}
                        </p>

                        <div className="flex items-center gap-4 mt-1.5">
                          {job.state.nextRunAtMs && (
                            <span className="text-[10px] text-muted-foreground">
                              Next: {formatRelativeTime(job.state.nextRunAtMs)}
                            </span>
                          )}
                          {job.state.lastRunAtMs && (
                            <span className="text-[10px] text-muted-foreground">
                              Last: {formatTime(job.state.lastRunAtMs)}
                              {job.state.lastDurationMs != null && ` (${Math.round(job.state.lastDurationMs / 1000)}s)`}
                            </span>
                          )}
                          {job.state.lastError && (
                            <span className="text-[10px] text-destructive truncate max-w-48" title={job.state.lastError}>
                              {job.state.lastError}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {hasOutputDir && (
                          <button
                            type="button"
                            className={`ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-primary/10 ${isExpanded ? 'text-primary' : 'text-muted-foreground hover:!text-primary'}`}
                            onClick={() => toggleReports(job)}
                            title="View Reports"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                          onClick={() => openEditForm(job)}
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                          onClick={() => handleToggle(job.id)}
                          title={job.enabled ? 'Disable' : 'Enable'}
                        >
                          {job.enabled ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5 text-green-600" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-destructive/10 text-muted-foreground hover:!text-destructive"
                          onClick={() => handleRemove(job.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Reports Section */}
                    {isExpanded && hasOutputDir && (
                      <div className="border-t border-border px-4 pb-3 pt-2">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                          <p className="text-xs font-semibold text-muted-foreground">Output Files</p>
                        </div>

                        {loadingReports ? (
                          <div className="text-xs text-muted-foreground py-2">Loading...</div>
                        ) : reportFiles.length === 0 ? (
                          <div className="text-xs text-muted-foreground py-2">No output files yet. Reports will appear here after the job runs.</div>
                        ) : (
                          <div className="space-y-1">
                            {reportFiles.map(file => (
                              <button
                                key={file.name}
                                type="button"
                                className="flex items-center justify-between w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 transition group/file"
                                onClick={() => openReport(job.outputDir!, file.name)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                                  <span className="text-xs font-medium truncate">{file.name}</span>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatFileSize(file.size)}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatDate(file.modified)}
                                  </span>
                                  <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover/file:opacity-100" />
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

          {/* Refresh */}
          <div className="flex justify-center">
            <button
              onClick={fetchJobs}
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
