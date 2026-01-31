import type {
  ProjectDeleteResult,
  ProjectDiscordChannelCreatePayload,
  ProjectDiscordChannelCreateResult,
  ProjectCreateOrOpenPayload,
  ProjectCreateOrOpenResult,
  ProjectCleanupPreviewResult,
  ProjectCleanupRequest,
  ProjectCleanupResult,
  ProjectUpdatePayload,
  ProjectUpdateResult,
  ProjectTileCreatePayload,
  ProjectTileCreateResult,
  ProjectTileDeleteResult,
  ProjectTileUpdatePayload,
  ProjectTileUpdateResult,
  ProjectTileHeartbeatResult,
  ProjectTileHeartbeatUpdatePayload,
  ProjectTileWorkspaceFilesResult,
  ProjectTileWorkspaceFilesUpdatePayload,
  ProjectsStore,
} from "./types";
import { fetchJson } from "@/lib/http";

export const fetchProjectsStore = async (): Promise<ProjectsStore> => {
  return fetchJson<ProjectsStore>("/api/projects", { cache: "no-store" });
};

export const createOrOpenProject = async (
  payload: ProjectCreateOrOpenPayload
): Promise<ProjectCreateOrOpenResult> => {
  return fetchJson<ProjectCreateOrOpenResult>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const saveProjectsStore = async (store: ProjectsStore): Promise<ProjectsStore> => {
  return fetchJson<ProjectsStore>("/api/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
};

export const deleteProject = async (projectId: string): Promise<ProjectDeleteResult> => {
  return fetchJson<ProjectDeleteResult>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
};

export const updateProject = async (
  projectId: string,
  payload: ProjectUpdatePayload
): Promise<ProjectUpdateResult> => {
  return fetchJson<ProjectUpdateResult>(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const fetchProjectCleanupPreview = async (): Promise<ProjectCleanupPreviewResult> => {
  return fetchJson<ProjectCleanupPreviewResult>("/api/projects/cleanup", {
    cache: "no-store",
  });
};

export const runProjectCleanup = async (
  payload: ProjectCleanupRequest
): Promise<ProjectCleanupResult> => {
  return fetchJson<ProjectCleanupResult>("/api/projects/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const createProjectDiscordChannel = async (
  projectId: string,
  payload: ProjectDiscordChannelCreatePayload
): Promise<ProjectDiscordChannelCreateResult> => {
  return fetchJson<ProjectDiscordChannelCreateResult>(`/api/projects/${projectId}/discord`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const createProjectTile = async (
  projectId: string,
  payload: ProjectTileCreatePayload
): Promise<ProjectTileCreateResult> => {
  return fetchJson<ProjectTileCreateResult>(`/api/projects/${projectId}/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const deleteProjectTile = async (
  projectId: string,
  tileId: string
): Promise<ProjectTileDeleteResult> => {
  return fetchJson<ProjectTileDeleteResult>(`/api/projects/${projectId}/tiles/${tileId}`, {
    method: "DELETE",
  });
};

export const updateProjectTile = async (
  projectId: string,
  tileId: string,
  payload: ProjectTileUpdatePayload
): Promise<ProjectTileUpdateResult> => {
  return fetchJson<ProjectTileUpdateResult>(`/api/projects/${projectId}/tiles/${tileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const fetchProjectTileWorkspaceFiles = async (
  projectId: string,
  tileId: string
): Promise<ProjectTileWorkspaceFilesResult> => {
  return fetchJson<ProjectTileWorkspaceFilesResult>(
    `/api/projects/${projectId}/tiles/${tileId}/workspace-files`,
    { cache: "no-store" }
  );
};

export const updateProjectTileWorkspaceFiles = async (
  projectId: string,
  tileId: string,
  payload: ProjectTileWorkspaceFilesUpdatePayload
): Promise<ProjectTileWorkspaceFilesResult> => {
  return fetchJson<ProjectTileWorkspaceFilesResult>(
    `/api/projects/${projectId}/tiles/${tileId}/workspace-files`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
};

export const fetchProjectTileHeartbeat = async (
  projectId: string,
  tileId: string
): Promise<ProjectTileHeartbeatResult> => {
  return fetchJson<ProjectTileHeartbeatResult>(
    `/api/projects/${projectId}/tiles/${tileId}/heartbeat`,
    { cache: "no-store" }
  );
};

export const updateProjectTileHeartbeat = async (
  projectId: string,
  tileId: string,
  payload: ProjectTileHeartbeatUpdatePayload
): Promise<ProjectTileHeartbeatResult> => {
  return fetchJson<ProjectTileHeartbeatResult>(
    `/api/projects/${projectId}/tiles/${tileId}/heartbeat`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
};
