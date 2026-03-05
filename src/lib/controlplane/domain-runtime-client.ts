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

export type DomainAgentHistoryView = "semantic" | "raw";
export type DomainChatHistoryMessage = Record<string, unknown>;

export type DomainAgentHistoryResult = {
  enabled: boolean;
  agentId: string;
  view: DomainAgentHistoryView;
  messages: DomainChatHistoryMessage[];
  hasMore: boolean;
  semanticTurnsIncluded: number;
  windowTruncated: boolean;
  gatewayLimit: number;
  gatewayCapped: boolean;
  freshness?: unknown;
  error?: string;
};

export type DomainSessionPreviewItem = {
  role: "user" | "assistant";
  text: string;
  timestamp?: number | string;
};

export type DomainSessionPreviewResult = {
  enabled: boolean;
  agentId: string;
  sessionKey: string;
  items: DomainSessionPreviewItem[];
  freshness?: unknown;
  error?: string;
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

export const loadDomainAgentHistoryWindow = async (params: {
  agentId: string;
  sessionKey: string;
  view?: DomainAgentHistoryView;
  turnLimit?: number;
  scanLimit?: number;
  limit?: number;
  includeThinking?: boolean;
  includeTools?: boolean;
  signal?: AbortSignal;
}): Promise<DomainAgentHistoryResult> => {
  const agentId = params.agentId.trim();
  if (!agentId) {
    throw new Error("agentId is required.");
  }
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    throw new Error("sessionKey is required.");
  }
  const view = params.view === "raw" ? "raw" : "semantic";
  const query = new URLSearchParams();
  query.set("sessionKey", sessionKey);
  query.set("view", view);
  const turnLimit =
    typeof params.turnLimit === "number" && Number.isFinite(params.turnLimit) && params.turnLimit > 0
      ? Math.floor(params.turnLimit)
      : undefined;
  if (typeof turnLimit === "number") {
    query.set("turnLimit", String(turnLimit));
  }
  const scanLimit =
    typeof params.scanLimit === "number" && Number.isFinite(params.scanLimit) && params.scanLimit > 0
      ? Math.floor(params.scanLimit)
      : undefined;
  if (typeof scanLimit === "number") {
    query.set("scanLimit", String(scanLimit));
  }
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : undefined;
  if (typeof limit === "number") {
    query.set("limit", String(limit));
  }
  if (typeof params.includeThinking === "boolean") {
    query.set("includeThinking", params.includeThinking ? "1" : "0");
  }
  if (typeof params.includeTools === "boolean") {
    query.set("includeTools", params.includeTools ? "1" : "0");
  }

  return await fetchJson<DomainAgentHistoryResult>(
    `/api/runtime/agents/${encodeURIComponent(agentId)}/history?${query.toString()}`,
    { cache: "no-store", signal: params.signal }
  );
};

export const loadDomainAgentPreviewWindow = async (params: {
  agentId: string;
  sessionKey: string;
  limit?: number;
  maxChars?: number;
  signal?: AbortSignal;
}): Promise<DomainSessionPreviewResult> => {
  const agentId = params.agentId.trim();
  if (!agentId) {
    throw new Error("agentId is required.");
  }
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    throw new Error("sessionKey is required.");
  }
  const query = new URLSearchParams();
  query.set("sessionKey", sessionKey);
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : undefined;
  if (typeof limit === "number") {
    query.set("limit", String(limit));
  }
  const maxChars =
    typeof params.maxChars === "number" &&
    Number.isFinite(params.maxChars) &&
    params.maxChars > 0
      ? Math.floor(params.maxChars)
      : undefined;
  if (typeof maxChars === "number") {
    query.set("maxChars", String(maxChars));
  }
  return await fetchJson<DomainSessionPreviewResult>(
    `/api/runtime/agents/${encodeURIComponent(agentId)}/preview?${query.toString()}`,
    { cache: "no-store", signal: params.signal }
  );
};
