// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { spawnSync } from "node:child_process";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process"
  );
  return {
    default: actual,
    ...actual,
    spawnSync: vi.fn(),
  };
});

import { runSshJson } from "@/lib/ssh/gateway-host";

const mockedSpawnSync = vi.mocked(spawnSync);

describe("runSshJson", () => {
  it("forwards maxBuffer to spawnSync when provided", () => {
    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ ok: true }),
      stderr: "",
      error: undefined,
    } as never);

    runSshJson({
      sshTarget: "me@example.test",
      argv: ["bash", "-lc", "echo ok"],
      label: "ssh-json-test",
      input: "echo hello",
      maxBuffer: 12345,
    } as unknown as Parameters<typeof runSshJson>[0]);

    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
    const [, , options] = mockedSpawnSync.mock.calls[0] as [
      string,
      string[],
      { encoding?: string; input?: string; maxBuffer?: number },
    ];
    expect(options.maxBuffer).toBe(12345);
  });
});
