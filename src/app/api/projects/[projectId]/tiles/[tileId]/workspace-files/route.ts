import { NextResponse } from "next/server";

import fs from "node:fs";
import path from "node:path";

import { logger } from "@/lib/logger";
import { resolveAgentWorkspaceDir } from "@/lib/projects/agentWorkspace";
import { WORKSPACE_FILE_NAMES, type WorkspaceFileName } from "@/lib/projects/workspaceFiles";
import { isWorkspaceFileName, readWorkspaceFile } from "@/lib/projects/workspaceFiles.server";
import type { ProjectTileWorkspaceFilesUpdatePayload } from "@/lib/projects/types";
import { loadStore } from "../../../../store";

export const runtime = "nodejs";

const resolveTile = async (
  params: Promise<{ projectId: string; tileId: string }>
) => {
  const { projectId, tileId } = await params;
  const trimmedProjectId = projectId.trim();
  const trimmedTileId = tileId.trim();
  if (!trimmedProjectId || !trimmedTileId) {
    return {
      error: NextResponse.json(
        { error: "Workspace id and tile id are required." },
        { status: 400 }
      ),
    };
  }
  const store = loadStore();
  const project = store.projects.find((entry) => entry.id === trimmedProjectId);
  if (!project) {
    return { error: NextResponse.json({ error: "Workspace not found." }, { status: 404 }) };
  }
  const tile = project.tiles.find((entry) => entry.id === trimmedTileId);
  if (!tile) {
    return { error: NextResponse.json({ error: "Tile not found." }, { status: 404 }) };
  }
  return { projectId: trimmedProjectId, tileId: trimmedTileId, tile };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const resolved = await resolveTile(context.params);
    if ("error" in resolved) {
      return resolved.error;
    }
    const { projectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(projectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }
    const files = WORKSPACE_FILE_NAMES.map((name) =>
      readWorkspaceFile(workspaceDir, name)
    );
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load workspace files.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const resolved = await resolveTile(context.params);
    if ("error" in resolved) {
      return resolved.error;
    }
    const { projectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(projectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }

    const body = (await request.json()) as ProjectTileWorkspaceFilesUpdatePayload;
    if (!body || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "Files payload is invalid." }, { status: 400 });
    }

    for (const entry of body.files) {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!name || !isWorkspaceFileName(name)) {
        return NextResponse.json(
          { error: `Invalid file name: ${entry?.name ?? ""}` },
          { status: 400 }
        );
      }
      if (typeof entry.content !== "string") {
        return NextResponse.json({ error: `Invalid content for ${name}.` }, { status: 400 });
      }
    }

    for (const entry of body.files) {
      const name = entry.name as WorkspaceFileName;
      const filePath = path.join(workspaceDir, name);
      fs.writeFileSync(filePath, entry.content, "utf8");
    }

    const files = WORKSPACE_FILE_NAMES.map((name) =>
      readWorkspaceFile(workspaceDir, name)
    );
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save workspace files.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
