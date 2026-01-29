import { NextResponse } from "next/server";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import { resolveProject, resolveProjectTile } from "@/lib/projects/resolve";

export type ProjectResolveResponse =
  | { ok: true; projectId: string; project: Project }
  | { ok: false; response: NextResponse };

export type ProjectTileResolveResponse =
  | { ok: true; projectId: string; tileId: string; project: Project; tile: ProjectTile }
  | { ok: false; response: NextResponse };

export const resolveProjectOrResponse = (
  store: ProjectsStore,
  projectId: string
): ProjectResolveResponse => {
  const resolved = resolveProject(store, projectId);
  if (!resolved.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: resolved.error.message },
        { status: resolved.error.status }
      ),
    };
  }
  return resolved;
};

export const resolveProjectTileOrResponse = (
  store: ProjectsStore,
  projectId: string,
  tileId: string
): ProjectTileResolveResponse => {
  const resolved = resolveProjectTile(store, projectId, tileId);
  if (!resolved.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: resolved.error.message },
        { status: resolved.error.status }
      ),
    };
  }
  return resolved;
};
