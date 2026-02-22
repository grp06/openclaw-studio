import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import type { Session, SessionsData } from '@/types/sessions';

export async function GET() {
  try {
    const logPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.openclaw',
      'workspace',
      'sessions.log'
    );

    // Return empty if log doesn't exist
    if (!existsSync(logPath)) {
      return Response.json(
        {
          active: [],
          paused: [],
          completed: [],
          exited: [],
          lastUpdated: new Date().toISOString(),
        } as SessionsData,
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const logContent = readFileSync(logPath, 'utf-8').replace(/\r\n/g, '\n');
    const lines = logContent.trim().split('\n').filter((l) => l);

    // Track sessions
    const sessions: Record<string, Session> = {};

    for (const line of lines) {
      // Parse format: [TIMESTAMP] ACTION project_name [details]
      const match = line.match(/\[([^\]]+)\]\s+(START|PAUSED|RESUMED|DONE|EXIT)\s+(\S+)\s*(.*)/);
      if (!match) continue;

      const [, timestamp, action, projectName, details] = match;

      if (!sessions[projectName]) {
        sessions[projectName] = {
          project: projectName,
          status: 'active',
          startTime: timestamp,
          details: '',
        };
      }

      switch (action) {
        case 'START':
          sessions[projectName].status = 'active';
          sessions[projectName].startTime = timestamp;
          sessions[projectName].details = details || '';
          break;
        case 'PAUSED':
          sessions[projectName].status = 'paused';
          sessions[projectName].details = details || 'waiting for input';
          break;
        case 'RESUMED':
          sessions[projectName].status = 'active';
          sessions[projectName].details = details || '';
          break;
        case 'EXIT':
          sessions[projectName].status = 'exited';
          sessions[projectName].endTime = timestamp;
          sessions[projectName].details = details || 'interrupted';
          break;
        case 'DONE':
          sessions[projectName].status = 'completed';
          sessions[projectName].endTime = timestamp;
          sessions[projectName].details = details || '';
          break;
      }
    }

    // Separate by status
    const active = Object.values(sessions).filter((s) => s.status === 'active');
    const paused = Object.values(sessions).filter((s) => s.status === 'paused');
    const completed = Object.values(sessions).filter(
      (s) => s.status === 'completed'
    );
    const exited = Object.values(sessions).filter((s) => s.status === 'exited');

    // Sort by timestamp (newest first)
    const sortByTime = (a: Session, b: Session) => {
      const timeA = new Date(a.endTime || a.startTime).getTime();
      const timeB = new Date(b.endTime || b.startTime).getTime();
      return timeB - timeA;
    };

    active.sort(sortByTime);
    completed.sort(sortByTime);

    return Response.json(
      {
        active,
        paused,
        completed,
        exited,
        lastUpdated: new Date().toISOString(),
      } as SessionsData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading sessions:', error);
    return Response.json(
      { error: 'Failed to read sessions' },
      { status: 500 }
    );
  }
}
