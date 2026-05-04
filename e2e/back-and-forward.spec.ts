import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, dismissNotePromptIfPresent, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("back-and-forward integrity", () => {
  test("answers survive backward + forward navigation, and a mid-flow rating change persists", async ({ page }) => {
    // Drives the per-question state-reset invariant: navigating Back must
    // pre-fill the previous answer (rating ring + textarea), and navigating
    // Forward again must NOT clobber answers downstream.

    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    // Foundations is mostly mutual-only — each question = one screen, so
    // the position-based navigation below stays in lockstep with the
    // ratings array. Categories with give/receive splits would inflate
    // each question into two screens and break the index math.
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Answer the first 5 questions with a deliberate pattern.
    const ratings = ["Yes", "No", "Maybe", "Yes", "No"] as const;
    for (const rating of ratings) {
      await page.getByRole("radio", { name: rating, exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }

    // Back 4 times — should land on Q2 with its original "No" rating intact.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Previous question", exact: true }).click();
    }
    await expect(page.getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");

    // Change Q2 from "No" to "Maybe". This must commit + advance.
    await page.getByRole("radio", { name: "Maybe", exact: true }).click();
    await dismissNotePromptIfPresent(page);

    // We're now on Q3 (originally rated Maybe). The pre-fill must be intact —
    // the rating change to Q2 must NOT have leaked forward.
    await expect(page.getByRole("radio", { name: "Maybe", exact: true })).toHaveAttribute("aria-checked", "true");

    // Back to Q2 — the new "Maybe" should be persisted, not the original "No".
    await page.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Maybe", exact: true })).toHaveAttribute("aria-checked", "true");

    // Back to Q1 — the original "Yes" rating wasn't touched by anything above.
    await page.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
