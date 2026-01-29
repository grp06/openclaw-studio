import { afterEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WORKSPACE_FILE_NAMES } from "@/lib/projects/workspaceFiles";
import { provisionWorkspaceFiles, readWorkspaceFile } from "@/lib/projects/workspaceFiles.server";

const createTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-workspace-"));

let tempDir: string | null = null;

const cleanup = () => {
  if (!tempDir) return;
  fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
};

afterEach(cleanup);

describe("workspaceFiles", () => {
  it("provisionWorkspaceFiles creates all named files", () => {
    tempDir = createTempDir();
    provisionWorkspaceFiles(tempDir);

    for (const name of WORKSPACE_FILE_NAMES) {
      const filePath = path.join(tempDir, name);
      const stat = fs.statSync(filePath);
      expect(stat.isFile()).toBe(true);
    }
  });

  it("provisionWorkspaceFiles removes bootstrap", () => {
    tempDir = createTempDir();
    const bootstrapPath = path.join(tempDir, "BOOTSTRAP.md");
    fs.writeFileSync(bootstrapPath, "seed", "utf8");

    provisionWorkspaceFiles(tempDir);

    expect(fs.existsSync(bootstrapPath)).toBe(false);
  });

  it("readWorkspaceFile reports missing files", () => {
    tempDir = createTempDir();
    const result = readWorkspaceFile(tempDir, "AGENTS.md");

    expect(result).toEqual({ name: "AGENTS.md", content: "", exists: false });
  });
});
