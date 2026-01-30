import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveAgentCanvasDir } from "@/lib/projects/agentWorkspace";

export const resolveAgentWorktreeDir = (projectId: string, agentId: string) => {
  return path.join(resolveAgentCanvasDir(), "worktrees", projectId, agentId);
};

const resolveGitDir = (worktreeDir: string): string => {
  const gitPath = path.join(worktreeDir, ".git");
  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }
  if (!stat.isFile()) {
    throw new Error(`.git is not a file or directory at ${gitPath}`);
  }
  const raw = fs.readFileSync(gitPath, "utf8");
  const match = raw.trim().match(/^gitdir:\s*(.+)$/i);
  if (!match || !match[1]) {
    throw new Error(`Unable to resolve gitdir from ${gitPath}`);
  }
  const resolved = path.resolve(worktreeDir, match[1].trim());
  return resolved;
};

export const ensureWorktreeIgnores = (worktreeDir: string, files: string[]) => {
  if (files.length === 0) return;
  const gitDir = resolveGitDir(worktreeDir);
  const infoDir = path.join(gitDir, "info");
  fs.mkdirSync(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, "exclude");
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const additions = files.filter((entry) => !lines.includes(entry));
  if (additions.length === 0) return;
  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) {
    next += "\n";
  }
  next += `${additions.join("\n")}\n`;
  fs.writeFileSync(excludePath, next, "utf8");
};

export const ensureAgentWorktree = (
  repoPath: string,
  worktreeDir: string,
  branchName: string
): { ok: boolean; warnings: string[] } => {
  const warnings: string[] = [];
  const trimmedRepo = repoPath.trim();
  if (!trimmedRepo) {
    throw new Error("Repository path is required.");
  }
  if (!fs.existsSync(trimmedRepo)) {
    throw new Error(`Repository path does not exist: ${trimmedRepo}`);
  }
  const repoStat = fs.statSync(trimmedRepo);
  if (!repoStat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${trimmedRepo}`);
  }
  if (!fs.existsSync(path.join(trimmedRepo, ".git"))) {
    throw new Error(`Repository is missing a .git directory: ${trimmedRepo}`);
  }

  if (fs.existsSync(worktreeDir)) {
    const stat = fs.statSync(worktreeDir);
    if (!stat.isDirectory()) {
      throw new Error(`Worktree path is not a directory: ${worktreeDir}`);
    }
    if (!fs.existsSync(path.join(worktreeDir, ".git"))) {
      throw new Error(`Existing worktree is missing .git at ${worktreeDir}`);
    }
    return { ok: true, warnings };
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

  const branchCheck = spawnSync("git", ["rev-parse", "--verify", branchName], {
    cwd: trimmedRepo,
    encoding: "utf8",
  });
  const args =
    branchCheck.status === 0
      ? ["worktree", "add", worktreeDir, branchName]
      : ["worktree", "add", "-b", branchName, worktreeDir];
  const result = spawnSync("git", args, { cwd: trimmedRepo, encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr
        ? `git worktree add failed for ${worktreeDir}: ${stderr}`
        : `git worktree add failed for ${worktreeDir}.`
    );
  }

  return { ok: true, warnings };
};

export const isWorktreeDirty = (worktreeDir: string): boolean => {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: worktreeDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr
        ? `git status failed in ${worktreeDir}: ${stderr}`
        : `git status failed in ${worktreeDir}.`
    );
  }
  return result.stdout.trim().length > 0;
};
