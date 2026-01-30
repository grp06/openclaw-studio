import { afterEach, beforeEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectAgentIdsAndDeleteArtifacts, deleteDirIfExists } from "@/lib/projects/fs.server";
import type { ProjectTile } from "@/lib/projects/types";
import { resolveStateDir, resolveUserPath } from "@/lib/clawdbot/paths";
import { resolveAgentCanvasDir } from "@/lib/projects/agentWorkspace";

let tempDir: string | null = null;
let previousStateDir: string | undefined;

const cleanup = () => {
  if (!tempDir) return;
  fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
};

const resetStateDir = () => {
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previousStateDir;
  }
  previousStateDir = undefined;
};

afterEach(cleanup);
afterEach(resetStateDir);
beforeEach(() => {
  previousStateDir = process.env.OPENCLAW_STATE_DIR;
});

describe("projectFs", () => {
  it("resolvesUserPathVariants", () => {
    const home = path.join(os.tmpdir(), "clawdbot-test-home");
    expect(resolveUserPath("~", () => home)).toBe(home);
    expect(resolveUserPath("~/foo", () => home)).toBe(path.join(home, "foo"));
    expect(resolveUserPath("/tmp/x", () => home)).toBe("/tmp/x");
  });

  it("resolvesStateDirFromEnv", () => {
    const home = path.join(os.tmpdir(), "clawdbot-test-home");
    const env = { OPENCLAW_STATE_DIR: "~/state-test" } as unknown as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => home)).toBe(path.join(home, "state-test"));
  });

  it("prefersOpenclawWhenPresent", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-projectfs-"));
    const home = tempDir;
    const openclawDir = path.join(home, ".openclaw");
    const clawdbotDir = path.join(home, ".clawdbot");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.mkdirSync(clawdbotDir, { recursive: true });
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => home)).toBe(openclawDir);
  });

  it("prefersMoltbotWhenOpenclawMissing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-projectfs-"));
    const home = tempDir;
    const moltbotDir = path.join(home, ".moltbot");
    fs.mkdirSync(moltbotDir, { recursive: true });
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => home)).toBe(moltbotDir);
  });

  it("resolvesAgentCanvasDirFromEnv", () => {
    const home = path.join(os.tmpdir(), "clawdbot-test-home");
    const env = { OPENCLAW_STATE_DIR: "~/state-test" } as unknown as NodeJS.ProcessEnv;
    expect(resolveAgentCanvasDir(env, () => home)).toBe(
      path.join(home, "state-test", "openclaw-studio")
    );
  });

  it("resolvesAgentCanvasDirPrefersOpenclaw", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-projectfs-"));
    const home = tempDir;
    const openclawDir = path.join(home, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(resolveAgentCanvasDir(env, () => home)).toBe(
      path.join(openclawDir, "openclaw-studio")
    );
  });

  it("deleteDirIfExistsRemovesDirectory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-projectfs-"));
    const warnings: string[] = [];
    deleteDirIfExists(tempDir, "Temp dir", warnings);
    expect(fs.existsSync(tempDir)).toBe(false);
    expect(warnings).toEqual([]);
  });
});

describe("collectAgentIdsAndDeleteArtifacts", () => {
  const createTile = (agentId: string): ProjectTile => ({
    id: "tile-1",
    name: "Tile",
    agentId,
    role: "coding",
    sessionKey: `agent:${agentId}:main`,
    workspacePath: `/tmp/worktrees/${agentId}`,
    archivedAt: null,
    model: "openai-codex/gpt-5.2-codex",
    thinkingLevel: null,
    avatarSeed: agentId,
    position: { x: 0, y: 0 },
    size: { width: 420, height: 520 },
  });

  it("deletes agent artifacts and returns ids", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-projectfs-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    const projectId = "project-1";
    const agentId = "agent-1";
    const workspaceDir = path.join(
      tempDir,
      "openclaw-studio",
      "worktrees",
      projectId,
      agentId
    );
    const stateDir = path.join(tempDir, "agents", agentId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });

    const warnings: string[] = [];
    const ids = collectAgentIdsAndDeleteArtifacts(projectId, [createTile(agentId)], warnings);

    expect(ids).toEqual([agentId]);
    expect(warnings).toEqual([]);
    expect(fs.existsSync(workspaceDir)).toBe(false);
    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("warns when agentId is missing", () => {
    const warnings: string[] = [];
    const ids = collectAgentIdsAndDeleteArtifacts("project-1", [createTile("")], warnings);

    expect(ids).toEqual([]);
    expect(warnings).toEqual([
      "Missing agentId for tile tile-1; skipped agent cleanup.",
    ]);
  });
});
