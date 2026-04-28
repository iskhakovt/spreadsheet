import { expect, test } from "../fixtures.js";
import { assertNoOverflowingText } from "../helpers.js";

test.describe("public /questions browser", () => {
  test("default view — all tiers, no search", async ({ page }) => {
    await page.goto("/questions");
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();

    // Wait for at least one category section to render — the page suspends
    // on the questions.list query until backfill arrives.
    await expect(page.locator("section").first()).toBeVisible();

    // Tier-picker labels must fit their buttons. Catches future regressions
    // where adding a tier or renaming a label silently overflows on the
    // narrowest viewport (Adventurous in a 4-up grid bit us once).
    await assertNoOverflowingText(
      page,
      '[role="radiogroup"][aria-label="Question depth"] [role="radio"]',
      "tier picker",
    );

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

    // Same overflow guard — covers the case where switching the active
    // chip changes its width (gradient vs ghost background) and the
    // shorter sibling labels could mask an overflowing one.
    await assertNoOverflowingText(
      page,
      '[role="radiogroup"][aria-label="Question depth"] [role="radio"]',
      "tier picker",
    );

    await expect(page).toHaveScreenshot("questions-browser-tier1.png");
  });
});
