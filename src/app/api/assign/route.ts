import { readFileSync, existsSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';

const ASSIGNMENTS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw',
  'workspace',
  'assignments.json'
);

const ASSIGN_SCRIPT = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw',
  'workspace',
  'assign-todo.js'
);

type Assignment = {
  id: string;
  todoIndex: number;
  todoText: string;
  project: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

type AssignmentsData = {
  assignments: Assignment[];
};

function readAssignments(): AssignmentsData {
  try {
    if (!existsSync(ASSIGNMENTS_PATH)) {
      return { assignments: [] };
    }
    return JSON.parse(readFileSync(ASSIGNMENTS_PATH, 'utf-8'));
  } catch {
    return { assignments: [] };
  }
}

// GET: Return current assignments
export async function GET() {
  try {
    const data = readAssignments();
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error reading assignments:', error);
    return Response.json({ error: 'Failed to read assignments' }, { status: 500 });
  }
}

// POST: Trigger an assignment
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { todoIndex, dryRun } = body as { todoIndex: number; dryRun?: boolean };

    if (typeof todoIndex !== 'number' || todoIndex < 1) {
      return Response.json({ error: 'Valid todoIndex (>= 1) is required' }, { status: 400 });
    }

    // Check if already assigned
    const data = readAssignments();
    const existing = data.assignments.find(
      a => a.todoIndex === todoIndex && a.status === 'in_progress'
    );
    if (existing) {
      return Response.json(
        { error: `TODO #${todoIndex} is already assigned`, assignment: existing },
        { status: 409 }
      );
    }

    // Spawn the assign script (non-blocking for actual assignment, blocking for dry-run)
    const args = [ASSIGN_SCRIPT, String(todoIndex)];
    if (dryRun) args.push('--dry-run');

    return new Promise<Response>((resolve) => {
      if (dryRun) {
        // For dry run, wait for output
        execFile(process.execPath, args, { timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            resolve(Response.json(
              { ok: false, error: stderr?.trim() || error.message, output: stdout?.trim() },
              { status: 400 }
            ));
          } else {
            resolve(Response.json({ ok: true, output: stdout?.trim() }));
          }
        });
      } else {
        // For actual assignment, spawn detached and return immediately
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, args, {
          stdio: 'ignore',
          detached: true,
        });
        child.unref();

        // Re-read assignments after a brief delay to get the new entry
        setTimeout(() => {
          const updated = readAssignments();
          resolve(Response.json({
            ok: true,
            message: `TODO #${todoIndex} assignment started`,
            assignments: updated.assignments,
          }));
        }, 500);
      }
    });
  } catch (error) {
    console.error('Error triggering assignment:', error);
    return Response.json({ error: 'Failed to trigger assignment' }, { status: 500 });
  }
}
