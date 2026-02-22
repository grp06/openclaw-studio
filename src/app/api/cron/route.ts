import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

const CRON_JOBS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw',
  'cron',
  'jobs.json'
);

type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; [key: string]: unknown };

type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
};

type CronDelivery = {
  mode: 'none' | 'announce';
  channel?: string;
  to?: string;
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
  delivery?: CronDelivery;
};

type CronJobsFile = {
  version: number;
  jobs: CronJob[];
};

function readJobs(): CronJobsFile {
  if (!existsSync(CRON_JOBS_PATH)) {
    return { version: 1, jobs: [] };
  }
  try {
    return JSON.parse(readFileSync(CRON_JOBS_PATH, 'utf-8'));
  } catch {
    return { version: 1, jobs: [] };
  }
}

function writeJobs(data: CronJobsFile) {
  writeFileSync(CRON_JOBS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// GET: List all cron jobs
export async function GET() {
  try {
    const data = readJobs();
    return Response.json(
      { jobs: data.jobs, lastUpdated: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading cron jobs:', error);
    return Response.json({ error: 'Failed to read cron jobs' }, { status: 500 });
  }
}

// POST: Mutate cron jobs (add, remove, toggle, update)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    const data = readJobs();

    switch (action) {
      case 'add': {
        const { name, schedule, payload, sessionTarget, wakeMode, agentId, delivery } = body;
        if (!name || !schedule || !payload) {
          return Response.json({ error: 'name, schedule, and payload are required' }, { status: 400 });
        }

        const newJob: CronJob = {
          id: crypto.randomUUID(),
          name,
          agentId: agentId || undefined,
          enabled: true,
          updatedAtMs: Date.now(),
          schedule,
          sessionTarget: sessionTarget || 'isolated',
          wakeMode: wakeMode || 'now',
          payload,
          state: {},
          delivery: delivery || undefined,
        };

        data.jobs.push(newJob);
        writeJobs(data);
        return Response.json({ ok: true, job: newJob, jobs: data.jobs });
      }

      case 'remove': {
        const { id } = body;
        if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

        const idx = data.jobs.findIndex(j => j.id === id);
        if (idx === -1) return Response.json({ error: 'Job not found' }, { status: 404 });

        data.jobs.splice(idx, 1);
        writeJobs(data);
        return Response.json({ ok: true, jobs: data.jobs });
      }

      case 'toggle': {
        const { id } = body;
        if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

        const job = data.jobs.find(j => j.id === id);
        if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

        job.enabled = !job.enabled;
        job.updatedAtMs = Date.now();
        writeJobs(data);
        return Response.json({ ok: true, job, jobs: data.jobs });
      }

      case 'update': {
        const { id, name, schedule, payload, enabled, delivery } = body;
        if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

        const job = data.jobs.find(j => j.id === id);
        if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

        if (name !== undefined) job.name = name;
        if (schedule !== undefined) job.schedule = schedule;
        if (payload !== undefined) job.payload = payload;
        if (typeof enabled === 'boolean') job.enabled = enabled;
        if (delivery !== undefined) job.delivery = delivery;
        job.updatedAtMs = Date.now();
        writeJobs(data);
        return Response.json({ ok: true, job, jobs: data.jobs });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Error mutating cron jobs:', error);
    return Response.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
