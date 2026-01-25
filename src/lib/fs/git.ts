import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GITIGNORE_LINES = [".env", ".env.*", "!.env.example"];

export const ensureGitRepo = (dir: string): { warnings: string[] } => {
  if (fs.existsSync(dir)) {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} exists and is not a directory.`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  const gitDir = path.join(dir, ".git");
  if (!fs.existsSync(gitDir)) {
    const result = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(
        stderr ? `git init failed in ${dir}: ${stderr}` : `git init failed in ${dir}.`
      );
    }
  }

  const gitignorePath = path.join(dir, ".gitignore");
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const existingLines = existing.split(/\r?\n/);
  const missing = GITIGNORE_LINES.filter((line) => !existingLines.includes(line));
  if (missing.length > 0) {
    let next = existing;
    if (next.length > 0 && !next.endsWith("\n")) {
      next += "\n";
    }
    next += `${missing.join("\n")}\n`;
    fs.writeFileSync(gitignorePath, next, "utf8");
  }

  return { warnings: [] };
};
