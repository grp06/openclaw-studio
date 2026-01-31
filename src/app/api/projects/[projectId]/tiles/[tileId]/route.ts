import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import type { ProjectTileUpdatePayload } from "@/lib/projects/types";
import { resolveAgentWorktreeDir } from "@/lib/projects/worktrees.server";
import { resolveProjectTileFromParams } from "@/lib/projects/resolve.server";
import {
  removeAgentEntry,
  rewriteBindingsForRemovedAgent,
  updateClawdbotConfig,
  upsertAgentEntry,
} from "@/lib/clawdbot/config";
import {
  archiveTileInProject,
  saveStore,
  updateTileInProject,
} from "../../../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const resolved = await resolveProjectTileFromParams(context.params);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { store, projectId: resolvedProjectId, tileId: resolvedTileId, tile } = resolved;

    const { store: nextStore, updated } = archiveTileInProject(
      store,
      resolvedProjectId,
      resolvedTileId
    );
    if (!updated) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }
    saveStore(nextStore);

    const warnings: string[] = [];
    const { warnings: configWarnings } = updateClawdbotConfig((config) => {
      const removed = removeAgentEntry(config, tile.agentId);
      const rewritten = rewriteBindingsForRemovedAgent(config, tile.agentId, "main");
      return removed || rewritten;
    });
    warnings.push(...configWarnings);

    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to archive tile.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const body = (await request.json()) as ProjectTileUpdatePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const avatarSeed =
      typeof body?.avatarSeed === "string" ? body.avatarSeed.trim() : "";
    const archivedAt =
      body?.archivedAt === null
        ? null
        : typeof body?.archivedAt === "number"
          ? body.archivedAt
          : undefined;
    if (!name && !avatarSeed && archivedAt === undefined) {
      return NextResponse.json(
        { error: "Tile update requires a name, avatar seed, or archivedAt." },
        { status: 400 }
      );
    }
    if (body?.avatarSeed !== undefined && !avatarSeed) {
      return NextResponse.json({ error: "Avatar seed is invalid." }, { status: 400 });
    }
    if (body?.archivedAt !== undefined && archivedAt === undefined) {
      return NextResponse.json({ error: "ArchivedAt is invalid." }, { status: 400 });
    }

    const resolved = await resolveProjectTileFromParams(context.params);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { store, projectId: resolvedProjectId, tileId: resolvedTileId, tile } = resolved;

    const warnings: string[] = [];
    if (name) {
      const nextWorkspaceDir = resolveAgentWorktreeDir(
        resolvedProjectId,
        tile.agentId
      );
      const { warnings: configWarnings } = updateClawdbotConfig((config) =>
        upsertAgentEntry(config, {
          agentId: tile.agentId,
          agentName: name,
          workspaceDir: nextWorkspaceDir,
        })
      );
      warnings.push(...configWarnings);
    }

    const now = Date.now();
    const patch = {
      ...(name ? { name } : {}),
      ...(avatarSeed ? { avatarSeed } : {}),
      ...(archivedAt !== undefined
        ? { archivedAt: archivedAt === null ? null : now }
        : {}),
    };
    const nextStore = updateTileInProject(
      store,
      resolvedProjectId,
      resolvedTileId,
      patch,
      now
    );
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename tile.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
