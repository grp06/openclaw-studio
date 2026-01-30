import { expect, test } from "@playwright/test";

test("loads canvas empty state", async ({ page }) => {
  await page.route("**/api/projects", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 3, activeProjectId: null, projects: [] }),
      });
  });
  await page.goto("/");
  await expect(page.getByText("Create a workspace to begin.")).toBeVisible();
});

test("create workspace form submits on Return key", async ({ page }) => {
  const emptyStore = {
    version: 3,
    activeProjectId: null,
    projects: [],
  };
  const createdProject = {
    id: "test-project-id",
    name: "My Workspace",
    repoPath: "/tmp/my-workspace",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    tiles: [],
  };
  const storeWithProject = {
    version: 3,
    activeProjectId: createdProject.id,
    projects: [createdProject],
  };

  await page.route("**/api/projects", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyStore),
      });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      if (body?.name === "My Workspace") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ store: storeWithProject, warnings: [] }),
        });
        return;
      }
      await route.fallback();
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  // Wait for initial load (empty state) so the header and Workspaces dropdown are ready
  await expect(page.getByText("Create a workspace to begin.")).toBeVisible();
  // Open Workspaces dropdown (summary inside details; not always exposed as role=button)
  await page.locator("details").filter({ hasText: "New Workspace" }).locator("summary").click();
  await page.getByRole("button", { name: "New Workspace" }).click();

  const nameInput = page.getByLabel("Workspace name");
  await expect(nameInput).toBeVisible();
  await nameInput.fill("My Workspace");
  await nameInput.press("Enter");

  await expect(page.getByText("Create a workspace to begin.")).not.toBeVisible();
  // New workspace is selected in the header dropdown (option can be hidden when select is closed)
  await expect(page.getByRole("combobox", { name: "Workspace" })).toHaveValue(
    createdProject.id
  );
});
