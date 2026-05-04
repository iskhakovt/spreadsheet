import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, dismissNotePromptIfPresent, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("notePrompt + showTimingFlow", () => {
  test("notePrompt question does NOT fan out to now/later, even with timing on", async ({ page }) => {
    // Regression: previously, yes on a notePrompt question with timing on
    // would surface TimingButtons; tapping "Now" then failed to auto-advance
    // (Layout B suppresses advance), making the click feel like a no-op.
    // Fix: notePrompt short-circuits the timing fan-out — the note replaces
    // timing as the secondary signal.

    await createGroupAndSetup(page, { showTiming: true });
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Walk forward via "Yes + Now" until the textarea appears (notePrompt
    // question reached). On any non-notePrompt question, timing fan-out is
    // expected; on a notePrompt one, it must be suppressed.
    let foundNotePromptCard = false;
    for (let i = 0; i < 25; i++) {
      const textarea = page.getByRole("textbox");
      if (await textarea.isVisible({ timeout: 200 }).catch(() => false)) {
        foundNotePromptCard = true;
        break;
      }
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      // Ordinary question: timing buttons should appear, then advance.
      const nowBtn = page.getByRole("button", { name: "Now", exact: true });
      await nowBtn.click();
    }
    expect(foundNotePromptCard).toBe(true);

    // On the notePrompt card: click yes. No timing fan-out.
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Now", exact: true })).not.toBeVisible({ timeout: 1_000 });
    await expect(page.getByRole("button", { name: "Later", exact: true })).not.toBeVisible({ timeout: 1_000 });

    // Primary Next button is the next action.
    const nextBtn = page.getByTestId("note-next");
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toBeEnabled();
  });

  test("notePrompt note round-trips through reload, encrypted", async ({ page }) => {
    const NOTE_TEXT = "specifically curious about the boundaries here";

    await createGroupAndSetup(page, { showTiming: true, encrypted: true });
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Walk to the first notePrompt card.
    for (let i = 0; i < 25; i++) {
      const textarea = page.getByRole("textbox");
      if (await textarea.isVisible({ timeout: 200 }).catch(() => false)) break;
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      await page.getByRole("button", { name: "Now", exact: true }).click();
    }

    // Capture the question heading so we can assert we land back on it after reload.
    const heading = await page.locator("h2").first().textContent();
    expect(heading).toBeTruthy();

    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    const textarea = page.getByRole("textbox");
    await textarea.fill(NOTE_TEXT);
    await page.getByTestId("note-next").click();

    // Move to the next question, then go back to verify the note saved.
    await dismissNotePromptIfPresent(page);
    await page.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(page.locator("h2").first()).toHaveText(heading ?? "");
    await expect(page.getByRole("textbox")).toHaveValue(NOTE_TEXT);

    // Wait for sync (debounce 3s), then reload to verify persistence.
    await page.waitForTimeout(3_500);
    await page.reload();
    await expect(page.locator("h2").first()).toHaveText(heading ?? "", { timeout: 5_000 });
    await expect(page.getByRole("textbox")).toHaveValue(NOTE_TEXT);
    // And the rating ring is still on yes.
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
