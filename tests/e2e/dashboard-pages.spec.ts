import { test, expect } from "@playwright/test";

test.describe("Dashboard pages smoke tests", () => {
  test("Activity Feed page loads and shows header", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.locator("h1")).toHaveText("Activity Feed");
    await expect(page.getByTestId("activity-filters")).toBeVisible();
    // Should show empty state when no gateway connected
    await expect(page.getByTestId("activity-empty")).toBeVisible();
  });

  test("Activity Feed filters are interactive", async ({ page }) => {
    await page.goto("/activity");
    const chatFilter = page.getByTestId("filter-chat");
    await expect(chatFilter).toBeVisible();
    await chatFilter.click();
    await expect(chatFilter).toHaveAttribute("aria-pressed", "false");
    await chatFilter.click();
    await expect(chatFilter).toHaveAttribute("aria-pressed", "true");
  });

  test("Calendar page loads and shows header", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.locator("h1")).toHaveText("Calendar");
    // Should show disconnected state
    await expect(page.getByText("Disconnected")).toBeVisible();
  });

  test("Calendar navigation buttons work", async ({ page }) => {
    await page.goto("/calendar");
    const todayBtn = page.getByText("Today");
    await expect(todayBtn).toBeVisible();
    await page.getByLabel("Previous week").click();
    await page.getByLabel("Next week").click();
  });

  test("Search page loads and shows input", async ({ page }) => {
    await page.goto("/search");
    await expect(page.locator("h1")).toHaveText("Search");
    await expect(page.getByTestId("search-input")).toBeVisible();
  });

  test("Search input accepts text", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByTestId("search-input");
    await input.fill("test query");
    await expect(input).toHaveValue("test query");
  });

  test("Nav sidebar links to all dashboard pages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Activity")).toBeVisible();
    await expect(page.getByText("Calendar")).toBeVisible();
    await expect(page.getByText("Search")).toBeVisible();
  });

  test("Cmd+K navigates to search", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await expect(page).toHaveURL(/\/search/);
  });
});
