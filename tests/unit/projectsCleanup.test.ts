import { describe, expect, it } from "vitest";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import { selectArchivedTilesForCleanup } from "@/lib/projects/cleanup";

const makeTile = (id: string, archivedAt: number | null): ProjectTile => ({
  id,
  name: `Tile ${id}`,
  agentId: `agent-${id}`,
  role: "coding",
  sessionKey: `agent:agent-${id}:main`,
  workspacePath: `/tmp/${id}`,
  archivedAt,
  model: "openai-codex/gpt-5.2-codex",
  thinkingLevel: null,
  avatarSeed: `agent-${id}`,
  position: { x: 0, y: 0 },
  size: { width: 420, height: 520 },
});

const makeProject = (id: string, tiles: ProjectTile[]): Project => ({
  id,
  name: `Project ${id}`,
  repoPath: `/tmp/${id}`,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  tiles,
});

describe("selectArchivedTilesForCleanup", () => {
  it("selects_all_archived_tiles", () => {
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "p1",
      projects: [
        makeProject("p1", [makeTile("a", Date.now()), makeTile("b", null)]),
      ],
    };

    const result = selectArchivedTilesForCleanup(store);

    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].tile.id).toBe("a");
  });

  it("rejects_non_archived_tile_ids", () => {
    const store: ProjectsStore = {
      version: 3,
      activeProjectId: "p1",
      projects: [
        makeProject("p1", [makeTile("a", Date.now()), makeTile("b", null)]),
      ],
    };

    const result = selectArchivedTilesForCleanup(store, ["b", "missing"]);

    expect(result.candidates).toEqual([]);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toBe("Tile is not archived: b");
    expect(result.errors[1]).toBe("Tile not found: missing");
  });
});
