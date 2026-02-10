import { expect, test } from "@playwright/test";

type StudioSettingsFixture = {
  version: 1;
  gateway: { url: string; token: string } | null;
  focused: Record<string, { mode: "focused"; filter: string; selectedAgentId: string | null }>;
  sessions: Record<string, string>;
};

const DEFAULT_SETTINGS: StudioSettingsFixture = {
  version: 1,
  gateway: null,
  focused: {},
  sessions: {},
};

const createStudioRoute = (
  initial: StudioSettingsFixture = DEFAULT_SETTINGS
) => {
  let settings: StudioSettingsFixture = {
    version: 1,
    gateway: initial.gateway ?? null,
    focused: { ...(initial.focused ?? {}) },
    sessions: { ...(initial.sessions ?? {}) },
  };
  return async (route: { fulfill: (args: Record<string, unknown>) => Promise<void>; fallback: () => Promise<void> }, request: { method: () => string; postData: () => string | null }) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.fallback();
      return;
    }
    const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    const next = {
      ...settings,
    };
    if ("gateway" in patch) {
      next.gateway = (patch.gateway as StudioSettingsFixture["gateway"]) ?? null;
    }
    if (patch.focused && typeof patch.focused === "object") {
      const focusedPatch = patch.focused as Record<string, Record<string, unknown>>;
      const focusedNext = { ...next.focused };
      for (const [key, value] of Object.entries(focusedPatch)) {
        const existing = focusedNext[key] ?? {
          mode: "focused" as const,
          filter: "all",
          selectedAgentId: null,
        };
        focusedNext[key] = {
          mode: (value.mode as "focused") ?? existing.mode,
          filter: (value.filter as string) ?? existing.filter,
          selectedAgentId:
            "selectedAgentId" in value
              ? ((value.selectedAgentId as string | null) ?? null)
              : existing.selectedAgentId,
        };
      }
      next.focused = focusedNext;
    }
    if (patch.sessions && typeof patch.sessions === "object") {
      const sessionsPatch = patch.sessions as Record<string, string | null>;
      const sessionsNext = { ...next.sessions };
      for (const [key, value] of Object.entries(sessionsPatch)) {
        if (value === null) {
          delete sessionsNext[key];
          continue;
        }
        if (typeof value === "string" && value.trim()) {
          sessionsNext[key] = value.trim();
        }
      }
      next.sessions = sessionsNext;
    }
    settings = next;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings }),
    });
  };
};

test("switches_active_agent_from_sidebar", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await expect(page.getByTestId("fleet-sidebar")).toBeVisible();
  await expect(page.getByTestId("focused-agent-panel")).toBeVisible();
  await expect(
    page.getByTestId("fleet-sidebar").getByText("No agents available.")
  ).toBeVisible();
});

test("applies_attention_filters", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await page.getByTestId("fleet-filter-needs-attention").click();
  await expect(page.getByTestId("fleet-filter-needs-attention")).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByTestId("fleet-filter-running").click();
  await expect(page.getByTestId("fleet-filter-running")).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByTestId("fleet-filter-idle").click();
  await expect(page.getByTestId("fleet-filter-idle")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("focused_preferences_persist_across_reload", async ({ page }) => {
  let settings: StudioSettingsFixture = {
    version: 1,
    gateway: null,
    focused: {},
    sessions: {},
  };
  await page.route("**/api/studio", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.fallback();
      return;
    }
    const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    const next = {
      ...settings,
    };
    if ("gateway" in patch) {
      next.gateway = (patch.gateway as StudioSettingsFixture["gateway"]) ?? null;
    }
    if (patch.focused && typeof patch.focused === "object") {
      const focusedPatch = patch.focused as Record<string, Record<string, unknown>>;
      const focusedNext = { ...next.focused };
      for (const [key, value] of Object.entries(focusedPatch)) {
        const existing = focusedNext[key] ?? {
          mode: "focused" as const,
          filter: "all",
          selectedAgentId: null,
        };
        focusedNext[key] = {
          mode: (value.mode as "focused") ?? existing.mode,
          filter: (value.filter as string) ?? existing.filter,
          selectedAgentId:
            "selectedAgentId" in value
              ? ((value.selectedAgentId as string | null) ?? null)
              : existing.selectedAgentId,
        };
      }
      next.focused = focusedNext;
    }
    if (patch.sessions && typeof patch.sessions === "object") {
      const sessionsPatch = patch.sessions as Record<string, string | null>;
      const sessionsNext = { ...next.sessions };
      for (const [key, value] of Object.entries(sessionsPatch)) {
        if (value === null) {
          delete sessionsNext[key];
          continue;
        }
        if (typeof value === "string" && value.trim()) {
          sessionsNext[key] = value.trim();
        }
      }
      next.sessions = sessionsNext;
    }
    settings = next;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings }),
    });
  });
  const initialSettingsLoad = page.waitForResponse(
    (response) =>
      response.url().includes("/api/studio") &&
      response.request().method() === "GET"
  );
  await page.goto("/");
  await initialSettingsLoad;
  await expect(page.getByTestId("fleet-sidebar")).toBeVisible();

  const focusedPersist = page.waitForResponse((response) => {
    if (!response.url().includes("/api/studio")) return false;
    if (response.request().method() !== "PUT") return false;
    const body = response.request().postData() ?? "";
    return body.includes("\"focused\"") && body.includes("\"running\"");
  });
  await page.getByTestId("fleet-filter-running").click();
  await expect(page.getByTestId("fleet-filter-running")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await focusedPersist;
  expect(Object.values(settings.focused).some((entry) => entry.filter === "running")).toBe(
    true
  );

  const reloadSettingsLoad = page.waitForResponse(
    (response) =>
      response.url().includes("/api/studio") &&
      response.request().method() === "GET"
  );
  await page.reload();
  await reloadSettingsLoad;

  await expect(page.getByTestId("fleet-filter-running")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("clears_unseen_indicator_on_focus", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await page.getByTestId("fleet-filter-all").click();
  await expect(page.getByText(/^Attention$/)).toHaveCount(0);
});
