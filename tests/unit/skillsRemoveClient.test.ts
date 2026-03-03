import { afterEach, describe, expect, it, vi } from "vitest";

import { removeSkillFromGateway } from "@/lib/skills/remove";

describe("skills remove client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts skill removal payload to the Studio API route", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          result: {
            removed: true,
            removedPath: "/tmp/workspace/skills/github",
            source: "openclaw-workspace",
          },
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeSkillFromGateway({
      skillKey: " github ",
      source: "openclaw-workspace",
      baseDir: " /tmp/workspace/skills/github ",
      workspaceDir: " /tmp/workspace ",
      managedSkillsDir: " /tmp/managed ",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/intents/skills-remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        skillKey: "github",
        source: "openclaw-workspace",
        baseDir: "/tmp/workspace/skills/github",
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/managed",
      }),
    });
    expect(result).toEqual({
      removed: true,
      removedPath: "/tmp/workspace/skills/github",
      source: "openclaw-workspace",
    });
  });

  it("fails fast when required payload fields are missing", async () => {
    await expect(
      removeSkillFromGateway({
        skillKey: " ",
        source: "openclaw-workspace",
        baseDir: "/tmp/workspace/skills/github",
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/managed",
      })
    ).rejects.toThrow("skillKey is required.");

    await expect(
      removeSkillFromGateway({
        skillKey: "github",
        source: "openclaw-workspace",
        baseDir: " ",
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/managed",
      })
    ).rejects.toThrow("baseDir is required.");
  });
});
