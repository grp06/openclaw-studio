import { NextResponse } from "next/server";

import {
  ensureDomainIntentRuntime,
  parseIntentBody,
} from "@/lib/controlplane/intent-route";
import { ControlPlaneGatewayError } from "@/lib/controlplane/openclaw-adapter";
import type { ControlPlaneRuntime } from "@/lib/controlplane/runtime";

type AgentSkillsAccessMode = "all" | "none" | "allowlist";

type ConfigAgentEntry = Record<string, unknown> & { id: string };
type GatewayConfigSnapshot = {
  config?: unknown;
  hash?: string;
  exists?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readConfigAgentList = (
  config: Record<string, unknown> | undefined
): ConfigAgentEntry[] => {
  if (!config) return [];
  const agents = isRecord(config.agents) ? config.agents : null;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  return list.filter((entry): entry is ConfigAgentEntry => {
    if (!isRecord(entry)) return false;
    if (typeof entry.id !== "string") return false;
    return entry.id.trim().length > 0;
  });
};

const writeConfigAgentList = (
  config: Record<string, unknown>,
  list: ConfigAgentEntry[]
): Record<string, unknown> => {
  const agents = isRecord(config.agents) ? { ...config.agents } : {};
  return { ...config, agents: { ...agents, list } };
};

const upsertConfigAgentEntry = (
  list: ConfigAgentEntry[],
  agentId: string,
  updater: (entry: ConfigAgentEntry) => ConfigAgentEntry
): { list: ConfigAgentEntry[]; entry: ConfigAgentEntry } => {
  let updatedEntry: ConfigAgentEntry | null = null;
  const nextList = list.map((entry) => {
    if (entry.id !== agentId) return entry;
    const next = updater({ ...entry, id: agentId });
    updatedEntry = next;
    return next;
  });
  if (!updatedEntry) {
    updatedEntry = updater({ id: agentId });
    nextList.push(updatedEntry);
  }
  return { list: nextList, entry: updatedEntry };
};

const normalizeSkillAllowlistInput = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const next = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(next)).sort((a, b) => a.localeCompare(b));
};

const areStringArraysEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const buildAgentSkillsConfig = (params: {
  baseConfig: Record<string, unknown>;
  agentId: string;
  mode: AgentSkillsAccessMode;
  skillNames?: string[];
}): Record<string, unknown> => {
  const list = readConfigAgentList(params.baseConfig);
  const currentEntry = list.find((entry) => entry.id === params.agentId);
  const hasEntry = Boolean(currentEntry);
  const currentRawSkills = currentEntry?.skills;

  if (params.mode === "all") {
    if (!hasEntry) {
      return params.baseConfig;
    }
    if (!Object.prototype.hasOwnProperty.call(currentEntry, "skills")) {
      return params.baseConfig;
    }
  }

  if (params.mode === "none" && Array.isArray(currentRawSkills) && currentRawSkills.length === 0) {
    return params.baseConfig;
  }

  if (params.mode === "allowlist") {
    const rawSkills = params.skillNames;
    if (!rawSkills) {
      throw new Error("Skills allowlist is required when mode is allowlist.");
    }
    const normalizedNext = normalizeSkillAllowlistInput(rawSkills);
    if (Array.isArray(currentRawSkills)) {
      const normalizedCurrent = normalizeSkillAllowlistInput(currentRawSkills);
      if (areStringArraysEqual(normalizedCurrent, normalizedNext)) {
        return params.baseConfig;
      }
    }
  }

  const { list: nextList } = upsertConfigAgentEntry(list, params.agentId, (entry) => {
    const next: ConfigAgentEntry = { ...entry, id: params.agentId };
    if (params.mode === "all") {
      if ("skills" in next) {
        delete next.skills;
      }
      return next;
    }
    if (params.mode === "none") {
      next.skills = [];
      return next;
    }
    const rawSkills = params.skillNames;
    if (!rawSkills) {
      throw new Error("Skills allowlist is required when mode is allowlist.");
    }
    next.skills = normalizeSkillAllowlistInput(rawSkills);
    return next;
  });
  return writeConfigAgentList(params.baseConfig, nextList);
};

const isConfigConflict = (err: unknown): boolean => {
  if (!(err instanceof ControlPlaneGatewayError)) return false;
  if (err.code.trim().toUpperCase() !== "INVALID_REQUEST") return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("basehash") ||
    message.includes("base hash") ||
    message.includes("changed since last load") ||
    message.includes("re-run config.get")
  );
};

const mapIntentError = (error: unknown): NextResponse => {
  if (error instanceof ControlPlaneGatewayError) {
    if (error.code.trim().toUpperCase() === "GATEWAY_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: error.message,
          code: "GATEWAY_UNAVAILABLE",
          reason: "gateway_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: 400 }
    );
  }
  const message = error instanceof Error ? error.message : "intent_failed";
  return NextResponse.json({ error: message }, { status: 500 });
};

const applySkillsMode = async (params: {
  runtime: ControlPlaneRuntime;
  agentId: string;
  mode: AgentSkillsAccessMode;
  skillNames?: string[];
  attempt?: number;
}): Promise<void> => {
  const attempt = params.attempt ?? 0;
  const snapshot = await params.runtime.callGateway<GatewayConfigSnapshot>("config.get", {});
  const baseConfig = isRecord(snapshot.config) ? snapshot.config : {};
  const nextConfig = buildAgentSkillsConfig({
    baseConfig,
    agentId: params.agentId,
    mode: params.mode,
    skillNames: params.skillNames,
  });
  if (nextConfig === baseConfig) {
    return;
  }

  const payload: Record<string, unknown> = {
    raw: JSON.stringify(nextConfig, null, 2),
  };
  const requiresBaseHash = snapshot.exists !== false;
  const baseHash = requiresBaseHash ? snapshot.hash?.trim() : undefined;
  if (requiresBaseHash && !baseHash) {
    throw new Error("Gateway config hash unavailable; re-run config.get.");
  }
  if (baseHash) {
    payload.baseHash = baseHash;
  }

  try {
    await params.runtime.callGateway("config.set", payload);
  } catch (error) {
    if (attempt >= 1 || !isConfigConflict(error)) {
      throw error;
    }
    await applySkillsMode({ ...params, attempt: attempt + 1 });
  }
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const agentId = typeof bodyOrError.agentId === "string" ? bodyOrError.agentId.trim() : "";
  const modeRaw = typeof bodyOrError.mode === "string" ? bodyOrError.mode.trim() : "";
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }
  if (modeRaw !== "all" && modeRaw !== "none" && modeRaw !== "allowlist") {
    return NextResponse.json({ error: "mode must be one of: all, none, allowlist." }, { status: 400 });
  }

  const mode = modeRaw as AgentSkillsAccessMode;
  const skillNames = normalizeSkillAllowlistInput(bodyOrError.skillNames);
  if (mode === "allowlist" && skillNames.length === 0) {
    return NextResponse.json(
      { error: "skillNames must contain at least one value when mode is allowlist." },
      { status: 400 }
    );
  }

  const runtimeOrError = await ensureDomainIntentRuntime();
  if (runtimeOrError instanceof Response) {
    return runtimeOrError as NextResponse;
  }

  try {
    await applySkillsMode({
      runtime: runtimeOrError,
      agentId,
      mode,
      ...(mode === "allowlist" ? { skillNames } : {}),
    });
    return NextResponse.json({ ok: true, payload: { updated: true } });
  } catch (error) {
    return mapIntentError(error);
  }
}
