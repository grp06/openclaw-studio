import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { Session } from '@/types/sessions';

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

function inferInterruptReason(details?: string): 'manual' | 'crash' | 'superseded' | 'timeout' | 'dismissed' | 'unknown' {
  if (!details) return 'unknown';
  const lowerDetails = details.toLowerCase();
  if (lowerDetails.includes('superseded')) return 'superseded';
  if (lowerDetails.includes('timeout') || lowerDetails.includes('no activity')) return 'timeout';
  if (lowerDetails.includes('crash')) return 'crash';
  if (lowerDetails.includes('dismissed')) return 'dismissed';
  if (details !== 'interrupted') return 'manual';
  return 'unknown';
}

function sessionsToCSV(sessions: Session[]): string {
  const headers = [
    'project',
    'status',
    'startTime',
    'endTime',
    'lastActivityTime',
    'durationMs',
    'interruptReason',
    'details',
    'dismissedAt',
  ];

  const rows = sessions.map((s) =>
    [
      s.project,
      s.status,
      s.startTime,
      s.endTime || '',
      s.lastActivityTime || '',
      s.durationMs || '',
      s.interruptReason || '',
      (s.details || '').replace(/"/g, '""'), // Escape quotes
      s.dismissedAt || '',
    ].map((v) => `"${v}"`)
  );

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json'; // json or csv
    const project = searchParams.get('project'); // optional project filter

    const logPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.openclaw',
      'workspace',
      'sessions.log'
    );

    if (!existsSync(logPath)) {
      return Response.json({ sessions: [] });
    }

    const logContent = readFileSync(logPath, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);

    const allSessions: Session[] = [];
    const openByProject: Record<string, number> = {};

    // Parse log (same as main route)
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

    // Filter by project if requested
    let filteredSessions = allSessions;
    if (project) {
      filteredSessions = allSessions.filter((s) => s.project === project);
    }

    // Return in requested format
    if (format === 'csv') {
      const csv = sessionsToCSV(filteredSessions);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="sessions-${project || 'all'}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return Response.json(
      { sessions: filteredSessions, count: filteredSessions.length },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error exporting sessions:', error);
    return Response.json({ error: 'Failed to export sessions' }, { status: 500 });
  }
}
