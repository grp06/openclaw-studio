import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WORKSPACE_FILE_NAMES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "TOOLS.md",
  "MEMORY.md",
];
const WORKSPACE_IGNORE_ENTRIES = [...WORKSPACE_FILE_NAMES, "memory/"];
const STORE_VERSION = 3;
const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moltbot"];
const NEW_STATE_DIRNAME = ".openclaw";
const CONFIG_FILENAME = "openclaw.json";
const LEGACY_CONFIG_FILENAMES = ["clawdbot.json", "moltbot.json"];

const resolveUserPath = (input, homedir = os.homedir) => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
};

const resolveStateDir = (env = process.env, homedir = os.homedir) => {
  const override =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override, homedir);
  const newDir = path.join(homedir(), NEW_STATE_DIRNAME);
  const legacyDirs = LEGACY_STATE_DIRNAMES.map((dir) => path.join(homedir(), dir));
  if (fs.existsSync(newDir)) return newDir;
  const existingLegacy = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
  return existingLegacy ?? newDir;
};

const resolveConfigPathCandidates = (env = process.env, homedir = os.homedir) => {
  const explicit =
    env.OPENCLAW_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (explicit) return [resolveUserPath(explicit, homedir)];

  const candidates = [];
  const stateDir =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (stateDir) {
    const resolved = resolveUserPath(stateDir, homedir);
    candidates.push(path.join(resolved, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(resolved, name)));
  }

  const defaultDirs = [
    path.join(homedir(), NEW_STATE_DIRNAME),
    ...LEGACY_STATE_DIRNAMES.map((dir) => path.join(homedir(), dir)),
  ];
  for (const dir of defaultDirs) {
    candidates.push(path.join(dir, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(dir, name)));
  }
  return candidates;
};

const resolveAgentCanvasDir = () => path.join(resolveStateDir(), "openclaw-studio");

const resolveAgentWorktreeDir = (projectId, agentId) =>
  path.join(resolveAgentCanvasDir(), "worktrees", projectId, agentId);

const parseAgentIdFromSessionKey = (sessionKey, fallback = "main") => {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : fallback;
};

const parseJsonLoose = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned);
  }
};

const loadStore = (storePath) => {
  const raw = fs.readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.projects)) {
    throw new Error(`Workspaces store is invalid at ${storePath}.`);
  }
  return parsed;
};

const normalizeStore = (store) => {
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const normalizedProjects = projects.map((project) => {
    const projectId = typeof project.id === "string" ? project.id : "";
    const tiles = Array.isArray(project.tiles) ? project.tiles : [];
    return {
      ...project,
      archivedAt: typeof project.archivedAt === "number" ? project.archivedAt : null,
      tiles: tiles.map((tile) => {
        const agentId =
          typeof tile.agentId === "string" && tile.agentId.trim()
            ? tile.agentId.trim()
            : parseAgentIdFromSessionKey(
                typeof tile.sessionKey === "string" ? tile.sessionKey : ""
              );
        return {
          ...tile,
          agentId,
          role: typeof tile.role === "string" ? tile.role : "coding",
          workspacePath:
            typeof tile.workspacePath === "string" && tile.workspacePath.trim()
              ? tile.workspacePath
              : resolveAgentWorktreeDir(projectId, agentId),
          archivedAt: typeof tile.archivedAt === "number" ? tile.archivedAt : null,
        };
      }),
    };
  });
  const activeProjectId =
    typeof store.activeProjectId === "string" &&
    normalizedProjects.some(
      (project) => project.id === store.activeProjectId && !project.archivedAt
    )
      ? store.activeProjectId
      : normalizedProjects.find((project) => !project.archivedAt)?.id ?? null;
  return {
    version: STORE_VERSION,
    activeProjectId,
    projects: normalizedProjects,
  };
};

const resolveGitDir = (worktreeDir) => {
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
  return path.resolve(worktreeDir, match[1].trim());
};

const ensureWorktreeIgnores = (worktreeDir, files) => {
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

const ensureAgentWorktree = (repoPath, worktreeDir, branchName) => {
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
    return;
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
};

const ensureWorkspaceFiles = (workspaceDir) => {
  fs.mkdirSync(workspaceDir, { recursive: true });
  for (const name of WORKSPACE_FILE_NAMES) {
    const filePath = path.join(workspaceDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "", "utf8");
    }
  }
  fs.mkdirSync(path.join(workspaceDir, "memory"), { recursive: true });
};

const copyWorkspaceFile = (fromPath, toPath) => {
  if (!fs.existsSync(fromPath)) return false;
  if (fs.existsSync(toPath)) {
    const current = fs.readFileSync(toPath, "utf8");
    if (current.trim()) return false;
  }
  fs.copyFileSync(fromPath, toPath);
  return true;
};

const copyWorkspaceMemory = (fromDir, toDir) => {
  if (!fs.existsSync(fromDir)) return 0;
  fs.mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyWorkspaceMemory(fromPath, toPath);
    } else if (!fs.existsSync(toPath)) {
      fs.copyFileSync(fromPath, toPath);
      copied += 1;
    }
  }
  return copied;
};

const reserveLegacyPath = (targetPath) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let candidate = `${targetPath}.legacy-${stamp}`;
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${targetPath}.legacy-${stamp}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const ensureLegacyWorktreeSlot = (worktreeDir) => {
  if (!fs.existsSync(worktreeDir)) return null;
  if (fs.existsSync(path.join(worktreeDir, ".git"))) return null;
  const legacyPath = reserveLegacyPath(worktreeDir);
  fs.renameSync(worktreeDir, legacyPath);
  return legacyPath;
};

const readAgentList = (config) => {
  const agents = config.agents ?? {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  return list.filter((entry) => Boolean(entry && typeof entry === "object"));
};

const writeAgentList = (config, list) => {
  const agents = config.agents ?? {};
  agents.list = list;
  config.agents = agents;
};

const upsertAgentEntry = (config, entry) => {
  const list = readAgentList(config);
  let changed = false;
  let found = false;
  const next = list.map((item) => {
    if (item.id !== entry.agentId) return item;
    found = true;
    const nextItem = { ...item };
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

const loadClawdbotConfig = () => {
  const candidates = resolveConfigPathCandidates();
  const fallbackPath = path.join(resolveStateDir(), CONFIG_FILENAME);
  const configPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? fallbackPath;
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config at ${configPath}.`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  return { config: parseJsonLoose(raw), configPath };
};

const saveClawdbotConfig = (configPath, config) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
};

const migrate = () => {
  const stateDir = resolveStateDir();
  const storePath = path.join(stateDir, "openclaw-studio", "projects.json");
  if (!fs.existsSync(storePath)) {
    console.error(`Missing projects store at ${storePath}.`);
    process.exit(1);
  }

  const rawStore = loadStore(storePath);
  const store = normalizeStore(rawStore);

  const backupPath = `${storePath}.backup-${Date.now()}`;
  fs.copyFileSync(storePath, backupPath);

  const warnings = [];
  const errors = [];
  const legacyMoves = [];

  let config = null;
  let configPath = "";
  let configLoaded = false;
  try {
    const loaded = loadClawdbotConfig();
    config = loaded.config;
    configPath = loaded.configPath;
    configLoaded = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load config.";
    warnings.push(`Agent config not updated: ${message}`);
  }

  for (const project of store.projects) {
    const repoPath = typeof project.repoPath === "string" ? project.repoPath : "";
    for (const tile of project.tiles) {
      const agentId =
        typeof tile.agentId === "string" && tile.agentId.trim()
          ? tile.agentId.trim()
          : parseAgentIdFromSessionKey(tile.sessionKey ?? "");
      const worktreeDir = resolveAgentWorktreeDir(project.id, agentId);
      if (tile.workspacePath !== worktreeDir) {
        tile.workspacePath = worktreeDir;
      }
      const branchName = `agent/${agentId}`;
      let legacyPath = null;
      try {
        legacyPath = ensureLegacyWorktreeSlot(worktreeDir);
        if (legacyPath) {
          legacyMoves.push({ from: legacyPath, to: worktreeDir });
        }
        ensureAgentWorktree(repoPath, worktreeDir, branchName);
        ensureWorktreeIgnores(worktreeDir, WORKSPACE_IGNORE_ENTRIES);
        ensureWorkspaceFiles(worktreeDir);
        if (legacyPath) {
          for (const name of WORKSPACE_FILE_NAMES) {
            const fromPath = path.join(legacyPath, name);
            const toPath = path.join(worktreeDir, name);
            copyWorkspaceFile(fromPath, toPath);
          }
          copyWorkspaceMemory(path.join(legacyPath, "memory"), path.join(worktreeDir, "memory"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        errors.push(`Worktree migration failed for ${project.id}/${agentId}: ${message}`);
        continue;
      }

      if (configLoaded && config) {
        try {
          upsertAgentEntry(config, {
            agentId,
            agentName: tile.name ?? agentId,
            workspaceDir: worktreeDir,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          warnings.push(`Failed to update agent config for ${agentId}: ${message}`);
        }
      }
    }
  }

  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

  if (configLoaded && config && configPath) {
    saveClawdbotConfig(configPath, config);
  }

  if (legacyMoves.length > 0) {
    console.log("Legacy workspace directories renamed:");
    for (const move of legacyMoves) {
      console.log(`  ${move.from} -> ${move.to}`);
    }
  }
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  if (errors.length > 0) {
    console.error("Migration errors:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
  }

  console.log(`Migration complete. Store backup: ${backupPath}`);
};

migrate();
