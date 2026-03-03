import { describe, expect, it } from "vitest";

import {
  buildAgentMainSessionKey,
  isSameSessionKey,
  parseAgentIdFromSessionKey,
} from "@/lib/gateway/session-keys";

describe("sessionKey helpers", () => {
  it("buildAgentMainSessionKey formats agent session key", () => {
    expect(buildAgentMainSessionKey("agent-1", "main")).toBe("agent:agent-1:main");
  });

  it("parseAgentIdFromSessionKey extracts agent id", () => {
    expect(parseAgentIdFromSessionKey("agent:agent-1:main")).toBe("agent-1");
  });

  it("parseAgentIdFromSessionKey returns null when missing", () => {
    expect(parseAgentIdFromSessionKey("")).toBeNull();
  });

  it("isSameSessionKey requires exact session key match", () => {
    expect(isSameSessionKey("agent:main:studio:one", "agent:main:studio:one")).toBe(true);
    expect(isSameSessionKey("agent:main:studio:one", "agent:main:discord:one")).toBe(false);
  });

  it("isSameSessionKey trims whitespace", () => {
    expect(isSameSessionKey(" agent:main:studio:one ", "agent:main:studio:one")).toBe(true);
  });
});
