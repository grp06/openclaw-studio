import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Project, ProjectsStore } from "../../../src/lib/projects/types";

const STORE_VERSION: ProjectsStore["version"] = 2;
const STORE_DIR = path.join(os.homedir(), ".clawdbot", "agent-canvas");
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

const parseAgentId = (sessionKey: string): string => {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : "main";
};

type RawTile = {
  id: string;
  name: string;
  sessionKey: string;
  model?: string | null;
  thinkingLevel?: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  agentId?: string;
  role?: "coding" | "research" | "marketing";
};

type RawProject = Omit<Project, "tiles"> & { tiles: RawTile[] };

type RawStore = {
  version?: number;
  activeProjectId?: string | null;
  projects?: RawProject[];
};

const migrateV1Store = (store: { activeProjectId?: string | null; projects: RawProject[] }) => {
  const projects = store.projects.map((project) => ({
    ...project,
    tiles: project.tiles.map((tile) => ({
      ...tile,
      agentId: parseAgentId(typeof tile.sessionKey === "string" ? tile.sessionKey : ""),
      role: "coding" as const,
    })),
  }));
  return {
    version: STORE_VERSION,
    activeProjectId: store.activeProjectId ?? null,
    projects,
  };
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
      throw new Error(`Projects store is invalid at ${STORE_PATH}.`);
    }
    if (!parsed.projects.every((project) => Array.isArray(project.tiles))) {
      throw new Error(`Projects store is invalid at ${STORE_PATH}.`);
    }
    if (parsed.version === 2) {
      return parsed as ProjectsStore;
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
    throw new Error(`Failed to parse projects store at ${STORE_PATH}: ${details}`);
  }
};

export const saveStore = (store: ProjectsStore) => {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
};
