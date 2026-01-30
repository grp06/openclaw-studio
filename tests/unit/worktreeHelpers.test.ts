import { afterEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  ensureAgentWorktree,
  ensureWorktreeIgnores,
  resolveAgentWorktreeDir,
} from "@/lib/projects/worktrees.server";
import { buildAgentInstruction } from "@/lib/projects/message";

const previousStateDir = process.env.OPENCLAW_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previousStateDir;
  }
});

describe("worktrees", () => {
  it("resolves deterministic worktree paths", () => {
    process.env.OPENCLAW_STATE_DIR = "/tmp/openclaw-test-state";
    const resolved = resolveAgentWorktreeDir("project-1", "agent-2");
    expect(resolved).toBe(
      path.join(
        "/tmp/openclaw-test-state",
        "openclaw-studio",
        "worktrees",
        "project-1",
        "agent-2"
      )
    );
  });
});

describe("buildAgentInstruction", () => {
  it("includes the worktree path and repo hint", () => {
    const message = buildAgentInstruction({
      worktreePath: "/tmp/worktrees/project-1/agent-2",
      repoPath: "/repo/project-1",
      message: "Ship it",
    });

    expect(message).toContain("Workspace path: /tmp/worktrees/project-1/agent-2");
    expect(message).toContain("git worktree of /repo/project-1");
    expect(message).toContain("Ship it");
  });
});

describe("worktree provisioning", () => {
  it("creates a worktree and writes excludes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-worktree-"));
    const repoPath = path.join(tempDir, "repo");
    fs.mkdirSync(repoPath, { recursive: true });
    execSync("git init", { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, "README.md"), "hello", "utf8");
    execSync("git add .", { cwd: repoPath });
    execSync('git -c user.name="OpenClaw" -c user.email="dev@openclaw" commit -m "init"', {
      cwd: repoPath,
    });

    const worktreeDir = path.join(tempDir, "worktree");
    ensureAgentWorktree(repoPath, worktreeDir, "agent/agent-1");
    expect(fs.existsSync(path.join(worktreeDir, ".git"))).toBe(true);

    ensureWorktreeIgnores(worktreeDir, ["AGENTS.md", "memory/"]);
    const gitPath = path.join(worktreeDir, ".git");
    const gitStat = fs.statSync(gitPath);
    const gitDir = gitStat.isDirectory()
      ? gitPath
      : path.resolve(
          worktreeDir,
          fs.readFileSync(gitPath, "utf8").trim().replace(/^gitdir:\s*/i, "")
        );
    const excludePath = path.join(gitDir, "info", "exclude");
    const excludeContents = fs.readFileSync(excludePath, "utf8");
    expect(excludeContents).toContain("AGENTS.md");
    expect(excludeContents).toContain("memory/");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
