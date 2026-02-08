import { loadStudioSettings } from "@/lib/studio/settings-store";
import { spawnSync } from "node:child_process";

const SSH_TARGET_ENV = "OPENCLAW_TASK_CONTROL_PLANE_SSH_TARGET";
const SSH_USER_ENV = "OPENCLAW_TASK_CONTROL_PLANE_SSH_USER";

export const resolveGatewaySshTarget = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredTarget = env[SSH_TARGET_ENV]?.trim() ?? "";
  const configuredUser = env[SSH_USER_ENV]?.trim() ?? "";

  if (configuredTarget) {
    if (configuredTarget.includes("@")) return configuredTarget;
    if (configuredUser) return `${configuredUser}@${configuredTarget}`;
    return configuredTarget;
  }

  const settings = loadStudioSettings();
  const gatewayUrl = settings.gateway?.url?.trim() ?? "";
  if (!gatewayUrl) {
    throw new Error(
      `Gateway URL is missing. Set it in Studio settings or set ${SSH_TARGET_ENV}.`
    );
  }
  let hostname: string;
  try {
    hostname = new URL(gatewayUrl).hostname;
  } catch {
    throw new Error(`Invalid gateway URL in studio settings: ${gatewayUrl}`);
  }
  if (!hostname) {
    throw new Error(`Invalid gateway URL in studio settings: ${gatewayUrl}`);
  }

  const user = configuredUser || "ubuntu";
  return `${user}@${hostname}`;
};

export const extractJsonErrorMessage = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const direct = record.error;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (direct && typeof direct === "object") {
      const nested = (direct as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    return null;
  } catch {
    return null;
  }
};

export const parseJsonOutput = (raw: string, label: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Command produced empty JSON output (${label}).`);
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`Command produced invalid JSON output (${label}).`);
  }
};

export const runSshJson = (params: {
  sshTarget: string;
  argv: string[];
  label: string;
  input?: string;
  fallbackMessage?: string;
}): unknown => {
  const result = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", params.sshTarget, ...params.argv],
    { encoding: "utf8", input: params.input }
  );
  if (result.error) {
    throw new Error(`Failed to execute ssh: ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    const stderrText = stderr.trim();
    const stdoutText = stdout.trim();
    const message =
      extractJsonErrorMessage(stdout) ??
      extractJsonErrorMessage(stderr) ??
      (stderrText ||
        stdoutText ||
        params.fallbackMessage ||
        `Command failed (${params.label}).`);
    throw new Error(message);
  }
  return parseJsonOutput(stdout, params.label);
};
