import { describe, expect, it, vi } from "vitest";
import { AGENT_FILE_NAMES } from "@/lib/agents/agentFiles";
import { bootstrapAgentBrainFilesFromTemplate } from "@/lib/gateway/agentFilesBootstrap";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

type FilesByAgent = Record<string, Record<string, { content: string; missing?: boolean }>>;

const createMockClient = (filesByAgent: FilesByAgent, defaultId = "main") => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });

      if (method === "agents.list") {
        return {
          defaultId,
          agents: Object.keys(filesByAgent).map((id) => ({ id })),
        };
      }

      if (method === "agents.files.get") {
        const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
        const agentId = typeof record.agentId === "string" ? record.agentId : "";
        const name = typeof record.name === "string" ? record.name : "";
        const entry = filesByAgent[agentId]?.[name];
        if (!entry || entry.missing) {
          return { file: { name, missing: true } };
        }
        return { file: { name, missing: false, content: entry.content } };
      }

      if (method === "agents.files.set") {
        const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
        const agentId = typeof record.agentId === "string" ? record.agentId : "";
        const name = typeof record.name === "string" ? record.name : "";
        const content = typeof record.content === "string" ? record.content : "";
        if (!filesByAgent[agentId]) filesByAgent[agentId] = {};
        filesByAgent[agentId][name] = { content };
        return { ok: true };
      }

      return {};
    }),
  } as unknown as GatewayClient;

  return { client, calls, filesByAgent };
};

describe("bootstrapAgentBrainFilesFromTemplate", () => {
  it("fills missing or empty target files from the template agent", async () => {
    const template: Record<string, { content: string }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: `template:${name}` }])
    );
    const target: Record<string, { content: string }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: "" }])
    );
    const store: FilesByAgent = {
      main: template,
      "new-agent": target,
    };

    const { client, filesByAgent } = createMockClient(store, "main");

    const result = await bootstrapAgentBrainFilesFromTemplate({ client, agentId: "new-agent" });

    expect(result.templateAgentId).toBe("main");
    expect(result.updated.length).toBe(AGENT_FILE_NAMES.length);
    for (const name of AGENT_FILE_NAMES) {
      expect(filesByAgent["new-agent"]?.[name]?.content).toBe(`template:${name}`);
    }
  });

  it("does not overwrite non-empty target content", async () => {
    const template: Record<string, { content: string }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: `template:${name}` }])
    );
    const target: Record<string, { content: string }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: "" }])
    );
    target["AGENTS.md"].content = "custom agents";
    const store: FilesByAgent = {
      main: template,
      "new-agent": target,
    };

    const { client, filesByAgent } = createMockClient(store, "main");

    const result = await bootstrapAgentBrainFilesFromTemplate({ client, agentId: "new-agent" });

    expect(result.updated).not.toContain("AGENTS.md");
    expect(filesByAgent["new-agent"]?.["AGENTS.md"]?.content).toBe("custom agents");
  });

  it("skips when template file is missing", async () => {
    const template: Record<string, { content: string; missing?: boolean }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: `template:${name}` }])
    );
    template["TOOLS.md"] = { content: "", missing: true };
    const target: Record<string, { content: string }> = Object.fromEntries(
      AGENT_FILE_NAMES.map((name) => [name, { content: "" }])
    );
    const store: FilesByAgent = {
      main: template,
      "new-agent": target,
    };

    const { client, filesByAgent } = createMockClient(store, "main");

    const result = await bootstrapAgentBrainFilesFromTemplate({ client, agentId: "new-agent" });

    expect(result.updated).not.toContain("TOOLS.md");
    expect(filesByAgent["new-agent"]?.["TOOLS.md"]?.content).toBe("");
  });
});

