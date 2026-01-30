import type { Project, ProjectTile, ProjectsStore } from "./types";

type CleanupCandidate = {
  project: Project;
  tile: ProjectTile;
};

export const selectArchivedTilesForCleanup = (
  store: ProjectsStore,
  tileIds?: string[]
): { candidates: CleanupCandidate[]; errors: string[] } => {
  const errors: string[] = [];
  const candidates: CleanupCandidate[] = [];
  const tilesById = new Map<string, CleanupCandidate>();

  for (const project of store.projects) {
    for (const tile of project.tiles) {
      tilesById.set(tile.id, { project, tile });
    }
  }

  if (tileIds) {
    if (tileIds.length === 0) {
      return { candidates: [], errors: ["Tile ids are required for cleanup."] };
    }
    const seen = new Set<string>();
    for (const rawId of tileIds) {
      if (typeof rawId !== "string") {
        errors.push("Tile id must be a string.");
        continue;
      }
      const tileId = rawId.trim();
      if (!tileId) {
        errors.push("Tile id is required.");
        continue;
      }
      if (seen.has(tileId)) continue;
      seen.add(tileId);
      const entry = tilesById.get(tileId);
      if (!entry) {
        errors.push(`Tile not found: ${tileId}`);
        continue;
      }
      if (!entry.tile.archivedAt) {
        errors.push(`Tile is not archived: ${tileId}`);
        continue;
      }
      candidates.push(entry);
    }
    return { candidates: errors.length ? [] : candidates, errors };
  }

  for (const entry of tilesById.values()) {
    if (entry.tile.archivedAt) {
      candidates.push(entry);
    }
  }

  return { candidates, errors };
};
