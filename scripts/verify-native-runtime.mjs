import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const mode = process.argv.includes("--repair") ? "repair" : "check";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath || "";
const bundledNpmCliPath = path.resolve(
  path.dirname(process.execPath),
  "..",
  "lib",
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);

const log = (message) => {
  console.info(`[native-runtime] ${message}`);
};

const resolvePathEnvKey = () => {
  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === "path") return key;
  }
  return "PATH";
};

const resolveSpawnEnv = () => {
  const pathKey = resolvePathEnvKey();
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const nodeBinDir = path.dirname(process.execPath);
  const existingPath = process.env[pathKey] || "";
  const prefixedPath = existingPath
    ? `${nodeBinDir}${pathDelimiter}${existingPath}`
    : nodeBinDir;
  return {
    ...process.env,
    [pathKey]: prefixedPath,
    npm_config_scripts_prepend_node_path: "true",
  };
};

const getErrorCode = (error) => {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const code = error.code;
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase();
};

const getErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error ?? "unknown_error");

const isNativeMismatchError = (error, message) => {
  const code = getErrorCode(error);
  const normalized = message.toLowerCase();
  const hasModuleVersionSignal =
    normalized.includes("node_module_version") ||
    normalized.includes("compiled against a different node.js version");
  const hasBetterSqliteSignal =
    normalized.includes("better_sqlite3.node") || normalized.includes("better-sqlite3");
  if (!hasModuleVersionSignal || !hasBetterSqliteSignal) return false;
  return code.length === 0 || code === "ERR_DLOPEN_FAILED";
};

const isMissingBetterSqliteModule = (error, message) => {
  const code = getErrorCode(error);
  const normalized = message.toLowerCase();
  if (!normalized.includes("better-sqlite3")) return false;
  if (code === "MODULE_NOT_FOUND") return true;
  return normalized.includes("cannot find module");
};

const printRemediation = () => {
  console.error("[native-runtime] remediation: npm rebuild better-sqlite3");
  console.error("[native-runtime] remediation: npm install");
};

const verifyLoad = () => {
  try {
    const BetterSqlite3 = require("better-sqlite3");
    const db = new BetterSqlite3(":memory:");
    db.prepare("SELECT 1").get();
    db.close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error,
      message: getErrorMessage(error),
    };
  }
};

const rebuildBetterSqlite = () => {
  const spawnEnv = resolveSpawnEnv();
  if (fs.existsSync(bundledNpmCliPath)) {
    const viaBundledNpm = spawnSync(
      process.execPath,
      [bundledNpmCliPath, "rebuild", "better-sqlite3"],
      {
        stdio: "inherit",
        env: spawnEnv,
      }
    );
    if (viaBundledNpm.status === 0) return true;
  }

  if (npmExecPath.trim()) {
    const viaExecPath = spawnSync(
      process.execPath,
      [npmExecPath, "rebuild", "better-sqlite3"],
      {
        stdio: "inherit",
        env: spawnEnv,
      }
    );
    if (viaExecPath.status === 0) return true;
  }
  const viaPath = spawnSync(npmCommand, ["rebuild", "better-sqlite3"], {
    stdio: "inherit",
    env: spawnEnv,
  });
  return viaPath.status === 0;
};

log(`mode=${mode}`);
log(`node=${process.version} abi=${process.versions.modules}`);
log(`node_exec=${process.execPath}`);

const firstPass = verifyLoad();
if (firstPass.ok) {
  log("better-sqlite3 load: ok");
  process.exit(0);
}

if (!isNativeMismatchError(firstPass.error, firstPass.message)) {
  if (isMissingBetterSqliteModule(firstPass.error, firstPass.message)) {
    console.error(`[native-runtime] better-sqlite3 module is missing: ${firstPass.message}`);
    printRemediation();
    process.exit(1);
  }
  console.error(`[native-runtime] better-sqlite3 load failed: ${firstPass.message}`);
  printRemediation();
  process.exit(1);
}

console.error(`[native-runtime] detected native ABI mismatch: ${firstPass.message}`);

if (mode !== "repair") {
  printRemediation();
  process.exit(1);
}

log("attempting rebuild: npm rebuild better-sqlite3");
if (!rebuildBetterSqlite()) {
  console.error("[native-runtime] rebuild failed");
  printRemediation();
  process.exit(1);
}

const secondPass = verifyLoad();
if (!secondPass.ok) {
  console.error(`[native-runtime] better-sqlite3 still failing after rebuild: ${secondPass.message}`);
  printRemediation();
  process.exit(1);
}

log("better-sqlite3 load: ok (after rebuild)");
