import { NextResponse } from "next/server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStore, saveStore } from "../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }
    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const warnings: string[] = [];
    for (const tile of project.tiles) {
      if (!tile.agentId?.trim()) {
        warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
        continue;
      }
      deleteAgentArtifacts(tile.agentId, warnings);
    }

    const projects = store.projects.filter((project) => project.id !== trimmedProjectId);
    const activeProjectId =
      store.activeProjectId === trimmedProjectId
        ? projects[0]?.id ?? null
        : store.activeProjectId;
    const nextStore = {
      version: 2 as const,
      activeProjectId,
      projects,
    };
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete project.";
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

const deleteDirIfExists = (targetPath: string, label: string, warnings: string[]) => {
  if (!fs.existsSync(targetPath)) {
    warnings.push(`${label} not found at ${targetPath}.`);
    return;
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${targetPath}`);
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
};

const deleteAgentArtifacts = (agentId: string, warnings: string[]) => {
  const workspaceDir = path.join(os.homedir(), `clawd-${agentId}`);
  deleteDirIfExists(workspaceDir, "Agent workspace", warnings);

  const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
  const stateDir = resolveHomePath(stateDirRaw);
  const agentDir = path.join(stateDir, "agents", agentId);
  deleteDirIfExists(agentDir, "Agent state", warnings);
};
