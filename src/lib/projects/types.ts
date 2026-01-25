export type ProjectTileRole = "coding" | "research" | "marketing";

export type ProjectTile = {
  id: string;
  name: string;
  agentId: string;
  role: ProjectTileRole;
  sessionKey: string;
  model?: string | null;
  thinkingLevel?: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export type Project = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: number;
  updatedAt: number;
  tiles: ProjectTile[];
};

export type ProjectsStore = {
  version: 2;
  activeProjectId: string | null;
  projects: Project[];
};

export type ProjectCreatePayload = {
  name: string;
};

export type ProjectCreateResult = {
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

export type ProjectTileRenamePayload = {
  name: string;
};

export type ProjectTileRenameResult = {
  store: ProjectsStore;
  warnings: string[];
};
