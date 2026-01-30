import { describe, expect, it } from "vitest";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import {
  addTileToProject,
  archiveProjectInStore,
  archiveTileInProject,
  appendProjectToStore,
  normalizeProjectsStore,
  removeProjectFromStore,
  removeTileFromProject,
  removeTilesFromStore,
  restoreProjectInStore,
  restoreTileInProject,
  updateTileInProject,
} from "@/app/api/projects/store";

const makeProject = (id: string): Project => ({
  id,
  name: `Project ${id}`,
  repoPath: `/tmp/${id}`,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  tiles: [],
});

const makeTile = (id: string): ProjectTile => ({
  id,
  name: `Tile ${id}`,
  agentId: `agent-${id}`,
  role: "coding",
  sessionKey: `agent:agent-${id}:main`,
  workspacePath: `/tmp/worktrees/${id}`,
  archivedAt: null,
  model: "openai-codex/gpt-5.2-codex",
  thinkingLevel: null,
  avatarSeed: `agent-${id}`,
  position: { x: 0, y: 0 },
  size: { width: 420, height: 520 },
});

describe("projectsStore", () => {
  it("normalizesEmptyProjects", () => {
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "missing",
      projects: [],
    };
    const normalized = normalizeProjectsStore(store);
    expect(normalized.version).toBe(3);
    expect(normalized.activeProjectId).toBeNull();
    expect(normalized.projects).toEqual([]);
  });

  it("fallsBackToFirstProject", () => {
    const projectA = makeProject("a");
    const projectB = makeProject("b");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "missing",
      projects: [projectA, projectB],
    };
    const normalized = normalizeProjectsStore(store);
    expect(normalized.activeProjectId).toBe("a");
  });

  it("preservesActiveProject", () => {
    const projectA = makeProject("a");
    const projectB = makeProject("b");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "b",
      projects: [projectA, projectB],
    };
    const normalized = normalizeProjectsStore(store);
    expect(normalized.activeProjectId).toBe("b");
  });

  it("drops archived active project", () => {
    const projectA = makeProject("a");
    const projectB = { ...makeProject("b"), archivedAt: Date.now() };
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "b",
      projects: [projectA, projectB],
    };
    const normalized = normalizeProjectsStore(store);
    expect(normalized.activeProjectId).toBe("a");
  });

  it("normalizesNonArrayProjects", () => {
    const store = {
      version: 3,
      activeProjectId: "missing",
      projects: "nope",
    } as unknown as ProjectsStore;
    const normalized = normalizeProjectsStore(store);
    expect(normalized.projects).toEqual([]);
    expect(normalized.activeProjectId).toBeNull();
  });
});

describe("store mutations", () => {
  it("adds a project and sets it active", () => {
    const store: ProjectsStore = { version: 3, activeProjectId: null, projects: [] };
    const project = makeProject("next");
    const nextStore = appendProjectToStore(store, project);
    expect(nextStore.activeProjectId).toBe(project.id);
    expect(nextStore.projects).toEqual([project]);
  });

  it("removes a project and normalizes active selection", () => {
    const projectA = makeProject("a");
    const projectB = makeProject("b");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: projectA.id,
      projects: [projectA, projectB],
    };
    const result = removeProjectFromStore(store, projectA.id);
    expect(result.removed).toBe(true);
    expect(result.store.projects).toEqual([projectB]);
    expect(result.store.activeProjectId).toBe(projectB.id);
  });

  it("adds a tile and updates updatedAt", () => {
    const now = 123;
    const project = makeProject("a");
    const tile = makeTile("1");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [project],
    };
    const nextStore = addTileToProject(store, project.id, tile, now);
    const updatedProject = nextStore.projects[0];
    expect(updatedProject.tiles).toEqual([tile]);
    expect(updatedProject.updatedAt).toBe(now);
  });

  it("updates a tile and updates updatedAt", () => {
    const now = 456;
    const project = makeProject("a");
    const tile = makeTile("1");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [{ ...project, tiles: [tile] }],
    };
    const nextStore = updateTileInProject(
      store,
      project.id,
      tile.id,
      { name: "Updated" },
      now
    );
    const updatedProject = nextStore.projects[0];
    expect(updatedProject.tiles[0].name).toBe("Updated");
    expect(updatedProject.updatedAt).toBe(now);
  });

  it("removes a tile and reports removal", () => {
    const now = 789;
    const project = makeProject("a");
    const tile = makeTile("1");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [{ ...project, tiles: [tile] }],
    };
    const result = removeTileFromProject(store, project.id, tile.id, now);
    const updatedProject = result.store.projects[0];
    expect(result.removed).toBe(true);
    expect(updatedProject.tiles).toEqual([]);
    expect(updatedProject.updatedAt).toBe(now);
  });

  it("removes multiple tiles at once", () => {
    const now = 999;
    const project = makeProject("a");
    const tileA = makeTile("1");
    const tileB = makeTile("2");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [{ ...project, tiles: [tileA, tileB] }],
    };
    const result = removeTilesFromStore(
      store,
      [
        { projectId: project.id, tileId: tileA.id },
        { projectId: project.id, tileId: tileB.id },
      ],
      now
    );
    expect(result.removed).toBe(true);
    expect(result.store.projects[0].tiles).toEqual([]);
    expect(result.store.projects[0].updatedAt).toBe(now);
  });

  it("archives and restores a project", () => {
    const now = 555;
    const project = makeProject("a");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [project],
    };
    const archived = archiveProjectInStore(store, project.id, now);
    expect(archived.updated).toBe(true);
    expect(archived.store.projects[0].archivedAt).toBe(now);
    const restored = restoreProjectInStore(archived.store, project.id, now + 1);
    expect(restored.updated).toBe(true);
    expect(restored.store.projects[0].archivedAt).toBeNull();
  });

  it("archives and restores a tile", () => {
    const now = 777;
    const project = makeProject("a");
    const tile = makeTile("1");
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: project.id,
      projects: [{ ...project, tiles: [tile] }],
    };
    const archived = archiveTileInProject(store, project.id, tile.id, now);
    expect(archived.updated).toBe(true);
    expect(archived.store.projects[0].tiles[0].archivedAt).toBe(now);
    const restored = restoreTileInProject(archived.store, project.id, tile.id, now + 1);
    expect(restored.updated).toBe(true);
    expect(restored.store.projects[0].tiles[0].archivedAt).toBeNull();
  });
});
