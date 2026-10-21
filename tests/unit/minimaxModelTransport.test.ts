// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDomainModels } from "@/lib/controlplane/domain-runtime-client";
import { createRuntimeWriteTransport } from "@/features/agents/operations/runtimeWriteTransport";
import { buildGatewayModelChoices } from "@/lib/gateway/models";

afterEach(() => vi.unstubAllGlobals());

describe("MiniMax model selection HTTP boundary", () => {
  it("loads advertised choices and serializes the selected Flash ID into the real intent request", async () => {
    const catalog = ["MiniMax-M2.7", "MiniMax-M3", "MiniMax-M3.1-Flash"].map((id) => ({
      provider: "minimax", id, name: id, contextWindow: 1000000,
    }));
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return new Response(JSON.stringify({ ok: true, payload: path === "/api/runtime/models" ? { models: catalog } : {} }));
    }));
    const choices = buildGatewayModelChoices(await loadDomainModels(), null);
    expect(choices.map(({ id }) => id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    const transport = createRuntimeWriteTransport({ client: {} as never, useDomainIntents: true });
    await transport.sessionSettingsSync({
      sessionKey: "agent:main:main", model: `${choices[0].provider}/${choices[0].id}`,
    });
    expect(requests[0]).toEqual({ path: "/api/runtime/models", init: { cache: "no-store" } });
    expect(requests[1].path).toBe("/api/intents/session-settings-sync");
    expect(requests[1].init?.method).toBe("POST");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      sessionKey: "agent:main:main", model: "minimax/MiniMax-M3.1-Flash",
    });
  });

  it.each([
    "minimax/MiniMax-M3",
    "minimax-cn/MiniMax-M3.1-Flash",
    "minimax-portal/MiniMax-M3.1-Flash",
    "minimax-portal-cn/MiniMax-M3",
    "openrouter/minimax/minimax-m3.1-flash:free",
    "opencode/minimax-m3.1-flash-free",
    "minimax/MiniMax-M2.7",
    "private/custom/model",
    "minimax/MiniMax-VL-01",
    null,
  ])("preserves explicit model %s and thinking at the HTTP boundary", async (model) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"ok":true,"payload":{}}'));
    vi.stubGlobal("fetch", fetch);
    const transport = createRuntimeWriteTransport({ client: {} as never, useDomainIntents: true });
    await transport.sessionSettingsSync({ sessionKey: "agent:main:main", model, thinkingLevel: "high" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      sessionKey: "agent:main:main", model, thinkingLevel: "high",
    });
  });
});
