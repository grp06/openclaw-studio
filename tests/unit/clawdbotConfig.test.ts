import { afterEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readAgentList,
  removeAgentEntry,
  rewriteBindingsForRemovedAgent,
  updateClawdbotConfig,
  writeAgentList,
  type AgentEntry,
} from "@/lib/clawdbot/config";

let tempDir: string | null = null;
let previousConfigPath: string | undefined;

const createTempConfig = (config: Record<string, unknown>) => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-config-"));
  const filePath = path.join(tempDir, "openclaw.json");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_CONFIG_PATH = filePath;
  return { filePath };
};

const cleanup = () => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  if (previousConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
  }
  previousConfigPath = undefined;
};

afterEach(cleanup);

describe("clawdbot config agent list helpers", () => {
  it("reads an empty list when agents.list is missing", () => {
    expect(readAgentList({})).toEqual([]);
  });

  it("preserves extra fields like heartbeat when writing list", () => {
    const list: AgentEntry[] = [
      {
        id: "agent-1",
        name: "Agent One",
        workspace: "/tmp/agent-1",
        heartbeat: { every: "30m", target: "last" },
      },
    ];
    const config: Record<string, unknown> = {};

    writeAgentList(config, list);

    expect(readAgentList(config)).toEqual(list);
  });
});

describe("updateClawdbotConfig", () => {
  it("saves when updater reports changes", () => {
    const { filePath } = createTempConfig({ agents: { list: [] } });

    const result = updateClawdbotConfig((config) => {
      config.agents = { list: [{ id: "agent-1" }] };
      return true;
    });

    expect(result.warnings).toEqual([]);
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    expect(saved.agents).toEqual({ list: [{ id: "agent-1" }] });
  });

  it("skips save when updater reports no changes", () => {
    const initial = { agents: { list: [{ id: "agent-1" }] } };
    const { filePath } = createTempConfig(initial);
    const before = fs.readFileSync(filePath, "utf8");

    const result = updateClawdbotConfig(() => false);

    expect(result.warnings).toEqual([]);
    const after = fs.readFileSync(filePath, "utf8");
    expect(after).toBe(before);
  });

  it("returns warning when updater throws non-error", () => {
    createTempConfig({ agents: { list: [] } });

    const result = updateClawdbotConfig(() => {
      throw "nope";
    });

    expect(result.warnings).toEqual([
      "Agent config not updated: Failed to update config.",
    ]);
  });
});

describe("removeAgentEntry", () => {
  it("removes agent from list and returns true", () => {
    const config: Record<string, unknown> = {
      agents: {
        list: [
          { id: "main", name: "Main", workspace: "/main" },
          { id: "proj-1", name: "Proj", workspace: "/proj" },
        ],
      },
    };
    expect(removeAgentEntry(config, "proj-1")).toBe(true);
    expect(readAgentList(config)).toEqual([
      { id: "main", name: "Main", workspace: "/main" },
    ]);
  });

  it("returns false when agent not in list", () => {
    const config: Record<string, unknown> = {
      agents: { list: [{ id: "main" }] },
    };
    expect(removeAgentEntry(config, "other")).toBe(false);
    expect(readAgentList(config)).toEqual([{ id: "main" }]);
  });
});

describe("rewriteBindingsForRemovedAgent", () => {
  it("rewrites bindings for removed agent to main", () => {
    const config: Record<string, unknown> = {
      bindings: [
        { agentId: "main", match: { channel: "whatsapp" } },
        { agentId: "proj-1", match: { channel: "discord", peer: { kind: "channel", id: "123" } } },
        { agentId: "proj-1", match: { channel: "telegram" } },
      ],
    };
    expect(rewriteBindingsForRemovedAgent(config, "proj-1")).toBe(true);
    const bindings = config.bindings as Array<Record<string, unknown>>;
    expect(bindings[0].agentId).toBe("main");
    expect(bindings[1].agentId).toBe("main");
    expect(bindings[2].agentId).toBe("main");
  });

  it("leaves other bindings unchanged", () => {
    const config: Record<string, unknown> = {
      bindings: [
        { agentId: "main", match: { channel: "whatsapp" } },
        { agentId: "other", match: { channel: "telegram" } },
      ],
    };
    expect(rewriteBindingsForRemovedAgent(config, "proj-1")).toBe(false);
    const bindings = config.bindings as Array<Record<string, unknown>>;
    expect(bindings[0].agentId).toBe("main");
    expect(bindings[1].agentId).toBe("other");
  });

  it("uses custom fallback when provided", () => {
    const config: Record<string, unknown> = {
      bindings: [{ agentId: "proj-1", match: { channel: "discord" } }],
    };
    rewriteBindingsForRemovedAgent(config, "proj-1", "fallback");
    expect((config.bindings as Array<Record<string, unknown>>)[0].agentId).toBe("fallback");
  });
});
