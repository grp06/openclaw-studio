import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { slugifyProjectName } from "../ids/slugify";

type DiscordChannelCreateResult = {
  channelId: string;
  channelName: string;
  guildId: string;
  agentId: string;
  warnings: string[];
};

const ENV_PATH = path.join(os.homedir(), ".clawdbot", ".env");
const CONFIG_PATH = path.join(os.homedir(), ".clawdbot", "clawdbot.json");

const readEnvValue = (key: string) => {
  if (!fs.existsSync(ENV_PATH)) return null;
  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const envKey = trimmed.slice(0, idx).trim();
    if (envKey !== key) continue;
    return trimmed.slice(idx + 1).trim();
  }
  return null;
};

const parseJsonLoose = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
};

const loadConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config at ${CONFIG_PATH}.`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return parseJsonLoose(raw);
};

const saveConfig = (config: Record<string, unknown>) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
};

const resolveGuildId = (config: Record<string, unknown>, guildId?: string) => {
  if (guildId) return guildId;
  const channels = config.channels as Record<string, unknown> | undefined;
  const discord = channels?.discord as Record<string, unknown> | undefined;
  const guilds = discord?.guilds as Record<string, unknown> | undefined;
  if (!guilds) {
    throw new Error("No Discord guilds configured in clawdbot.json.");
  }
  const guildIds = Object.keys(guilds).filter((key) => key !== "*");
  if (guildIds.length === 1) {
    return guildIds[0];
  }
  if (guildIds.length === 0) {
    throw new Error("No Discord guild id found in clawdbot.json.");
  }
  throw new Error("Multiple Discord guilds configured; specify a guild id.");
};

const ensureAgentWorkspace = (agentId: string) => {
  const workspaceDir = path.join(os.homedir(), `clawd-${agentId}`);
  if (fs.existsSync(workspaceDir)) {
    const stat = fs.statSync(workspaceDir);
    if (!stat.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspaceDir}`);
    }
    return workspaceDir;
  }
  fs.mkdirSync(workspaceDir, { recursive: true });
  return workspaceDir;
};

const ensureAgentConfig = (
  config: Record<string, unknown>,
  agentId: string,
  agentName: string,
  workspaceDir: string
) => {
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const list = Array.isArray(agents.list) ? [...agents.list] : [];
  const exists = list.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as Record<string, unknown>).id === agentId;
  });
  if (!exists) {
    list.push({ id: agentId, name: agentName, workspace: workspaceDir });
    agents.list = list;
    config.agents = agents;
    return true;
  }
  return false;
};

const resolveGuildChannelMap = (config: Record<string, unknown>, guildId: string) => {
  const channels = config.channels as Record<string, unknown> | undefined;
  const discord = channels?.discord as Record<string, unknown> | undefined;
  const guilds = discord?.guilds as Record<string, unknown> | undefined;
  const guildEntry = guilds?.[guildId] as Record<string, unknown> | undefined;
  const channelMap = guildEntry?.channels as Record<string, unknown> | undefined;
  return channelMap;
};

const fetchDiscordChannel = async (token: string, channelId: string) => {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const payload = (await response.json()) as {
    id?: string;
    parent_id?: string | null;
  };
  if (!response.ok || !payload.id) {
    return null;
  }
  return payload;
};

const fetchDiscordGuildChannels = async (token: string, guildId: string) => {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const payload = (await response.json()) as Array<{
    id?: string;
    type?: number;
    name?: string;
    parent_id?: string | null;
  }>;
  if (!response.ok || !Array.isArray(payload)) {
    return null;
  }
  return payload;
};

const updateDiscordChannelParent = async (
  token: string,
  channelId: string,
  parentId: string
) => {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_id: parentId }),
  });
  if (!response.ok) {
    return false;
  }
  return true;
};

const resolveChannelParentId = async (
  config: Record<string, unknown>,
  token: string,
  guildId: string,
  warnings: string[]
) => {
  const channelMap = resolveGuildChannelMap(config, guildId);
  if (!channelMap) return null;
  const channelIds = Object.keys(channelMap).filter((key) => /^\d+$/.test(key));
  for (const channelId of channelIds) {
    const channel = await fetchDiscordChannel(token, channelId);
    if (channel?.parent_id) {
      return channel.parent_id;
    }
  }
  if (channelIds.length > 0) {
    warnings.push("Discord channel category not resolved; created channel is uncategorized.");
  }
  return null;
};

const ensureDiscordChannelConfig = (
  config: Record<string, unknown>,
  guildId: string,
  channelId: string
) => {
  const channels = (config.channels ?? {}) as Record<string, unknown>;
  const discord = (channels.discord ?? {}) as Record<string, unknown>;
  const guilds = (discord.guilds ?? {}) as Record<string, unknown>;
  const guildEntry = (guilds[guildId] ?? {}) as Record<string, unknown>;
  const channelMap = (guildEntry.channels ?? {}) as Record<string, unknown>;

  channelMap[channelId] = { allow: true, requireMention: false };
  guildEntry.channels = channelMap;
  guilds[guildId] = guildEntry;
  discord.guilds = guilds;
  channels.discord = discord;
  config.channels = channels;
};

const ensureDiscordBinding = (
  config: Record<string, unknown>,
  channelId: string,
  agentId: string
) => {
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const filtered = bindings.filter((binding) => {
    if (!binding || typeof binding !== "object") return false;
    const match = (binding as Record<string, unknown>).match as Record<string, unknown> | undefined;
    if (!match || match.channel !== "discord") return true;
    const peer = match.peer as Record<string, unknown> | undefined;
    if (!peer || peer.kind !== "channel") return true;
    return peer.id !== channelId;
  });
  filtered.push({
    agentId,
    match: {
      channel: "discord",
      accountId: "default",
      peer: { kind: "channel", id: channelId },
    },
  });
  config.bindings = filtered;
};

export const createDiscordChannelForAgent = async ({
  agentId,
  agentName,
  guildId,
}: {
  agentId: string;
  agentName: string;
  guildId?: string;
}): Promise<DiscordChannelCreateResult> => {
  const token = readEnvValue("DISCORD_BOT_TOKEN");
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN not found in ~/.clawdbot/.env.");
  }
  const config = loadConfig();
  const resolvedGuildId = resolveGuildId(config, guildId);
  const channelName = slugifyProjectName(agentName);
  const warnings: string[] = [];
  const workspaceDir = ensureAgentWorkspace(agentId);
  const addedAgent = ensureAgentConfig(config, agentId, agentName, workspaceDir);
  if (addedAgent) {
    warnings.push(`Registered agent ${agentId} in clawdbot.json.`);
  }
  let parentId = await resolveChannelParentId(config, token, resolvedGuildId, warnings);

  const guildChannels = await fetchDiscordGuildChannels(token, resolvedGuildId);
  if (!guildChannels) {
    warnings.push("Unable to inspect existing Discord channels; creating a new one.");
  }
  if (!parentId && guildChannels) {
    const withParent = guildChannels.find(
      (channel) => channel?.type === 0 && channel?.parent_id
    );
    parentId = withParent?.parent_id ?? null;
  }
  const existing = guildChannels?.find(
    (channel) => channel?.type === 0 && channel?.name === channelName
  );
  if (existing?.id) {
    if (parentId && existing.parent_id !== parentId) {
      const updated = await updateDiscordChannelParent(token, existing.id, parentId);
      if (!updated) {
        warnings.push("Failed to set Discord channel category.");
      }
    }
    ensureDiscordChannelConfig(config, resolvedGuildId, existing.id);
    ensureDiscordBinding(config, existing.id, agentId);
    saveConfig(config);
    warnings.push("Reused existing Discord channel.");
    return {
      channelId: existing.id,
      channelName,
      guildId: resolvedGuildId,
      agentId,
      warnings,
    };
  }

  const body: Record<string, unknown> = { name: channelName, type: 0 };
  if (parentId) {
    body.parent_id = parentId;
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${resolvedGuildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as { id?: string; message?: string; code?: number };
  if (!response.ok || !payload.id) {
    const msg = payload?.message ? `Discord error: ${payload.message}` : "Discord API error.";
    throw new Error(msg);
  }

  ensureDiscordChannelConfig(config, resolvedGuildId, payload.id);
  ensureDiscordBinding(config, payload.id, agentId);
  saveConfig(config);

  return {
    channelId: payload.id,
    channelName,
    guildId: resolvedGuildId,
    agentId,
    warnings,
  };
};
