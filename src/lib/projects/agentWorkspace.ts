import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "@/lib/clawdbot/paths";

export const resolveAgentCanvasDir = (
  env: NodeJS.ProcessEnv = process.env,
  homedir?: () => string
) => {
  const stateDir = resolveStateDir(env, homedir);
  const nextDir = path.join(stateDir, "openclaw-studio");
  const legacyDir = path.join(stateDir, "agent-canvas");
  if (fs.existsSync(legacyDir) && !fs.existsSync(nextDir)) {
    const stat = fs.statSync(legacyDir);
    if (!stat.isDirectory()) {
      throw new Error(`Agent canvas path is not a directory: ${legacyDir}`);
    }
    fs.renameSync(legacyDir, nextDir);
  }
  return nextDir;
};

export const resolveProjectAgentsRoot = (projectId: string) => {
  return path.join(resolveAgentCanvasDir(), "worktrees", projectId);
};

export const resolveAgentWorkspaceDir = (projectId: string, agentId: string) => {
  return path.join(resolveProjectAgentsRoot(projectId), agentId);
};
