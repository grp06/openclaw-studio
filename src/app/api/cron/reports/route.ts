import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import path from 'path';

// Security: only allow reading from known safe base paths
const ALLOWED_BASES = [
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw', 'workspace'),
];

function isSafePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ALLOWED_BASES.some(base => resolved.startsWith(path.resolve(base)));
}

// GET /api/cron/reports?dir=<path>&file=<filename>
// Without file: list files in directory
// With file: return file content
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get('dir');
  const file = searchParams.get('file');

  if (!dir) {
    return Response.json({ error: 'dir parameter is required' }, { status: 400 });
  }

  if (!isSafePath(dir)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!existsSync(dir)) {
    return Response.json({ files: [], error: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Return file content
  if (file) {
    const filePath = path.join(dir, path.basename(file)); // basename prevents traversal
    if (!isSafePath(filePath) || !existsSync(filePath)) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const stat = statSync(filePath);
      return Response.json({
        name: path.basename(filePath),
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('Error reading file:', error);
      return Response.json({ error: 'Failed to read file' }, { status: 500 });
    }
  }

  // List files in directory
  try {
    const entries = readdirSync(dir)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const fp = path.join(dir, f);
        try {
          const stat = statSync(fp);
          return {
            name: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            isFile: stat.isFile(),
          };
        } catch {
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null && f.isFile)
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return Response.json({ files: entries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error listing directory:', error);
    return Response.json({ error: 'Failed to list files' }, { status: 500 });
  }
}
