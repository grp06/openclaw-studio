import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { Session, InterruptReason } from '@/types/sessions';

interface SessionStats {
  totalSessions: number;
  byStatus: {
    active: number;
    paused: number;
    completed: number;
    exited: number;
    dismissed: number;
  };
  byProject: Record<string, {
    total: number;
    completed: number;
    interrupted: number;
    avgDurationMs?: number;
  }>;
  interruptionReasons: Record<InterruptReason, number>;
  avgDurationMs?: number;
  totalDurationMs: number;
}

function parseTimestamp(ts: string): number {
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function calculateDuration(startTime: string, endTime?: string): number | undefined {
  if (!endTime) return undefined;
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return start && end ? end - start : undefined;
}

function inferInterruptReason(details?: string): InterruptReason {
  if (!details) return 'unknown';
  const lowerDetails = details.toLowerCase();
  if (lowerDetails.includes('superseded')) return 'superseded';
  if (lowerDetails.includes('timeout') || lowerDetails.includes('no activity')) return 'timeout';
  if (lowerDetails.includes('crash')) return 'crash';
  if (lowerDetails.includes('dismissed')) return 'dismissed';
  if (details !== 'interrupted') return 'manual';
  return 'unknown';
}

export async function GET() {
  try {
    const logPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.openclaw',
      'workspace',
      'sessions.log'
    );

    if (!existsSync(logPath)) {
      return Response.json({
        totalSessions: 0,
        byStatus: { active: 0, paused: 0, completed: 0, exited: 0, dismissed: 0 },
        byProject: {},
        interruptionReasons: {
          manual: 0,
          crash: 0,
          superseded: 0,
          timeout: 0,
          dismissed: 0,
          unknown: 0,
        },
        totalDurationMs: 0,
      } as SessionStats);
    }

    const logContent = readFileSync(logPath, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);

    const allSessions: Session[] = [];
    const openByProject: Record<string, number> = {};

    // Parse log file (same logic as main route)
    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT|DISMISSED)\s+(\S+)\s*(.*)/);
      if (!match) continue;

      const [, timestamp, action, projectName, details] = match;

      if (action === 'START') {
        if (openByProject[projectName] !== undefined) {
          const prev = allSessions[openByProject[projectName]];
          if (prev.status === 'active' || prev.status === 'paused') {
            prev.status = 'exited';
            prev.endTime = timestamp;
            prev.details = 'superseded by new session';
            prev.interruptReason = 'superseded';
            prev.durationMs = calculateDuration(prev.startTime, prev.endTime);
          }
        }
        const idx = allSessions.length;
        allSessions.push({
          project: projectName,
          status: 'active',
          startTime: timestamp,
          lastActivityTime: timestamp,
          details: details || '',
        });
        openByProject[projectName] = idx;
        continue;
      }

      const openIdx = openByProject[projectName];
      if (openIdx === undefined) continue;
      const session = allSessions[openIdx];
      session.lastActivityTime = timestamp;

      switch (action) {
        case 'PAUSED':
          session.status = 'paused';
          session.details = details || 'waiting for input';
          break;
        case 'RESUMED':
          session.status = 'active';
          if (details) session.details = details;
          break;
        case 'DONE':
          session.status = 'completed';
          session.endTime = timestamp;
          session.details = details || '';
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          delete openByProject[projectName];
          break;
        case 'EXIT':
          session.status = 'exited';
          session.endTime = timestamp;
          session.details = details || 'interrupted';
          session.interruptReason = inferInterruptReason(session.details);
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          delete openByProject[projectName];
          break;
        case 'DISMISSED':
          session.status = 'dismissed';
          session.dismissedAt = timestamp;
          session.details = details || session.details;
          session.interruptReason = 'dismissed';
          delete openByProject[projectName];
          break;
      }
    }

    // Calculate statistics
    const stats: SessionStats = {
      totalSessions: allSessions.length,
      byStatus: {
        active: 0,
        paused: 0,
        completed: 0,
        exited: 0,
        dismissed: 0,
      },
      byProject: {},
      interruptionReasons: {
        manual: 0,
        crash: 0,
        superseded: 0,
        timeout: 0,
        dismissed: 0,
        unknown: 0,
      },
      totalDurationMs: 0,
    };

    const durations: number[] = [];

    for (const session of allSessions) {
      // Count by status
      stats.byStatus[session.status]++;

      // Count by project
      if (!stats.byProject[session.project]) {
        stats.byProject[session.project] = {
          total: 0,
          completed: 0,
          interrupted: 0,
        };
      }
      stats.byProject[session.project].total++;

      if (session.status === 'completed') {
        stats.byProject[session.project].completed++;
      } else if (session.status === 'exited') {
        stats.byProject[session.project].interrupted++;
      }

      // Track durations
      if (session.durationMs) {
        durations.push(session.durationMs);
        stats.totalDurationMs += session.durationMs;

        if (!stats.byProject[session.project].avgDurationMs) {
          stats.byProject[session.project].avgDurationMs = 0;
        }
      }

      // Count interruption reasons
      if (session.interruptReason) {
        stats.interruptionReasons[session.interruptReason]++;
      }
    }

    // Calculate average duration
    if (durations.length > 0) {
      stats.avgDurationMs = stats.totalDurationMs / durations.length;
    }

    // Calculate per-project average durations
    for (const project in stats.byProject) {
      const projectSessions = allSessions.filter((s) => s.project === project && s.durationMs);
      if (projectSessions.length > 0) {
        const totalMs = projectSessions.reduce((sum, s) => sum + (s.durationMs || 0), 0);
        stats.byProject[project].avgDurationMs = totalMs / projectSessions.length;
      }
    }

    return Response.json(stats, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error calculating session stats:', error);
    return Response.json({ error: 'Failed to calculate stats' }, { status: 500 });
  }
}
