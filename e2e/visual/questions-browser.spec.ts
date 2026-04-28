import { expect, test } from "../fixtures.js";

test.describe("public /questions browser", () => {
  test("default view — all tiers, no search", async ({ page }) => {
    await page.goto("/questions");
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();

    // Wait for at least one category section to render — the page suspends
    // on the questions.list query until backfill arrives.
    await expect(page.locator("section").first()).toBeVisible();

    // Above-the-fold capture only — fullPage screenshots of the entire
    // bank produced unstable comparisons because of layout settling and
    // the long scroll. The hero + filter bar + first category cover the
    // critical visual surface.
    await expect(page).toHaveScreenshot("questions-browser-default.png");
  });

  test("tier-1 filter — only Essentials visible", async ({ page }) => {
    await page.goto("/questions");
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();

    // Click the Essentials tier chip — should hide every tier-2+ question.
    await page.getByRole("radio", { name: "Essentials", exact: true }).click();
    await expect(page.getByText(/of \d+ questions shown/)).toBeVisible();

    await expect(page).toHaveScreenshot("questions-browser-tier1.png");
  });
});
