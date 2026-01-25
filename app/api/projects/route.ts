import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  Project,
  ProjectCreatePayload,
  ProjectCreateResult,
  ProjectsStore,
} from "../../../src/lib/projects/types";
import { ensureGitRepo } from "../../../src/lib/fs/git";
import { slugifyProjectName } from "../../../src/lib/ids/slugify";
import { loadStore, saveStore } from "./store";

export const runtime = "nodejs";

const normalizeProjectsStore = (store: ProjectsStore): ProjectsStore => {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const activeProjectId =
    typeof store.activeProjectId === "string" &&
    projects.some((project) => project.id === store.activeProjectId)
      ? store.activeProjectId
      : projects[0]?.id ?? null;
  return {
    version: 2,
    activeProjectId,
    projects,
  };
};

export async function GET() {
  try {
    const store = normalizeProjectsStore(loadStore());
    return NextResponse.json(store);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load projects.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectCreatePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    let slug = "";
    try {
      slug = slugifyProjectName(name);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Project name produced an empty folder name.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const store = loadStore();
    const { repoPath, warnings: pathWarnings } = resolveProjectPath(slug);
    const gitResult = ensureGitRepo(repoPath);
    const warnings = [...pathWarnings, ...gitResult.warnings];

    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name,
      repoPath,
      createdAt: now,
      updatedAt: now,
      tiles: [],
    };

    const nextStore = normalizeProjectsStore({
      version: 2,
      activeProjectId: project.id,
      projects: [...store.projects, project],
    });

    saveStore(nextStore);

    if (warnings.length > 0) {
      console.warn(`Project created with warnings: ${warnings.join(" ")}`);
    }

    const result: ProjectCreateResult = {
      store: nextStore,
      warnings,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create project.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as ProjectsStore;
    if (!body || !Array.isArray(body.projects)) {
      return NextResponse.json({ error: "Invalid projects payload." }, { status: 400 });
    }
    const normalized = normalizeProjectsStore(body);
    saveStore(normalized);
    return NextResponse.json(normalized);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save projects.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const resolveProjectPath = (slug: string): { repoPath: string; warnings: string[] } => {
  const warnings: string[] = [];
  const basePath = path.join(os.homedir(), slug);
  if (!fs.existsSync(basePath)) {
    return { repoPath: basePath, warnings };
  }
  let suffix = 2;
  let candidate = basePath;
  while (fs.existsSync(candidate)) {
    candidate = path.join(os.homedir(), `${slug}-${suffix}`);
    suffix += 1;
  }
  warnings.push(`Project folder already exists. Created ${candidate} instead.`);
  return { repoPath: candidate, warnings };
};
