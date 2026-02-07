import { AGENT_FILE_NAMES, type AgentFileName } from "@/lib/agents/agentFiles";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

type AgentsFilesGetResponse = {
  file?: { name?: unknown; missing?: unknown; content?: unknown };
};

type AgentsListResult = {
  defaultId: string;
  agents: Array<{ id: string }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readAgentsFilesGet = async (params: {
  client: GatewayClient;
  agentId: string;
  name: AgentFileName;
}): Promise<{ exists: boolean; content: string }> => {
  const response = await params.client.call<AgentsFilesGetResponse>("agents.files.get", {
    agentId: params.agentId,
    name: params.name,
  });
  const file = response?.file;
  const fileRecord = isRecord(file) ? file : null;
  const missing = fileRecord?.missing === true;
  const content = typeof fileRecord?.content === "string" ? fileRecord.content : "";
  return { exists: !missing, content };
};

const resolveTemplateAgentId = async (params: {
  client: GatewayClient;
  targetAgentId: string;
}): Promise<string> => {
  const result = await params.client.call<AgentsListResult>("agents.list", {});
  const defaultId = typeof result.defaultId === "string" ? result.defaultId.trim() : "";
  if (defaultId && defaultId !== params.targetAgentId) {
    return defaultId;
  }
  const agents = Array.isArray(result.agents) ? result.agents : [];
  const hasMain = agents.some((agent) => agent?.id === "main");
  if (hasMain && params.targetAgentId !== "main") {
    return "main";
  }
  const fallback = agents.find((agent) => agent?.id && agent.id !== params.targetAgentId)?.id ?? "";
  if (fallback) return fallback;
  throw new Error("No template agent available to bootstrap brain files.");
};

export type BootstrapAgentBrainFilesResult = {
  templateAgentId: string;
  updated: AgentFileName[];
  skipped: AgentFileName[];
};

export const bootstrapAgentBrainFilesFromTemplate = async (params: {
  client: GatewayClient;
  agentId: string;
  templateAgentId?: string | null;
  fileNames?: readonly AgentFileName[];
}): Promise<BootstrapAgentBrainFilesResult> => {
  const targetAgentId = params.agentId.trim();
  if (!targetAgentId) {
    throw new Error("Agent id is required to bootstrap brain files.");
  }
  const resolvedNames = params.fileNames ?? AGENT_FILE_NAMES;
  const templateAgentId =
    params.templateAgentId?.trim() || (await resolveTemplateAgentId({ client: params.client, targetAgentId }));
  if (templateAgentId === targetAgentId) {
    throw new Error("Template agent cannot be the same as the target agent.");
  }

  const reads = await Promise.all(
    resolvedNames.map(async (name) => {
      const [target, template] = await Promise.all([
        readAgentsFilesGet({ client: params.client, agentId: targetAgentId, name }),
        readAgentsFilesGet({ client: params.client, agentId: templateAgentId, name }),
      ]);
      return { name, target, template };
    })
  );

  const toUpdate: Array<{ name: AgentFileName; content: string }> = [];
  const skipped: AgentFileName[] = [];

  for (const entry of reads) {
    const targetBlank = !entry.target.exists || entry.target.content.trim().length === 0;
    const templateBlank = !entry.template.exists || entry.template.content.trim().length === 0;
    if (!targetBlank) {
      skipped.push(entry.name);
      continue;
    }
    if (templateBlank) {
      skipped.push(entry.name);
      continue;
    }
    toUpdate.push({ name: entry.name, content: entry.template.content });
  }

  await Promise.all(
    toUpdate.map(async (entry) => {
      await params.client.call("agents.files.set", {
        agentId: targetAgentId,
        name: entry.name,
        content: entry.content,
      });
    })
  );

  return {
    templateAgentId,
    updated: toUpdate.map((entry) => entry.name),
    skipped,
  };
};

