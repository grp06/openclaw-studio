import { afterEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WORKSPACE_FILE_NAMES,
  createWorkspaceFilesState,
  isWorkspaceFileName,
} from "@/lib/projects/workspaceFiles";
import {
  provisionWorkspaceFiles,
  readWorkspaceFile,
  readWorkspaceFiles,
  writeWorkspaceFiles,
} from "@/lib/projects/workspaceFiles.server";

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
  it("validatesWorkspaceFileNames", () => {
    expect(isWorkspaceFileName("AGENTS.md")).toBe(true);
    expect(isWorkspaceFileName("NOTES.md")).toBe(false);
  });

  it("createsWorkspaceFilesState", () => {
    const state = createWorkspaceFilesState();
    expect(Object.keys(state)).toEqual([...WORKSPACE_FILE_NAMES]);
    for (const name of WORKSPACE_FILE_NAMES) {
      expect(state[name]).toEqual({ content: "", exists: false });
    }
  });

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

  it("readWorkspaceFiles returns entries for all workspace files", () => {
    tempDir = createTempDir();
    provisionWorkspaceFiles(tempDir);

    const files = readWorkspaceFiles(tempDir);

    expect(files.map((file) => file.name)).toEqual([...WORKSPACE_FILE_NAMES]);
    for (const file of files) {
      expect(file.exists).toBe(true);
    }
  });

  it("writeWorkspaceFiles updates content and returns updated list", () => {
    tempDir = createTempDir();
    provisionWorkspaceFiles(tempDir);

    const result = writeWorkspaceFiles(tempDir, [
      { name: "AGENTS.md", content: "Hello" },
      { name: "USER.md", content: "Profile" },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const agents = result.files.find((file) => file.name === "AGENTS.md");
      const user = result.files.find((file) => file.name === "USER.md");
      expect(agents?.content).toBe("Hello");
      expect(user?.content).toBe("Profile");
    }
  });

  it("writeWorkspaceFiles rejects invalid names", () => {
    tempDir = createTempDir();
    provisionWorkspaceFiles(tempDir);

    const result = writeWorkspaceFiles(tempDir, [{ name: "NOTES.md", content: "" }]);

    expect(result).toEqual({ ok: false, error: "Invalid file name: NOTES.md" });
  });

  it("writeWorkspaceFiles rejects invalid content", () => {
    tempDir = createTempDir();
    provisionWorkspaceFiles(tempDir);

    const result = writeWorkspaceFiles(tempDir, [
      { name: "AGENTS.md", content: 123 },
    ]);

    expect(result).toEqual({ ok: false, error: "Invalid content for AGENTS.md." });
  });
});
