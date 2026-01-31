import { NextResponse } from "next/server";

import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { logger } from "@/lib/logger";
import type {
  ProjectCleanupPreviewResult,
  ProjectCleanupRequest,
  ProjectCleanupResult,
} from "@/lib/projects/types";
import { loadStore, removeTilesFromStore, saveStore } from "@/app/api/projects/store";
import { selectArchivedTilesForCleanup } from "@/lib/projects/cleanup";
import { deleteDirIfExists, resolveAgentStateDir } from "@/lib/projects/fs.server";
import { isWorktreeDirty } from "@/lib/projects/worktrees.server";
import { removeAgentEntry, updateClawdbotConfig } from "@/lib/clawdbot/config";

export const runtime = "nodejs";

const runGit = (cwd: string, args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr ? `git ${args.join(" ")} failed in ${cwd}: ${stderr}` : "git command failed."
    );
  }
  return result.stdout?.trim() ?? "";
};

const removeWorktree = (repoPath: string, worktreeDir: string, force: boolean) => {
  if (!fs.existsSync(worktreeDir)) {
    return { removed: false, warning: `Agent workspace not found at ${worktreeDir}.` };
  }
  const stat = fs.statSync(worktreeDir);
  if (!stat.isDirectory()) {
    throw new Error(`Agent workspace path is not a directory: ${worktreeDir}`);
  }
  const args = force ? ["worktree", "remove", "-f", worktreeDir] : ["worktree", "remove", worktreeDir];
  runGit(repoPath, args);
  return { removed: true, warning: null };
};

export async function GET() {
  try {
    const store = loadStore();
    const { candidates } = selectArchivedTilesForCleanup(store);
    const items = candidates.map(({ project, tile }) => {
      if (!tile.archivedAt) {
        throw new Error(`Archived tile is missing archivedAt: ${tile.id}`);
      }
      const workspaceExists = fs.existsSync(tile.workspacePath);
      const agentStatePath = resolveAgentStateDir(tile.agentId);
      const agentStateExists = fs.existsSync(agentStatePath);
      const worktreeDirty = workspaceExists ? isWorktreeDirty(tile.workspacePath) : false;
      return {
        projectId: project.id,
        projectName: project.name,
        tileId: tile.id,
        tileName: tile.name,
        agentId: tile.agentId,
        workspacePath: tile.workspacePath,
        archivedAt: tile.archivedAt,
        workspaceExists,
        agentStateExists,
        worktreeDirty,
      };
    });
    const result: ProjectCleanupPreviewResult = { items };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to preview cleanup.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectCleanupRequest;
    const store = loadStore();
    if (body?.tileIds !== undefined && !Array.isArray(body.tileIds)) {
      return NextResponse.json(
        { error: "Tile ids must be an array of strings." },
        { status: 400 }
      );
    }
    const { candidates, errors } = selectArchivedTilesForCleanup(store, body?.tileIds);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    }
    if (candidates.length === 0) {
      const result: ProjectCleanupResult = { store, warnings: [] };
      return NextResponse.json(result);
    }

    const warnings: string[] = [];
    const removals: Array<{ projectId: string; tileId: string }> = [];
    const reposTouched = new Set<string>();
    const agentIds: string[] = [];
    const dirtyAgents: string[] = [];

    for (const { project, tile } of candidates) {
      const repoPath = project.repoPath;
      if (!repoPath.trim()) {
        throw new Error(`Workspace path is required for project ${project.name}.`);
      }
      if (!fs.existsSync(repoPath)) {
        throw new Error(`Workspace path does not exist: ${repoPath}`);
      }
      const repoStat = fs.statSync(repoPath);
      if (!repoStat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${repoPath}`);
      }

      reposTouched.add(repoPath);
      const workspaceExists = fs.existsSync(tile.workspacePath);
      const isDirty = workspaceExists ? isWorktreeDirty(tile.workspacePath) : false;
      if (isDirty) {
        dirtyAgents.push(tile.agentId);
      }
      const removal = removeWorktree(repoPath, tile.workspacePath, isDirty);
      if (removal.warning) warnings.push(removal.warning);

      deleteDirIfExists(
        resolveAgentStateDir(tile.agentId),
        "Agent state",
        warnings
      );

      removals.push({ projectId: project.id, tileId: tile.id });
      agentIds.push(tile.agentId);
    }

    if (dirtyAgents.length > 0) {
      warnings.push(
        `Archived agents removed with uncommitted changes: ${dirtyAgents.join(", ")}.`
      );
    }

    const { warnings: configWarnings } = updateClawdbotConfig((config) => {
      let changed = false;
      for (const agentId of agentIds) {
        if (removeAgentEntry(config, agentId)) {
          changed = true;
        }
      }
      return changed;
    });
    warnings.push(...configWarnings);

    const now = Date.now();
    const { store: nextStore } = removeTilesFromStore(store, removals, now);
    saveStore(nextStore);

    for (const repoPath of reposTouched) {
      try {
        runGit(repoPath, ["worktree", "prune"]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : `git worktree prune failed for ${repoPath}.`;
        warnings.push(message);
      }
    }

    const result: ProjectCleanupResult = { store: nextStore, warnings };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clean archived agents.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
