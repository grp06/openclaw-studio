import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ProjectTile,
  ProjectTileCreatePayload,
  ProjectTileCreateResult,
  ProjectTileRole,
  ProjectsStore,
} from "../../../../../src/lib/projects/types";
import { generateAgentId } from "../../../../../src/lib/ids/agentId";
import { loadStore, saveStore } from "../../store";

export const runtime = "nodejs";

const ROLE_VALUES: ProjectTileRole[] = ["coding", "research", "marketing"];

const resolveHomePath = (inputPath: string) => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

const ensureDir = (dir: string) => {
  if (fs.existsSync(dir)) {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} exists and is not a directory.`);
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
};

const buildBootstrapContent = (repoPath: string, role: ProjectTileRole) => {
  return [
    "# BOOTSTRAP.md",
    "",
    `Project repo: ${repoPath}`,
    `Role: ${role}`,
    "",
    "You are operating inside this project. Prefer working in ./repo (symlink) when it exists.",
    `If ./repo does not exist, operate directly in: ${repoPath}`,
    "",
    'First action: run "ls" in the repo to confirm access.',
    "",
  ].join("\n");
};

const ensureFile = (filePath: string, contents: string) => {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, contents, "utf8");
};

const provisionWorkspace = ({
  agentId,
  repoPath,
  role,
}: {
  agentId: string;
  repoPath: string;
  role: ProjectTileRole;
}): string[] => {
  const warnings: string[] = [];
  const workspaceDir = path.join(os.homedir(), `clawd-${agentId}`);
  ensureDir(workspaceDir);

  const repoLink = path.join(workspaceDir, "repo");
  if (!fs.existsSync(repoLink)) {
    try {
      fs.symlinkSync(repoPath, repoLink, "dir");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create repo symlink.";
      warnings.push(`Repo symlink not created: ${message}`);
    }
  }

  const bootstrapContent = buildBootstrapContent(repoPath, role);
  ensureFile(path.join(workspaceDir, "BOOTSTRAP.md"), bootstrapContent);
  ensureFile(path.join(workspaceDir, "AGENTS.md"), "");
  ensureFile(path.join(workspaceDir, "SOUL.md"), "");

  return warnings;
};

const copyAuthProfiles = (agentId: string): string[] => {
  const warnings: string[] = [];
  const stateDirRaw = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot";
  const stateDir = resolveHomePath(stateDirRaw);
  const sourceAgentId = process.env.CLAWDBOT_DEFAULT_AGENT_ID ?? "main";
  const source = path.join(stateDir, "agents", sourceAgentId, "agent", "auth-profiles.json");
  const destination = path.join(stateDir, "agents", agentId, "agent", "auth-profiles.json");

  if (fs.existsSync(destination)) {
    return warnings;
  }
  if (!fs.existsSync(source)) {
    warnings.push(`No auth profiles found at ${source}; agent may need login.`);
    return warnings;
  }
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return warnings;
};

const updateStoreProject = (
  store: ProjectsStore,
  projectId: string,
  tile: ProjectTile
) => {
  return {
    ...store,
    version: 2 as const,
    projects: store.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            tiles: [...project.tiles, tile],
            updatedAt: Date.now(),
          }
        : project
    ),
  };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }

    const body = (await request.json()) as ProjectTileCreatePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const role = body?.role;
    if (!name) {
      return NextResponse.json({ error: "Tile name is required." }, { status: 400 });
    }
    if (!role || !ROLE_VALUES.includes(role)) {
      return NextResponse.json({ error: "Tile role is invalid." }, { status: 400 });
    }

    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const tileId = randomUUID();
    const projectSlug = path.basename(project.repoPath);
    let agentId = "";
    try {
      agentId = generateAgentId({ projectSlug, tileName: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid agent name.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (project.tiles.some((entry) => entry.agentId === agentId)) {
      return NextResponse.json(
        { error: `Agent id already exists: ${agentId}` },
        { status: 409 }
      );
    }
    const sessionKey = `agent:${agentId}:main`;
    const offset = project.tiles.length * 36;
    const tile: ProjectTile = {
      id: tileId,
      name,
      agentId,
      role,
      sessionKey,
      model: null,
      thinkingLevel: null,
      position: { x: 80 + offset, y: 80 + offset },
      size: { width: 360, height: 280 },
    };

    const nextStore = updateStoreProject(store, trimmedProjectId, tile);
    saveStore(nextStore);

    const warnings = [
      ...provisionWorkspace({ agentId, repoPath: project.repoPath, role }),
      ...copyAuthProfiles(agentId),
    ];
    if (warnings.length > 0) {
      console.warn(`Tile created with warnings: ${warnings.join(" ")}`);
    }

    const result: ProjectTileCreateResult = {
      store: nextStore,
      tile,
      warnings,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tile.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
