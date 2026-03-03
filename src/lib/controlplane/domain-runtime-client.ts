import type { AgentFileName } from "@/lib/agents/agentFiles";
import type { GatewayModelChoice, GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import { fetchJson } from "@/lib/http";
import type {
  CronJobCreateInput,
  CronJobSummary,
  CronRunResult,
} from "@/lib/cron/types";
import type { SkillStatusReport } from "@/lib/skills/types";

type Envelope<T> = {
  ok?: boolean;
  payload?: T;
  error?: string;
};

type SessionsListEntry = {
  key?: string;
  updatedAt?: number | null;
  origin?: { label?: string | null } | null;
};

type SessionsListResult = {
  sessions?: SessionsListEntry[];
};

type ChatHistoryResult = {
  messages?: Record<string, unknown>[];
};

const unwrapPayload = <T>(result: Envelope<T>): T => {
  if (result && result.ok === true && "payload" in result) {
    return result.payload as T;
  }
  throw new Error(result?.error ?? "Request failed.");
};

export const loadDomainConfigSnapshot = async (): Promise<GatewayModelPolicySnapshot> => {
  const result = await fetchJson<Envelope<GatewayModelPolicySnapshot>>("/api/runtime/config", {
    cache: "no-store",
  });
  return unwrapPayload(result);
};

export const loadDomainModels = async (): Promise<GatewayModelChoice[]> => {
  const result = await fetchJson<Envelope<{ models?: GatewayModelChoice[] }>>("/api/runtime/models", {
    cache: "no-store",
  });
  const payload = unwrapPayload(result);
  return Array.isArray(payload.models) ? payload.models : [];
};

export const loadDomainSkillStatus = async (agentId: string): Promise<SkillStatusReport> => {
  const encodedAgentId = encodeURIComponent(agentId.trim());
  const result = await fetchJson<Envelope<SkillStatusReport>>(
    `/api/runtime/skills/status?agentId=${encodedAgentId}`,
    { cache: "no-store" }
  );
  return unwrapPayload(result);
};

export const installDomainSkill = async (params: {
  name: string;
  installId: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string; stdout: string; stderr: string; code: number | null; warnings?: string[] }> => {
  const result = await fetchJson<Envelope<{ ok: boolean; message: string; stdout: string; stderr: string; code: number | null; warnings?: string[] }>>(
    "/api/intents/skills-install",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
  return unwrapPayload(result);
};

export const updateDomainSkill = async (params: {
  skillKey: string;
  enabled?: boolean;
  apiKey?: string;
}): Promise<{ ok: boolean; skillKey: string; config: Record<string, unknown> }> => {
  const result = await fetchJson<Envelope<{ ok: boolean; skillKey: string; config: Record<string, unknown> }>>(
    "/api/intents/skills-update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
  return unwrapPayload(result);
};

export const setDomainAgentSkillsAllowlist = async (params: {
  agentId: string;
  mode: "all" | "none" | "allowlist";
  skillNames?: string[];
}): Promise<void> => {
  const result = await fetchJson<Envelope<{ updated: boolean }>>("/api/intents/agent-skills-allowlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  unwrapPayload(result);
};

export const listDomainCronJobs = async (params: {
  includeDisabled?: boolean;
} = {}): Promise<{ jobs: CronJobSummary[] }> => {
  const includeDisabled = params.includeDisabled ?? true;
  const result = await fetchJson<Envelope<{ jobs?: CronJobSummary[] }>>(
    `/api/runtime/cron?includeDisabled=${includeDisabled ? "true" : "false"}`,
    { cache: "no-store" }
  );
  const payload = unwrapPayload(result);
  return { jobs: Array.isArray(payload.jobs) ? payload.jobs : [] };
};

export const createDomainCronJob = async (input: CronJobCreateInput): Promise<CronJobSummary> => {
  const result = await fetchJson<Envelope<CronJobSummary>>("/api/intents/cron-add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrapPayload(result);
};

export const runDomainCronJobNow = async (jobId: string): Promise<CronRunResult> => {
  const result = await fetchJson<Envelope<CronRunResult>>("/api/intents/cron-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: jobId.trim() }),
  });
  return unwrapPayload(result);
};

export const removeDomainCronJob = async (jobId: string): Promise<{ ok: true; removed: boolean } | { ok: false; removed: false }> => {
  const result = await fetchJson<Envelope<{ ok: true; removed: boolean } | { ok: false; removed: false }>>(
    "/api/intents/cron-remove",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId.trim() }),
    }
  );
  return unwrapPayload(result);
};

export const readDomainAgentFile = async (params: {
  agentId: string;
  name: AgentFileName;
}): Promise<{ exists: boolean; content: string }> => {
  const query = new URLSearchParams({
    agentId: params.agentId.trim(),
    name: params.name,
  });
  const result = await fetchJson<Envelope<{ file?: { missing?: unknown; content?: unknown } }>>(
    `/api/runtime/agent-file?${query.toString()}`,
    { cache: "no-store" }
  );
  const payload = unwrapPayload(result);
  const file = payload?.file;
  const record = file && typeof file === "object" ? (file as Record<string, unknown>) : null;
  const missing = record?.missing === true;
  const content = typeof record?.content === "string" ? record.content : "";
  return { exists: !missing, content };
};

export const writeDomainAgentFile = async (params: {
  agentId: string;
  name: AgentFileName;
  content: string;
}): Promise<void> => {
  const result = await fetchJson<Envelope<unknown>>("/api/intents/agent-file-set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  unwrapPayload(result);
};

export const listDomainSessions = async (params: {
  agentId: string;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  search?: string;
  limit?: number;
}): Promise<SessionsListResult> => {
  const query = new URLSearchParams();
  query.set("agentId", params.agentId.trim());
  query.set("includeGlobal", params.includeGlobal === true ? "true" : "false");
  query.set("includeUnknown", params.includeUnknown === true ? "true" : "false");
  if (params.search?.trim()) {
    query.set("search", params.search.trim());
  }
  if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
    query.set("limit", String(Math.floor(params.limit)));
  }

  const result = await fetchJson<Envelope<SessionsListResult>>(`/api/runtime/sessions?${query.toString()}`, {
    cache: "no-store",
  });
  return unwrapPayload(result);
};

export const loadDomainChatHistory = async (params: {
  sessionKey: string;
  limit?: number;
}): Promise<ChatHistoryResult> => {
  const query = new URLSearchParams({ sessionKey: params.sessionKey.trim() });
  if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
    query.set("limit", String(Math.floor(params.limit)));
  }
  const result = await fetchJson<Envelope<ChatHistoryResult>>(
    `/api/runtime/chat-history?${query.toString()}`,
    { cache: "no-store" }
  );
  return unwrapPayload(result);
};
