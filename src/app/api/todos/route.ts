import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import type { TodoItem, TodosData } from '@/types/todos';

const CAPTURES_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  'CAPTURES.md'
);

const HEADER = `# Captures — Quick Ideas from Telegram

Quick captures via OpenClaw from Telegram. Review regularly and promote promising items elsewhere when ready.

## Ideas\n`;

function formatItem(item: { text: string; project?: string; completed: boolean }): string {
  const check = item.completed ? 'x' : ' ';
  const projectTag = item.project ? ` _(from ${item.project})_` : '';
  return `- [${check}] ${item.text}${projectTag}`;
}

function readCaptures(): { items: TodoItem[]; rawLines: string[]; headerLines: string[] } {
  if (!existsSync(CAPTURES_PATH)) {
    return { items: [], rawLines: [], headerLines: HEADER.split('\n') };
  }

  const content = readFileSync(CAPTURES_PATH, 'utf-8').replace(/\r\n/g, '\n');
  const allLines = content.split('\n');

  const headerLines: string[] = [];
  const itemLines: string[] = [];
  let inItems = false;

  for (const line of allLines) {
    if (!inItems) {
      headerLines.push(line);
      // Start collecting items after "## Ideas" or similar heading
      if (line.match(/^##\s/)) {
        inItems = true;
      }
    } else {
      itemLines.push(line);
    }
  }

  const items: TodoItem[] = [];

  for (const line of itemLines) {
    const match = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (!match) continue;

    const completed = match[1] === 'x';
    let text = match[2].trim();
    let project: string | undefined;

    const projectMatch = text.match(/\s*_\(from\s+(.+?)\)_\s*$/);
    if (projectMatch) {
      project = projectMatch[1];
      text = text.replace(projectMatch[0], '').trim();
    }

    items.push({ text, project, completed, source: 'captures' });
  }

  return { items, rawLines: allLines, headerLines };
}

function writeCaptures(items: TodoItem[], headerLines: string[]) {
  const itemLines = items.map(formatItem);
  const content = headerLines.join('\n') + '\n' + itemLines.join('\n') + '\n';
  writeFileSync(CAPTURES_PATH, content, 'utf-8');
}

export async function GET() {
  try {
    const { items } = readCaptures();

    const lastUpdated = existsSync(CAPTURES_PATH)
      ? statSync(CAPTURES_PATH).mtime.toISOString()
      : new Date().toISOString();

    return Response.json(
      { items, lastUpdated } as TodosData,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error reading captures:', error);
    return Response.json(
      { error: 'Failed to read captures' },
      { status: 500 }
    );
  }
}

// POST: Add a new item
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, project } = body as { text: string; project?: string };

    if (!text || !text.trim()) {
      return Response.json({ error: 'Text is required' }, { status: 400 });
    }

    const { items, headerLines } = readCaptures();
    items.push({ text: text.trim(), project: project?.trim() || undefined, completed: false, source: 'captures' });
    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error adding capture:', error);
    return Response.json({ error: 'Failed to add item' }, { status: 500 });
  }
}

// PATCH: Update an item (toggle complete, edit text, edit project)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { index, completed, text, project } = body as {
      index: number;
      completed?: boolean;
      text?: string;
      project?: string | null;
    };

    if (typeof index !== 'number') {
      return Response.json({ error: 'Index is required' }, { status: 400 });
    }

    const { items, headerLines } = readCaptures();

    if (index < 0 || index >= items.length) {
      return Response.json({ error: 'Invalid index' }, { status: 400 });
    }

    if (typeof completed === 'boolean') items[index].completed = completed;
    if (typeof text === 'string') items[index].text = text.trim();
    if (project === null) items[index].project = undefined;
    else if (typeof project === 'string') items[index].project = project.trim() || undefined;

    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error updating capture:', error);
    return Response.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

// DELETE: Remove an item by index
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { index } = body as { index: number };

    if (typeof index !== 'number') {
      return Response.json({ error: 'Index is required' }, { status: 400 });
    }

    const { items, headerLines } = readCaptures();

    if (index < 0 || index >= items.length) {
      return Response.json({ error: 'Invalid index' }, { status: 400 });
    }

    items.splice(index, 1);
    writeCaptures(items, headerLines);

    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error deleting capture:', error);
    return Response.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
