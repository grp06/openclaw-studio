export type ProjectTileRole = "coding" | "research" | "marketing";

export type ProjectTile = {
  id: string;
  name: string;
  agentId: string;
  role: ProjectTileRole;
  sessionKey: string;
  workspacePath: string;
  archivedAt: number | null;
  model?: string | null;
  thinkingLevel?: string | null;
  avatarSeed?: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type Project = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  tiles: ProjectTile[];
};

export type ProjectsStore = {
  version: 3;
  activeProjectId: string | null;
  projects: Project[];
};

export type ProjectCreateOrOpenPayload =
  | { name: string; path?: never }
  | { path: string; name?: never };

export type ProjectCreateOrOpenResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectUpdatePayload = {
  archivedAt?: number | null;
};

export type ProjectUpdateResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectDeleteResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectDiscordChannelCreatePayload = {
  guildId?: string;
  agentId: string;
  agentName: string;
};

export type ProjectDiscordChannelCreateResult = {
  channelId: string;
  channelName: string;
  guildId: string;
  agentId: string;
  warnings: string[];
};

export type ProjectTileCreatePayload = {
  name: string;
  role: ProjectTileRole;
};

export type ProjectTileCreateResult = {
  store: ProjectsStore;
  tile: ProjectTile;
  warnings: string[];
};

export type ProjectTileDeleteResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectCleanupPreviewItem = {
  projectId: string;
  projectName: string;
  tileId: string;
  tileName: string;
  agentId: string;
  workspacePath: string;
  archivedAt: number;
  workspaceExists: boolean;
  agentStateExists: boolean;
  worktreeDirty: boolean;
};

export type ProjectCleanupPreviewResult = {
  items: ProjectCleanupPreviewItem[];
};

export type ProjectCleanupRequest = {
  tileIds?: string[];
};

export type ProjectCleanupResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectTileUpdatePayload = {
  name?: string;
  avatarSeed?: string | null;
  archivedAt?: number | null;
};

export type ProjectTileUpdateResult = {
  store: ProjectsStore;
  warnings: string[];
};

export type ProjectTileWorkspaceFile = {
  name: string;
  content: string;
  exists: boolean;
};

export type ProjectTileWorkspaceFilesResult = {
  files: ProjectTileWorkspaceFile[];
};

export type ProjectTileWorkspaceFilesUpdatePayload = {
  files: Array<{ name: string; content: string }>;
};

export type ProjectTileHeartbeatActiveHours = {
  start: string;
  end: string;
};

export type ProjectTileHeartbeat = {
  every: string;
  target: string;
  includeReasoning: boolean;
  ackMaxChars?: number | null;
  activeHours?: ProjectTileHeartbeatActiveHours | null;
};

export type ProjectTileHeartbeatResult = {
  heartbeat: ProjectTileHeartbeat;
  hasOverride: boolean;
};

export type ProjectTileHeartbeatUpdatePayload = {
  override: boolean;
  heartbeat: ProjectTileHeartbeat;
};
