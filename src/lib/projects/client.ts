import type {
  ProjectCreatePayload,
  ProjectCreateResult,
  ProjectDeleteResult,
  ProjectDiscordChannelCreatePayload,
  ProjectDiscordChannelCreateResult,
  ProjectTileCreatePayload,
  ProjectTileCreateResult,
  ProjectTileDeleteResult,
  ProjectTileRenamePayload,
  ProjectTileRenameResult,
  ProjectsStore,
} from "./types";

export const fetchProjectsStore = async (): Promise<ProjectsStore> => {
  const res = await fetch("/api/projects", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load projects.");
  }
  return (await res.json()) as ProjectsStore;
};

export const createProject = async (
  payload: ProjectCreatePayload
): Promise<ProjectCreateResult> => {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to create project.");
  }
  return data as ProjectCreateResult;
};

export const saveProjectsStore = async (store: ProjectsStore): Promise<ProjectsStore> => {
  const res = await fetch("/api/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to save projects.");
  }
  return data as ProjectsStore;
};

export const deleteProject = async (projectId: string): Promise<ProjectDeleteResult> => {
  const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to delete project.");
  }
  return data as ProjectDeleteResult;
};

export const createProjectDiscordChannel = async (
  projectId: string,
  payload: ProjectDiscordChannelCreatePayload
): Promise<ProjectDiscordChannelCreateResult> => {
  const res = await fetch(`/api/projects/${projectId}/discord`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to create Discord channel.");
  }
  return data as ProjectDiscordChannelCreateResult;
};

export const createProjectTile = async (
  projectId: string,
  payload: ProjectTileCreatePayload
): Promise<ProjectTileCreateResult> => {
  const res = await fetch(`/api/projects/${projectId}/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to create tile.");
  }
  return data as ProjectTileCreateResult;
};

export const deleteProjectTile = async (
  projectId: string,
  tileId: string
): Promise<ProjectTileDeleteResult> => {
  const res = await fetch(`/api/projects/${projectId}/tiles/${tileId}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to delete tile.");
  }
  return data as ProjectTileDeleteResult;
};

export const renameProjectTile = async (
  projectId: string,
  tileId: string,
  payload: ProjectTileRenamePayload
): Promise<ProjectTileRenameResult> => {
  const res = await fetch(`/api/projects/${projectId}/tiles/${tileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to rename tile.");
  }
  return data as ProjectTileRenameResult;
};
