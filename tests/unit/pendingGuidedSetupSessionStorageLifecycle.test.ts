import { describe, expect, it, vi } from "vitest";

import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import {
  loadPendingGuidedSetupsForScope,
  persistPendingGuidedSetupsForScopeWhenLoaded,
} from "@/features/agents/creation/pendingGuidedSetupSessionStorageLifecycle";
import { persistPendingGuidedSetupsToStorage } from "@/features/agents/creation/pendingSetupStore";

const createMemoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

describe("pendingGuidedSetupSessionStorageLifecycle", () => {
  it("loads pending setups for a scope and returns the scope marker", () => {
    const storage = createMemoryStorage();
    const setup: AgentGuidedSetup = {
      agentOverrides: {},
      files: {},
      execApprovals: null,
    };

    persistPendingGuidedSetupsToStorage({
      storage: storage as unknown as Storage,
      gatewayScope: "scope-a",
      setupsByAgentId: { a1: setup },
      nowMs: Date.now(),
    });

    const loaded = loadPendingGuidedSetupsForScope({
      storage: storage as unknown as Storage,
      gatewayScope: "scope-a",
    });

    expect(loaded.loadedScope).toBe("scope-a");
    expect(Object.keys(loaded.setupsByAgentId)).toEqual(["a1"]);
  });

  it("does not persist when loaded scope mismatches", () => {
    const storage = createMemoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const removeItem = vi.spyOn(storage, "removeItem");
    const setup: AgentGuidedSetup = {
      agentOverrides: {},
      files: {},
      execApprovals: null,
    };

    persistPendingGuidedSetupsForScopeWhenLoaded({
      storage: storage as unknown as Storage,
      gatewayScope: "scope-a",
      loadedScope: "scope-b",
      setupsByAgentId: { a1: setup },
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
