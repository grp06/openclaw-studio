import fs from "node:fs";
import path from "node:path";

import {
  WORKSPACE_FILE_NAMES,
  isWorkspaceFileName,
  type WorkspaceFileName,
} from "./workspaceFiles";

const ensureDir = (dir: string) => {
  if (fs.existsSync(dir)) {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} exists and is not a directory.`);
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
};

const ensureFile = (filePath: string, contents: string) => {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, contents, "utf8");
};

const deleteFileIfExists = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return;
  }
  fs.rmSync(filePath);
};

export const readWorkspaceFile = (workspaceDir: string, name: WorkspaceFileName) => {
  const filePath = path.join(workspaceDir, name);
  if (!fs.existsSync(filePath)) {
    return { name, content: "", exists: false };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${name} exists but is not a file.`);
  }
  return { name, content: fs.readFileSync(filePath, "utf8"), exists: true };
};

export const readWorkspaceFiles = (workspaceDir: string) =>
  WORKSPACE_FILE_NAMES.map((name) => readWorkspaceFile(workspaceDir, name));

export type WorkspaceFilesWriteResult =
  | { ok: true; files: Array<{ name: WorkspaceFileName; content: string; exists: boolean }> }
  | { ok: false; error: string };

export const writeWorkspaceFiles = (
  workspaceDir: string,
  files: Array<{ name: string; content: unknown }>
): WorkspaceFilesWriteResult => {
  for (const entry of files) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name || !isWorkspaceFileName(name)) {
      return { ok: false, error: `Invalid file name: ${entry?.name ?? ""}` };
    }
    if (typeof entry.content !== "string") {
      return { ok: false, error: `Invalid content for ${name}.` };
    }
  }

  for (const entry of files) {
    const name = entry.name as WorkspaceFileName;
    const filePath = path.join(workspaceDir, name);
    fs.writeFileSync(filePath, entry.content as string, "utf8");
  }

  return { ok: true, files: readWorkspaceFiles(workspaceDir) };
};

export const provisionWorkspaceFiles = (workspaceDir: string): { warnings: string[] } => {
  const warnings: string[] = [];
  ensureDir(workspaceDir);
  deleteFileIfExists(path.join(workspaceDir, "BOOTSTRAP.md"));

  for (const name of WORKSPACE_FILE_NAMES) {
    ensureFile(path.join(workspaceDir, name), "");
  }

  ensureDir(path.join(workspaceDir, "memory"));
  return { warnings };
};
