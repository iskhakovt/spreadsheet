import { expect, test } from "../fixtures.js";
import { createGroupAndSetup, dismissNotePromptIfPresent, goThroughIntro, narrowToCategory } from "../helpers.js";

/**
 * Visual coverage for QuestionCard states the existing visual specs don't
 * reach: the help popover open and the unified Layout B with notePrompt.
 */
test.describe("question card — additional visual states", () => {
  test("help popover open — rating mode", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await page.getByRole("button", { name: /what do these ratings mean/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveScreenshot("help-popover-rating.png");
  });

  test("Layout B with notePrompt — unified Back/Skip styling, primary Next on top", async ({ page }) => {
    // Captures the post-unification layout: primary Next button on top,
    // shared icon-styled Back/Skip row below (no longer the compact text
    // treatment that used to live in Layout B).
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    // Walk to the first notePrompt card.
    for (let i = 0; i < 6; i++) {
      const textarea = page.getByRole("textbox");
      if (await textarea.isVisible({ timeout: 200 }).catch(() => false)) break;
      await page.getByRole("radio", { name: "No", exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }
    await expect(page.getByRole("textbox")).toBeVisible();
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page).toHaveScreenshot("layout-b-unified-nav.png");
  });
});
