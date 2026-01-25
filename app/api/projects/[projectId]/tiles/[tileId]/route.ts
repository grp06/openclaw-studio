import { NextResponse } from "next/server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProjectTileRenamePayload } from "../../../../../../src/lib/projects/types";
import { generateAgentId } from "../../../../../../src/lib/ids/agentId";
import { loadStore, saveStore } from "../../../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const trimmedProjectId = projectId.trim();
    const trimmedTileId = tileId.trim();
    if (!trimmedProjectId || !trimmedTileId) {
      return NextResponse.json(
        { error: "Project id and tile id are required." },
        { status: 400 }
      );
    }
    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const tile = project.tiles.find((entry) => entry.id === trimmedTileId);
    if (!tile) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }

    const nextTiles = project.tiles.filter((entry) => entry.id !== trimmedTileId);
    if (nextTiles.length === project.tiles.length) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }
    const nextStore = {
      ...store,
      version: 2 as const,
      projects: store.projects.map((entry) =>
        entry.id === trimmedProjectId
          ? { ...entry, tiles: nextTiles, updatedAt: Date.now() }
          : entry
      ),
    };
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const trimmedProjectId = projectId.trim();
    const trimmedTileId = tileId.trim();
    if (!trimmedProjectId || !trimmedTileId) {
      return NextResponse.json(
        { error: "Project id and tile id are required." },
        { status: 400 }
      );
    }
    const body = (await request.json()) as ProjectTileRenamePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Tile name is required." }, { status: 400 });
    }

    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const tile = project.tiles.find((entry) => entry.id === trimmedTileId);
    if (!tile) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }

    const projectSlug = path.basename(project.repoPath);
    let nextAgentId = "";
    try {
      nextAgentId = generateAgentId({ projectSlug, tileName: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid agent name.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const conflict = project.tiles.some(
      (entry) => entry.id !== trimmedTileId && entry.agentId === nextAgentId
    );
    if (conflict) {
      return NextResponse.json(
        { error: `Agent id already exists: ${nextAgentId}` },
        { status: 409 }
      );
    }

    const warnings: string[] = [];
    if (tile.agentId !== nextAgentId) {
      const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
      const stateDir = resolveHomePath(stateDirRaw);
      const workspaceSource = path.join(os.homedir(), `clawd-${tile.agentId}`);
      const workspaceTarget = path.join(os.homedir(), `clawd-${nextAgentId}`);
      const agentSource = path.join(stateDir, "agents", tile.agentId);
      const agentTarget = path.join(stateDir, "agents", nextAgentId);
      if (fs.existsSync(workspaceTarget)) {
        return NextResponse.json(
          { error: `Agent workspace already exists at ${workspaceTarget}` },
          { status: 409 }
        );
      }
      if (fs.existsSync(agentTarget)) {
        return NextResponse.json(
          { error: `Agent state already exists at ${agentTarget}` },
          { status: 409 }
        );
      }
      renameDirIfExists(workspaceSource, workspaceTarget, "Agent workspace", warnings);
      renameDirIfExists(
        agentSource,
        agentTarget,
        "Agent state",
        warnings,
        { warnIfMissing: false }
      );
    }

    const nextTiles = project.tiles.map((entry) =>
      entry.id === trimmedTileId
        ? {
            ...entry,
            name,
            agentId: nextAgentId,
            sessionKey: `agent:${nextAgentId}:main`,
          }
        : entry
    );
    const nextStore = {
      ...store,
      version: 2 as const,
      projects: store.projects.map((entry) =>
        entry.id === trimmedProjectId
          ? { ...entry, tiles: nextTiles, updatedAt: Date.now() }
          : entry
      ),
    };
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const resolveHomePath = (inputPath: string) => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

const renameDirIfExists = (
  source: string,
  destination: string,
  label: string,
  warnings: string[],
  options?: { warnIfMissing?: boolean }
) => {
  if (!fs.existsSync(source)) {
    if (options?.warnIfMissing !== false) {
      warnings.push(`${label} not found at ${source}.`);
    }
    return;
  }
  if (fs.existsSync(destination)) {
    throw new Error(`${label} already exists at ${destination}.`);
  }
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${source}`);
  }
  fs.renameSync(source, destination);
};
