import { describe, expect, it } from "vitest";

import {
  mergeStudioSettings,
  normalizeStudioSettings,
  resolveStudioSessionId,
} from "@/lib/studio/settings";
import { toGatewayHttpUrl } from "@/lib/gateway/url";

describe("studio settings normalization", () => {
  it("returns defaults for empty input", () => {
    const normalized = normalizeStudioSettings(null);
    expect(normalized.version).toBe(1);
    expect(normalized.gateway).toBeNull();
    expect(normalized.focused).toEqual({});
    expect(normalized.sessions).toEqual({});
  });

  it("normalizes gateway entries", () => {
    const normalized = normalizeStudioSettings({
      gateway: { url: " ws://localhost:18789 ", token: " token " },
    });

    expect(normalized.gateway?.url).toBe("ws://localhost:18789");
    expect(normalized.gateway?.token).toBe("token");
  });

  it("normalizes_dual_mode_preferences", () => {
    const normalized = normalizeStudioSettings({
      focused: {
        " ws://localhost:18789 ": {
          mode: "focused",
          selectedAgentId: " agent-2 ",
          filter: "running",
        },
        bad: {
          mode: "nope",
          selectedAgentId: 12,
          filter: "bad-filter",
        },
      },
    });

    expect(normalized.focused["ws://localhost:18789"]).toEqual({
      mode: "focused",
      selectedAgentId: "agent-2",
      filter: "running",
    });
    expect(normalized.focused.bad).toEqual({
      mode: "focused",
      selectedAgentId: null,
      filter: "all",
    });
  });

  it("merges_dual_mode_preferences", () => {
    const current = normalizeStudioSettings({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          selectedAgentId: "main",
          filter: "all",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      focused: {
        "ws://localhost:18789": {
          filter: "needs-attention",
        },
      },
    });

    expect(merged.focused["ws://localhost:18789"]).toEqual({
      mode: "focused",
      selectedAgentId: "main",
      filter: "needs-attention",
    });
  });

  it("normalizes_studio_sessions", () => {
    const normalized = normalizeStudioSettings({
      sessions: {
        " ws://localhost:18789 ": " abc-123 ",
        bad: "",
      },
    });
    expect(normalized.sessions).toEqual({
      "ws://localhost:18789": "abc-123",
    });
  });

  it("merges_studio_sessions", () => {
    const current = normalizeStudioSettings({
      sessions: { "ws://localhost:18789": "session-1" },
    });
    const merged = mergeStudioSettings(current, {
      sessions: {
        "ws://localhost:18789": "session-2",
        "ws://localhost:18790": "session-3",
      },
    });
    expect(merged.sessions).toEqual({
      "ws://localhost:18789": "session-2",
      "ws://localhost:18790": "session-3",
    });
  });

  it("resolves_studio_session_id_by_gateway", () => {
    const settings = normalizeStudioSettings({
      sessions: { "ws://localhost:18789": "session-1" },
    });
    expect(resolveStudioSessionId(settings, "ws://localhost:18789")).toBe("session-1");
    expect(resolveStudioSessionId(settings, "ws://localhost:18790")).toBeNull();
  });
});

describe("gateway url conversion", () => {
  it("converts ws urls to http", () => {
    expect(toGatewayHttpUrl("ws://localhost:18789")).toBe("http://localhost:18789");
    expect(toGatewayHttpUrl("wss://gw.example")).toBe("https://gw.example");
  });

  it("leaves http urls unchanged", () => {
    expect(toGatewayHttpUrl("http://localhost:18789")).toBe("http://localhost:18789");
    expect(toGatewayHttpUrl("https://gw.example"))
      .toBe("https://gw.example");
  });
});
