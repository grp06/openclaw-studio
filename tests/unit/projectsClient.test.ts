import { describe, expect, it, vi } from "vitest";

import {
  createOrOpenProject,
  fetchProjectCleanupPreview,
  runProjectCleanup,
  updateProject,
  updateProjectTile,
} from "@/lib/projects/client";
import { fetchJson } from "@/lib/http";

vi.mock("@/lib/http", () => ({
  fetchJson: vi.fn(),
}));

describe("projects client", () => {
  it("createOrOpenProject posts name payload", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      store: { version: 3, activeProjectId: null, projects: [] },
      warnings: [],
    });

    await createOrOpenProject({ name: "Demo" });

    expect(fetchJson).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Demo" }),
    });
  });

  it("createOrOpenProject posts path payload", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      store: { version: 3, activeProjectId: null, projects: [] },
      warnings: [],
    });

    await createOrOpenProject({ path: "/tmp/demo" });

    expect(fetchJson).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/demo" }),
    });
  });

  it("updateProjectTile sends PATCH with name payload", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      store: { version: 3, activeProjectId: null, projects: [] },
      warnings: [],
    });

    await updateProjectTile("project-1", "tile-1", { name: "New" });

    expect(fetchJson).toHaveBeenCalledWith(
      "/api/projects/project-1/tiles/tile-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      }
    );
  });

  it("updateProject sends PATCH with archivedAt payload", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      store: { version: 3, activeProjectId: null, projects: [] },
      warnings: [],
    });

    await updateProject("project-1", { archivedAt: null });

    expect(fetchJson).toHaveBeenCalledWith("/api/projects/project-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivedAt: null }),
    });
  });

  it("fetchProjectCleanupPreview calls cleanup endpoint", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ items: [] });

    await fetchProjectCleanupPreview();

    expect(fetchJson).toHaveBeenCalledWith("/api/projects/cleanup", {
      cache: "no-store",
    });
  });

  it("runProjectCleanup posts payload", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      store: { version: 3, activeProjectId: null, projects: [] },
      warnings: [],
    });

    await runProjectCleanup({ tileIds: ["tile-1"] });

    expect(fetchJson).toHaveBeenCalledWith("/api/projects/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tileIds: ["tile-1"] }),
    });
  });
});
