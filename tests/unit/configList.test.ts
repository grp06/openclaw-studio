import { describe, expect, it } from "vitest";

import {
  readConfigAgentList,
  upsertConfigAgentEntry,
  writeConfigAgentList,
  type ConfigAgentEntry,
} from "@/lib/agents/configList";

describe("config list helpers", () => {
  it("reads an empty list when agents.list is missing", () => {
    expect(readConfigAgentList({})).toEqual([]);
  });

  it("filters invalid list entries and keeps id-based entries", () => {
    const config = {
      agents: {
        list: [
          null,
          { id: "agent-1", name: "One" },
          { id: "" },
          { name: "missing-id" },
          { id: "agent-2", heartbeat: { every: "30m" } },
        ],
      },
    };
    expect(readConfigAgentList(config)).toEqual([
      { id: "agent-1", name: "One" },
      { id: "agent-2", heartbeat: { every: "30m" } },
    ]);
  });

  it("writes agents.list immutably", () => {
    const initial: Record<string, unknown> = {
      agents: { defaults: { heartbeat: { every: "1h" } } },
      bindings: [{ agentId: "agent-1" }],
    };
    const list: ConfigAgentEntry[] = [{ id: "agent-1", name: "One" }];
    const next = writeConfigAgentList(initial, list);

    expect(next).not.toBe(initial);
    expect(next.agents).not.toBe(initial.agents);
    expect((next.agents as Record<string, unknown>).list).toEqual(list);
    expect((next.agents as Record<string, unknown>).defaults).toEqual({
      heartbeat: { every: "1h" },
    });
    expect(next.bindings).toEqual([{ agentId: "agent-1" }]);
  });

  it("upserts agent entries", () => {
    const list: ConfigAgentEntry[] = [
      { id: "agent-1", name: "One" },
      { id: "agent-2", name: "Two" },
    ];

    const updated = upsertConfigAgentEntry(list, "agent-2", (entry) => ({
      ...entry,
      name: "Two Updated",
    }));
    expect(updated.list).toEqual([
      { id: "agent-1", name: "One" },
      { id: "agent-2", name: "Two Updated" },
    ]);
    expect(updated.entry).toEqual({ id: "agent-2", name: "Two Updated" });

    const inserted = upsertConfigAgentEntry(updated.list, "agent-3", (entry) => ({
      ...entry,
      name: "Three",
    }));
    expect(inserted.list).toEqual([
      { id: "agent-1", name: "One" },
      { id: "agent-2", name: "Two Updated" },
      { id: "agent-3", name: "Three" },
    ]);
    expect(inserted.entry).toEqual({ id: "agent-3", name: "Three" });
  });
});
