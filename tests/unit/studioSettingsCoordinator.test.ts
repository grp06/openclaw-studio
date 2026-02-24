import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudioSettings } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

describe("StudioSettingsCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces multiple scheduled patches into one update", async () => {
    const fetchSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const updateSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 300);

    coordinator.schedulePatch({
      gateway: { url: "ws://localhost:18789", token: "abc" },
    });
    coordinator.schedulePatch({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "running",
          selectedAgentId: null,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: { url: "ws://localhost:18789", token: "abc" },
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "running",
          selectedAgentId: null,
        },
      },
    });

    coordinator.dispose();
  });

  it("flushPending persists queued patch immediately", async () => {
    const fetchSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const updateSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 1000);

    coordinator.schedulePatch({
      gateway: { url: "ws://localhost:18789", token: "session-a" },
    });

    await coordinator.flushPending();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: { url: "ws://localhost:18789", token: "session-a" },
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(updateSettings).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });

  it("dispose clears pending timer without writing", async () => {
    const fetchSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const updateSettings = vi.fn(async () => ({ settings: defaultStudioSettings() }));
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 200);

    coordinator.schedulePatch({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "approvals",
          selectedAgentId: null,
        },
      },
    });
    coordinator.dispose();

    await vi.advanceTimersByTimeAsync(500);

    expect(updateSettings).not.toHaveBeenCalled();
  });
});
