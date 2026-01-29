import fs from "node:fs";
import path from "node:path";

import { WORKSPACE_FILE_NAMES, type WorkspaceFileName } from "./workspaceFiles";

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

export const isWorkspaceFileName = (value: string): value is WorkspaceFileName =>
  WORKSPACE_FILE_NAMES.includes(value as WorkspaceFileName);

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
