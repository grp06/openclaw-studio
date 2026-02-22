import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import type { Session, SessionsData } from '@/types/sessions';

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

function parseTimestamp(ts: string): number {
  // Timestamps like "2026-02-22 16:47:01" — parse as local time
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
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
      const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT)\s+(\S+)\s*(.*)/);
      if (!match) continue;

      const [, timestamp, action, projectName, details] = match;

      if (action === 'START') {
        // Close any previous open session for this project (it was orphaned)
        if (openByProject[projectName] !== undefined) {
          const prev = allSessions[openByProject[projectName]];
          if (prev.status === 'active' || prev.status === 'paused') {
            prev.status = 'exited';
            prev.endTime = timestamp;
            if (!prev.details) prev.details = 'superseded by new session';
          }
        }
        const idx = allSessions.length;
        allSessions.push({
          project: projectName,
          status: 'active',
          startTime: timestamp,
          details: details || '',
        });
        openByProject[projectName] = idx;
        continue;
      }

      // PAUSED, RESUMED, DONE, EXIT — apply to the open session for this project
      const openIdx = openByProject[projectName];
      if (openIdx === undefined) continue; // no open session to apply to
      const session = allSessions[openIdx];

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
          delete openByProject[projectName];
          break;
        case 'EXIT':
          session.status = 'exited';
          session.endTime = timestamp;
          session.details = details || 'interrupted';
          delete openByProject[projectName];
          break;
      }
    }

    // Mark stale: any active/paused session older than 4 hours → "stale"
    const now = Date.now();
    for (const session of allSessions) {
      if (session.status === 'active' || session.status === 'paused') {
        const startMs = parseTimestamp(session.startTime);
        if (startMs > 0 && now - startMs > STALE_THRESHOLD_MS) {
          session.status = 'stale';
          session.details = session.details
            ? `${session.details} (no update in 4+ hours)`
            : 'No update in 4+ hours';
        }
      }
    }

    const active = allSessions.filter((s) => s.status === 'active');
    const paused = allSessions.filter((s) => s.status === 'paused');
    const completed = allSessions.filter((s) => s.status === 'completed');
    const exited = allSessions.filter((s) => s.status === 'exited');
    const stale = allSessions.filter((s) => s.status === 'stale');

    const sortByTime = (a: Session, b: Session) => {
      const timeA = parseTimestamp(a.endTime || a.startTime);
      const timeB = parseTimestamp(b.endTime || b.startTime);
      return timeB - timeA;
    };

    active.sort(sortByTime);
    paused.sort(sortByTime);
    completed.sort(sortByTime);
    exited.sort(sortByTime);
    stale.sort(sortByTime);

    return Response.json(
      { active, paused, completed, exited, stale, lastUpdated: new Date().toISOString() } as SessionsData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading sessions:', error);
    return Response.json({ error: 'Failed to read sessions' }, { status: 500 });
  }
}
