import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

/**
 * Real-browser coverage for the keyboard flow on note-prompted questions.
 * The unit tests in QuestionCard.test.ts cover the commit/advance rules
 * via happy-dom; these specs lock in the contract under real Chromium
 * focus and keyboard event semantics.
 *
 * Setup pattern: eye-contact (the first question in Foundations) has no
 * notePrompt, so we opt into Layout B via the "+ Add a note" link. The
 * keyboard rules under test apply identically regardless of how the note
 * section became visible.
 */
test.describe("free-text notes — keyboard flow", () => {
  test("pressing '1' on a Layout B question moves focus into the textarea", async ({ alice }) => {
    await createGroupAndSetup(alice, { encrypted: true });
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Foundations");
    await alice.getByRole("button", { name: "Start", exact: true }).click();

    await alice.getByRole("button", { name: /add a note/i }).click();
    const textarea = alice.getByRole("textbox");
    await expect(textarea).toBeVisible();

    // Number-key commit. Body has focus initially; the window-level handler
    // intercepts and starts the commit animation, which then fires onRating
    // with source="keyboard" — the parent moves focus into the textarea.
    await alice.locator("body").press("1");
    await expect(textarea).toBeFocused();
  });

  test("type in the textarea, then press '1' — advances immediately", async ({ alice }) => {
    await createGroupAndSetup(alice, { encrypted: true });
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Foundations");
    await alice.getByRole("button", { name: "Start", exact: true }).click();

    await alice.getByRole("button", { name: /add a note/i }).click();
    const textarea = alice.getByRole("textbox");
    await textarea.fill("typed before rating");

    // Blur the textarea so the global "1" handler isn't filtered by the
    // isEditableTarget guard. In real use the user would Tab out (or press
    // Cmd+Enter, which we cover separately); here we blur explicitly to
    // isolate the type-first → rate → advance rule.
    await textarea.evaluate((el: HTMLTextAreaElement) => el.blur());
    await alice.keyboard.press("1");

    // Advance lands us on the next question (laughing-during).
    await expect(alice.getByRole("heading", { name: /laughing during intimacy/i })).toBeVisible();
  });

  test("Cmd+Enter pre-rating moves focus to the first rating button", async ({ alice }) => {
    await createGroupAndSetup(alice, { encrypted: true });
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Foundations");
    await alice.getByRole("button", { name: "Start", exact: true }).click();

    await alice.getByRole("button", { name: /add a note/i }).click();
    const textarea = alice.getByRole("textbox");
    await textarea.fill("typed but not rated yet");

    // No rating yet — Cmd+Enter must not advance, must not silently no-op,
    // must redirect focus to the yes button so the user has a clear next
    // step (press 1–5 to commit).
    await textarea.press("Meta+Enter");
    await expect(alice.getByRole("radio", { name: "Yes", exact: true })).toBeFocused();
  });

  test("Cmd+Enter post-rating advances", async ({ alice }) => {
    await createGroupAndSetup(alice, { encrypted: true });
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Foundations");
    await alice.getByRole("button", { name: "Start", exact: true }).click();

    await alice.getByRole("button", { name: /add a note/i }).click();
    const textarea = alice.getByRole("textbox");

    await alice.getByRole("radio", { name: "Yes", exact: true }).click();
    await textarea.fill("note added after rating");
    await textarea.press("Meta+Enter");

    await expect(alice.getByRole("heading", { name: /laughing during intimacy/i })).toBeVisible();
  });
});
