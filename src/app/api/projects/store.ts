import fs from "node:fs";
import path from "node:path";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import { resolveAgentCanvasDir } from "@/lib/projects/agentWorkspace";
import { resolveAgentWorktreeDir } from "@/lib/projects/worktrees.server";
import { parseAgentIdFromSessionKey } from "@/lib/projects/sessionKey";

const STORE_VERSION: ProjectsStore["version"] = 3;
const STORE_DIR = resolveAgentCanvasDir();
const STORE_PATH = path.join(STORE_DIR, "projects.json");

export type ProjectsStorePayload = ProjectsStore;

export const ensureStoreDir = () => {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
};

export const defaultStore = (): ProjectsStore => ({
  version: STORE_VERSION,
  activeProjectId: null,
  projects: [],
});

export const normalizeProjectsStore = (store: ProjectsStore): ProjectsStore => {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const normalizedProjects = projects.map((project) => ({
    ...project,
    archivedAt: typeof project.archivedAt === "number" ? project.archivedAt : null,
    tiles: Array.isArray(project.tiles)
      ? project.tiles.map((tile) => ({
          ...tile,
          workspacePath:
            typeof tile.workspacePath === "string" && tile.workspacePath.trim()
              ? tile.workspacePath
              : resolveAgentWorktreeDir(project.id, tile.agentId),
          archivedAt: typeof tile.archivedAt === "number" ? tile.archivedAt : null,
        }))
      : [],
  }));
  const activeProjectId =
    typeof store.activeProjectId === "string" &&
    normalizedProjects.some(
      (project) => project.id === store.activeProjectId && !project.archivedAt
    )
      ? store.activeProjectId
      : normalizedProjects.find((project) => !project.archivedAt)?.id ?? null;
  return {
    version: STORE_VERSION,
    activeProjectId,
    projects: normalizedProjects,
  };
};

export const appendProjectToStore = (
  store: ProjectsStore,
  project: Project
): ProjectsStore =>
  normalizeProjectsStore({
    version: STORE_VERSION,
    activeProjectId: project.id,
    projects: [...store.projects, project],
  });

export const removeProjectFromStore = (
  store: ProjectsStore,
  projectId: string
): { store: ProjectsStore; removed: boolean } => {
  const projects = store.projects.filter((project) => project.id !== projectId);
  const removed = projects.length !== store.projects.length;
  return {
    store: normalizeProjectsStore({
      version: STORE_VERSION,
      activeProjectId: store.activeProjectId,
      projects,
    }),
    removed,
  };
};

export const updateProjectInStore = (
  store: ProjectsStore,
  projectId: string,
  patch: Partial<Project>,
  now: number = Date.now()
): { store: ProjectsStore; updated: boolean } => {
  let updated = false;
  const nextStore = {
    ...store,
    version: STORE_VERSION,
    projects: store.projects.map((project) => {
      if (project.id !== projectId) return project;
      updated = true;
      return { ...project, ...patch, updatedAt: now };
    }),
  };
  return { store: normalizeProjectsStore(nextStore), updated };
};

export const archiveProjectInStore = (
  store: ProjectsStore,
  projectId: string,
  now: number = Date.now()
): { store: ProjectsStore; updated: boolean } => {
  return updateProjectInStore(store, projectId, { archivedAt: now }, now);
};

export const restoreProjectInStore = (
  store: ProjectsStore,
  projectId: string,
  now: number = Date.now()
): { store: ProjectsStore; updated: boolean } => {
  return updateProjectInStore(store, projectId, { archivedAt: null }, now);
};

export const addTileToProject = (
  store: ProjectsStore,
  projectId: string,
  tile: ProjectTile,
  now: number = Date.now()
): ProjectsStore => ({
  ...store,
  version: STORE_VERSION,
  projects: store.projects.map((project) =>
    project.id === projectId
      ? { ...project, tiles: [...project.tiles, tile], updatedAt: now }
      : project
  ),
});

export const updateTileInProject = (
  store: ProjectsStore,
  projectId: string,
  tileId: string,
  patch: Partial<ProjectTile>,
  now: number = Date.now()
): ProjectsStore => ({
  ...store,
  version: STORE_VERSION,
  projects: store.projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          tiles: project.tiles.map((tile) =>
            tile.id === tileId ? { ...tile, ...patch } : tile
          ),
          updatedAt: now,
        }
      : project
  ),
});

export const removeTileFromProject = (
  store: ProjectsStore,
  projectId: string,
  tileId: string,
  now: number = Date.now()
): { store: ProjectsStore; removed: boolean } => {
  let removed = false;
  const nextStore = {
    ...store,
    version: STORE_VERSION,
    projects: store.projects.map((project) => {
      if (project.id !== projectId) return project;
      const nextTiles = project.tiles.filter((tile) => tile.id !== tileId);
      removed = removed || nextTiles.length !== project.tiles.length;
      return { ...project, tiles: nextTiles, updatedAt: now };
    }),
  };
  return { store: nextStore, removed };
};

export const removeTilesFromStore = (
  store: ProjectsStore,
  removals: Array<{ projectId: string; tileId: string }>,
  now: number = Date.now()
): { store: ProjectsStore; removed: boolean } => {
  const targetsByProject = new Map<string, Set<string>>();
  for (const entry of removals) {
    const projectId = entry.projectId.trim();
    const tileId = entry.tileId.trim();
    if (!projectId || !tileId) continue;
    const existing = targetsByProject.get(projectId);
    if (existing) {
      existing.add(tileId);
    } else {
      targetsByProject.set(projectId, new Set([tileId]));
    }
  }

  let removed = false;
  const nextStore = {
    ...store,
    version: STORE_VERSION,
    projects: store.projects.map((project) => {
      const targets = targetsByProject.get(project.id);
      if (!targets) return project;
      const nextTiles = project.tiles.filter((tile) => !targets.has(tile.id));
      if (nextTiles.length === project.tiles.length) {
        return project;
      }
      removed = true;
      return { ...project, tiles: nextTiles, updatedAt: now };
    }),
  };

  return { store: nextStore, removed };
};

export const archiveTileInProject = (
  store: ProjectsStore,
  projectId: string,
  tileId: string,
  now: number = Date.now()
): { store: ProjectsStore; updated: boolean } => {
  let updated = false;
  const nextStore = {
    ...store,
    version: STORE_VERSION,
    projects: store.projects.map((project) => {
      if (project.id !== projectId) return project;
      const nextTiles = project.tiles.map((tile) => {
        if (tile.id !== tileId) return tile;
        updated = true;
        return { ...tile, archivedAt: now };
      });
      return { ...project, tiles: nextTiles, updatedAt: now };
    }),
  };
  return { store: normalizeProjectsStore(nextStore), updated };
};

export const restoreTileInProject = (
  store: ProjectsStore,
  projectId: string,
  tileId: string,
  now: number = Date.now()
): { store: ProjectsStore; updated: boolean } => {
  let updated = false;
  const nextStore = {
    ...store,
    version: STORE_VERSION,
    projects: store.projects.map((project) => {
      if (project.id !== projectId) return project;
      const nextTiles = project.tiles.map((tile) => {
        if (tile.id !== tileId) return tile;
        updated = true;
        return { ...tile, archivedAt: null };
      });
      return { ...project, tiles: nextTiles, updatedAt: now };
    }),
  };
  return { store: normalizeProjectsStore(nextStore), updated };
};

type RawTile = {
  id: string;
  name: string;
  sessionKey: string;
  workspacePath?: string;
  archivedAt?: number | null;
  model?: string | null;
  thinkingLevel?: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  agentId?: string;
  role?: "coding" | "research" | "marketing";
};

type RawProject = Omit<Project, "tiles"> & { tiles: RawTile[]; archivedAt?: number | null };

type RawStore = {
  version?: number;
  activeProjectId?: string | null;
  projects?: RawProject[];
};

const migrateV1Store = (store: { activeProjectId?: string | null; projects: RawProject[] }) => {
  const projects = store.projects.map((project) => ({
    ...project,
    archivedAt: null,
    tiles: project.tiles.map((tile) => ({
      ...tile,
      agentId: parseAgentIdFromSessionKey(
        typeof tile.sessionKey === "string" ? tile.sessionKey : ""
      ),
      role: "coding" as const,
      workspacePath: resolveAgentWorktreeDir(
        project.id,
        parseAgentIdFromSessionKey(typeof tile.sessionKey === "string" ? tile.sessionKey : "")
      ),
      archivedAt: null,
    })),
  }));
  return {
    version: STORE_VERSION,
    activeProjectId: store.activeProjectId ?? null,
    projects,
  };
};

const migrateV2Store = (store: RawStore): ProjectsStore => {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  return normalizeProjectsStore({
    version: STORE_VERSION,
    activeProjectId: store.activeProjectId ?? null,
    projects: projects as Project[],
  });
};

export const loadStore = (): ProjectsStore => {
  ensureStoreDir();
  if (!fs.existsSync(STORE_PATH)) {
    const seed = defaultStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2), "utf8");
    return seed;
  }
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as RawStore;
    if (!parsed || !Array.isArray(parsed.projects)) {
      throw new Error(`Workspaces store is invalid at ${STORE_PATH}.`);
    }
    if (!parsed.projects.every((project) => Array.isArray(project.tiles))) {
      throw new Error(`Workspaces store is invalid at ${STORE_PATH}.`);
    }
    if (parsed.version === STORE_VERSION) {
      return normalizeProjectsStore(parsed as ProjectsStore);
    }
    if (parsed.version === 2) {
      const migrated = migrateV2Store(parsed);
      saveStore(migrated);
      return migrated;
    }
    const migrated = migrateV1Store({
      activeProjectId: parsed.activeProjectId ?? null,
      projects: parsed.projects,
    });
    saveStore(migrated);
    return migrated;
  } catch (err) {
    const details = err instanceof Error ? err.message : "Unknown error.";
    if (details.includes(STORE_PATH)) {
      throw new Error(details);
    }
    throw new Error(`Failed to parse workspaces store at ${STORE_PATH}: ${details}`);
  }
};

export const saveStore = (store: ProjectsStore) => {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
};
