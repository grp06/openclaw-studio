import { NextResponse } from "next/server";

import fs from "node:fs";

import { logger } from "@/lib/logger";
import { resolveAgentWorkspaceDir } from "@/lib/projects/agentWorkspace";
import {
  readWorkspaceFiles,
  writeWorkspaceFiles,
} from "@/lib/projects/workspaceFiles.server";
import { resolveProjectTileFromParams } from "@/app/api/projects/resolveResponse";
import type { ProjectTileWorkspaceFilesUpdatePayload } from "@/lib/projects/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const resolved = await resolveProjectTileFromParams(context.params);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { projectId: resolvedProjectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(resolvedProjectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }
    const files = readWorkspaceFiles(workspaceDir);
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
    const resolved = await resolveProjectTileFromParams(context.params);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { projectId: resolvedProjectId, tile } = resolved;
    const workspaceDir = resolveAgentWorkspaceDir(resolvedProjectId, tile.agentId);
    if (!fs.existsSync(workspaceDir)) {
      return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });
    }

    const body = (await request.json()) as ProjectTileWorkspaceFilesUpdatePayload;
    if (!body || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "Files payload is invalid." }, { status: 400 });
    }

    const result = writeWorkspaceFiles(workspaceDir, body.files);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ files: result.files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save workspace files.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
