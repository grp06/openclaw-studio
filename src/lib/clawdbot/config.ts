import fs from "node:fs";
import path from "node:path";

import { resolveConfigPathCandidates, resolveStateDir } from "@/lib/clawdbot/paths";

type ClawdbotConfig = Record<string, unknown>;

export type AgentEntry = Record<string, unknown> & {
  id: string;
  name?: string;
  workspace?: string;
};

const CONFIG_FILENAME = "openclaw.json";

const parseJsonLoose = (raw: string) => {
  try {
    return JSON.parse(raw) as ClawdbotConfig;
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned) as ClawdbotConfig;
  }
};

export const loadClawdbotConfig = (): { config: ClawdbotConfig; configPath: string } => {
  const candidates = resolveConfigPathCandidates();
  const fallbackPath = path.join(resolveStateDir(), CONFIG_FILENAME);
  const configPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? fallbackPath;
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config at ${configPath}.`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  return { config: parseJsonLoose(raw), configPath };
};

export const saveClawdbotConfig = (configPath: string, config: ClawdbotConfig) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
};

export const readAgentList = (config: Record<string, unknown>): AgentEntry[] => {
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const list = Array.isArray(agents.list) ? agents.list : [];
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
};

export const writeAgentList = (config: Record<string, unknown>, list: AgentEntry[]) => {
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  agents.list = list;
  config.agents = agents;
};

export const upsertAgentEntry = (
  config: ClawdbotConfig,
  entry: { agentId: string; agentName: string; workspaceDir: string }
): boolean => {
  const list = readAgentList(config);
  let changed = false;
  let found = false;
  const next = list.map((item) => {
    if (item.id !== entry.agentId) return item;
    found = true;
    const nextItem: AgentEntry = { ...item };
    if (entry.agentName && entry.agentName !== item.name) {
      nextItem.name = entry.agentName;
      changed = true;
    }
    if (entry.workspaceDir !== item.workspace) {
      nextItem.workspace = entry.workspaceDir;
      changed = true;
    }
    return nextItem;
  });
  if (!found) {
    next.push({ id: entry.agentId, name: entry.agentName, workspace: entry.workspaceDir });
    changed = true;
  }
  if (changed) {
    writeAgentList(config, next);
  }
  return changed;
};

export const renameAgentEntry = (
  config: ClawdbotConfig,
  entry: { fromAgentId: string; toAgentId: string; agentName: string; workspaceDir: string }
): boolean => {
  const list = readAgentList(config);
  let changed = false;
  let found = false;
  const next = list.map((item) => {
    if (item.id !== entry.fromAgentId) return item;
    found = true;
    const nextItem: AgentEntry = { ...item, id: entry.toAgentId };
    if (entry.agentName && entry.agentName !== item.name) {
      nextItem.name = entry.agentName;
    }
    if (entry.workspaceDir !== item.workspace) {
      nextItem.workspace = entry.workspaceDir;
    }
    changed = true;
    return nextItem;
  });
  if (!found) {
    next.push({ id: entry.toAgentId, name: entry.agentName, workspace: entry.workspaceDir });
    changed = true;
  }
  if (changed) {
    writeAgentList(config, next);
  }
  return changed;
};

export const removeAgentEntry = (config: ClawdbotConfig, agentId: string): boolean => {
  const list = readAgentList(config);
  const next = list.filter((item) => item.id !== agentId);
  if (next.length === list.length) return false;
  writeAgentList(config, next);
  return true;
};

/** Rewrite bindings that pointed at agentId to "main" so routing falls back. */
export const rewriteBindingsForRemovedAgent = (
  config: ClawdbotConfig,
  agentId: string,
  fallbackAgentId = "main"
): boolean => {
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  let changed = false;
  const next = bindings.map((binding) => {
    if (!binding || typeof binding !== "object") return binding;
    const entry = binding as Record<string, unknown>;
    if (entry.agentId !== agentId) return binding;
    changed = true;
    return { ...entry, agentId: fallbackAgentId };
  });
  if (changed) {
    config.bindings = next;
  }
  return changed;
};

export const updateClawdbotConfig = (
  updater: (config: Record<string, unknown>) => boolean
): { warnings: string[] } => {
  const warnings: string[] = [];
  try {
    const { config, configPath } = loadClawdbotConfig();
    const changed = updater(config);
    if (changed) {
      saveClawdbotConfig(configPath, config);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update config.";
    warnings.push(`Agent config not updated: ${message}`);
  }
  return { warnings };
};
