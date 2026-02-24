import { readFileSync, appendFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import type { Session, SessionsData, InterruptReason } from '@/types/sessions';

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours
const HIDE_OLD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function parseTimestamp(ts: string): number {
  // Timestamps like "2026-02-22 16:47:01" — parse as local time
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

function formatDuration(durationMs: number): string {
  const hours = Math.floor(durationMs / (60 * 60 * 1000));
  const minutes = Math.floor((durationMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
      return Response.json(
        { active: [], paused: [], completed: [], exited: [], lastUpdated: new Date().toISOString() } as SessionsData,
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const logContent = readFileSync(logPath, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);

    // Track each START as a separate session instance.
    // PAUSED/RESUMED/DONE/EXIT apply to the most recent open session for that project.
    const allSessions: Session[] = [];
    // Map project -> index into allSessions for the latest open (active/paused) session
    const openByProject: Record<string, number> = {};

    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT|DISMISSED)\s+(\S+)\s*(.*)/);
      if (!match) continue;

      const [, timestamp, action, projectName, details] = match;

      if (action === 'START') {
        // Close any previous open session for this project (it was orphaned)
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

      // PAUSED, RESUMED, DONE, EXIT, DISMISSED — apply to the open session for this project
      const openIdx = openByProject[projectName];
      if (openIdx === undefined) continue; // no open session to apply to
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

    // Auto-convert stale: any active/paused session with no activity for 4+ hours → exited with timeout
    const now = Date.now();
    for (const session of allSessions) {
      if (session.status === 'active' || session.status === 'paused') {
        const lastMs = parseTimestamp(session.lastActivityTime || session.startTime);
        const inactiveMs = now - lastMs;

        if (lastMs > 0 && inactiveMs > STALE_THRESHOLD_MS) {
          session.status = 'exited';
          session.endTime = session.lastActivityTime || session.startTime;
          session.interruptReason = 'timeout';
          session.durationMs = calculateDuration(session.startTime, session.endTime);
          const prevDetails = session.details ? `${session.details} - ` : '';
          session.details = `${prevDetails}No activity for ${formatDuration(inactiveMs)}`;
        }
      }
    }

    // Hide interrupted/completed sessions older than 24 hours
    const cutoff = now - HIDE_OLD_THRESHOLD_MS;

    const active = allSessions.filter((s) => s.status === 'active');
    const paused = allSessions.filter((s) => s.status === 'paused');
    const completed = allSessions.filter((s) => s.status === 'completed' && parseTimestamp(s.endTime || s.startTime) > cutoff);
    const exited = allSessions.filter((s) => s.status === 'exited' && parseTimestamp(s.endTime || s.startTime) > cutoff);
    const dismissed = allSessions.filter((s) => s.status === 'dismissed' && parseTimestamp(s.dismissedAt || s.startTime) > cutoff);

    const sortByTime = (a: Session, b: Session) => {
      const timeA = parseTimestamp(a.endTime || a.dismissedAt || a.startTime);
      const timeB = parseTimestamp(b.endTime || b.dismissedAt || b.startTime);
      return timeB - timeA;
    };

    active.sort(sortByTime);
    paused.sort(sortByTime);
    completed.sort(sortByTime);
    exited.sort(sortByTime);
    dismissed.sort(sortByTime);

    return Response.json(
      { active, paused, completed, exited, dismissed, lastUpdated: new Date().toISOString() } as SessionsData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading sessions:', error);
    return Response.json({ error: 'Failed to read sessions' }, { status: 500 });
  }
}

function logSessionAction(action: string, project: string, details?: string) {
  const logPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.openclaw',
    'workspace',
    'sessions.log'
  );

  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
  const detailsStr = details ? ` ${details}` : '';
  const entry = `[${timestamp}] ${action} ${project}${detailsStr}\n`;

  appendFileSync(logPath, entry, 'utf-8');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, project, details } = body;

    if (!action || !project) {
      return Response.json(
        { error: 'Missing required fields: action, project' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'dismiss':
        logSessionAction('DISMISSED', project, details || 'User dismissed');
        break;

      case 'markDone':
        logSessionAction('DONE', project, details || 'Marked complete from UI');
        break;

      case 'addNote':
        if (!details) {
          return Response.json({ error: 'Note details required' }, { status: 400 });
        }
        logSessionAction('NOTE', project, details);
        break;

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error handling session action:', error);
    return Response.json({ error: 'Failed to process action' }, { status: 500 });
  }
}
