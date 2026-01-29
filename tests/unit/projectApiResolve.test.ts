import { describe, expect, it } from "vitest";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import {
  resolveProjectOrResponse,
  resolveProjectTileOrResponse,
} from "@/app/api/projects/resolveResponse";

const makeTile = (): ProjectTile => ({
  id: "tile-1",
  name: "Tile",
  agentId: "agent-1",
  role: "coding",
  sessionKey: "agent:agent-1:main",
  model: "openai-codex/gpt-5.2-codex",
  thinkingLevel: null,
  avatarSeed: "agent-1",
  position: { x: 0, y: 0 },
  size: { width: 420, height: 520 },
});

const makeProject = (): Project => ({
  id: "project-1",
  name: "Project",
  repoPath: "/tmp/project-1",
  createdAt: 1,
  updatedAt: 1,
  tiles: [makeTile()],
});

const makeStore = (): ProjectsStore => {
  const project = makeProject();
  return { version: 2, activeProjectId: project.id, projects: [project] };
};

describe("project API resolve helpers", () => {
  it("resolveProjectOrResponse returns ok for valid id", () => {
    const store = makeStore();
    const result = resolveProjectOrResponse(store, "project-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectId).toBe("project-1");
      expect(result.project).toEqual(store.projects[0]);
    }
  });

  it("resolveProjectOrResponse returns response for invalid id", async () => {
    const result = resolveProjectOrResponse(makeStore(), "missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      await expect(result.response.json()).resolves.toEqual({
        error: "Workspace not found.",
      });
    }
  });

  it("resolveProjectTileOrResponse returns ok for valid ids", () => {
    const store = makeStore();
    const result = resolveProjectTileOrResponse(store, "project-1", "tile-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectId).toBe("project-1");
      expect(result.tileId).toBe("tile-1");
      expect(result.tile).toEqual(store.projects[0].tiles[0]);
    }
  });

  it("resolveProjectTileOrResponse returns response for invalid tile", async () => {
    const result = resolveProjectTileOrResponse(makeStore(), "project-1", "missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      await expect(result.response.json()).resolves.toEqual({
        error: "Tile not found.",
      });
    }
  });
});
