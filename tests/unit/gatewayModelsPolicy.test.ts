import { describe, expect, it } from "vitest";

import {
  buildAllowedModelKeys,
  buildGatewayModelChoices,
  resolveConfiguredModelKey,
  type GatewayModelPolicySnapshot,
} from "@/lib/gateway/models";

describe("gateway model policy helpers", () => {
  it("resolves configured aliases and shorthand ids", () => {
    const modelAliases = {
      "anthropic/claude-sonnet-4-5": { alias: "sonnet" },
      "openai/gpt-4o": { alias: "omni" },
    };

    expect(resolveConfiguredModelKey("sonnet", modelAliases)).toBe(
      "anthropic/claude-sonnet-4-5"
    );
    expect(resolveConfiguredModelKey("omni", modelAliases)).toBe("openai/gpt-4o");
    expect(resolveConfiguredModelKey("claude-opus-4", modelAliases)).toBe(
      "anthropic/claude-opus-4"
    );
    expect(resolveConfiguredModelKey("openai/o3", modelAliases)).toBe("openai/o3");
    expect(resolveConfiguredModelKey("   ", modelAliases)).toBeNull();
  });

  it("builds deduped allowlist keys from defaults and aliases", () => {
    const snapshot: GatewayModelPolicySnapshot = {
      config: {
        agents: {
          defaults: {
            model: {
              primary: "sonnet",
              fallbacks: ["omni", "anthropic/claude-sonnet-4-5", ""],
            },
            models: {
              "anthropic/claude-sonnet-4-5": { alias: "sonnet" },
              "openai/gpt-4o": { alias: "omni" },
              "openai/o3": {},
            },
          },
        },
      },
    };

    expect(buildAllowedModelKeys(snapshot)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
      "openai/o3",
    ]);
  });

  it("filters model catalog and appends configured extras", () => {
    const snapshot: GatewayModelPolicySnapshot = {
      config: {
        agents: {
          defaults: {
            model: "sonnet",
            models: {
              "anthropic/claude-sonnet-4-5": { alias: "sonnet" },
              "openai/o3": {},
            },
          },
        },
      },
    };
    const catalog = [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
      },
      {
        provider: "openai",
        id: "gpt-4o",
        name: "GPT-4o",
      },
    ];

    expect(buildGatewayModelChoices(catalog, snapshot)).toEqual([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
      },
      {
        provider: "openai",
        id: "o3",
        name: "openai/o3",
      },
    ]);
  });

  it.each(["minimax", "minimax-cn", "minimax-portal", "minimax-portal-cn"])(
    "prefers advertised Flash then M3 for %s while preserving unrelated choices and metadata",
    (provider) => {
      const model = (id: string) => ({ provider, id, name: id, contextWindow: 123456 });
      const other = { provider: "custom", id: "MiniMax-M2.7", name: "Custom route" };
      const m3 = model("MiniMax-M3");
      const flash = model("MiniMax-M3.1-Flash");
      const media = model("MiniMax-VL-01");
      const custom = model("my-custom-model");
      const catalog = [model("MiniMax-M2.7"), m3, other, flash, media, custom];
      expect(buildGatewayModelChoices(catalog, null)).toEqual([flash, other, m3, media, custom]);
      expect(catalog[0].id).toBe("MiniMax-M2.7");
      expect(buildGatewayModelChoices([m3], null)).toEqual([m3]);
      expect(buildGatewayModelChoices([model("MiniMax-M2.5-highspeed")], null)).toEqual([]);
    }
  );

  it.each([
    ["openrouter", "minimax/minimax-m3.1-flash:free", "minimax/minimax-m3", "minimax/minimax-m2.7"],
    ["opencode", "minimax-m3.1-flash-free", "minimax-m3", "minimax-m2.5-free"],
  ])("preserves advertised gateway IDs and metadata for %s", (provider, flashId, m3Id, legacyId) => {
    const model = (id: string) => ({ provider, id, name: id });
    const flash = model(flashId);
    const m3 = model(m3Id);
    expect(buildGatewayModelChoices([m3, flash], null)).toEqual([flash, m3]);
    const snapshot = { config: { agents: { defaults: { models: { [`${provider}/${legacyId}`]: {} } } } } };
    expect(buildGatewayModelChoices([], snapshot)).toEqual([
      { provider, id: legacyId, name: `${provider}/${legacyId}` },
    ]);
  });

  it("keeps explicit legacy defaults, fallbacks, aliases and custom routes", () => {
    const snapshot = { config: { agents: { defaults: {
      model: { primary: "legacy", fallbacks: ["minimax/MiniMax-M2.5"] },
      models: {
        "minimax/MiniMax-M2.7": { alias: "legacy" },
        "openrouter/private/custom-model": {},
      },
    } } } };
    expect(buildGatewayModelChoices([], snapshot).map((entry) => `${entry.provider}/${entry.id}`))
      .toEqual(["minimax/MiniMax-M2.7", "minimax/MiniMax-M2.5", "openrouter/private/custom-model"]);
  });

  it("returns the catalog unchanged when no config allowlist is present", () => {
    const catalog = [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
      },
    ];

    expect(buildGatewayModelChoices(catalog, null)).toEqual(catalog);
  });
});
