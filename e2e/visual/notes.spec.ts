import { expect, test } from "../fixtures.js";
import {
  answerAllQuestions,
  assertNoOverflowingText,
  createGroupAndSetup,
  dismissNotePromptIfPresent,
  goThroughIntro,
  narrowToCategory,
  personBase,
  WS_TIMEOUT,
} from "../helpers.js";

const RATING_RADIOS = '[role="radiogroup"][aria-label="Rate this activity"] [role="radio"]';

/**
 * Visual coverage for the note-input UI states. These complement the
 * existing `admin-flow` baselines, which cover the Layout-A card from
 * first paint but never reach the Layout B states (note-section open,
 * primary "Save & next" CTA), and never capture a Comparison row with
 * notes attached.
 *
 * Why a dedicated spec: the states below require either a notePrompt
 * question (so the textarea is open from first paint) or a deliberate
 * note write before navigating onward — both costlier flows than the
 * fast "answer all questions" pattern admin-flow uses.
 */
test.describe("notes UI", () => {
  test("notePrompt card — fresh (Layout B, unrated, prompt placeholder visible)", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);

    // Walk to the first notePrompt question in Foundations
    // (`sharing-fantasies`, give side, position 5 after eye-contact /
    // laughing-during / verbal-affirmation give+receive). Click No through
    // the four preceding questions to reach it without timing or a
    // wandering selection state.
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("radio", { name: "No", exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }

    // sharing-fantasies (give): "Telling your partner your fantasies".
    // Layout B should be active because notePrompt is set, with the
    // textarea visible and the "Save & next" disabled until rated.
    await expect(page.getByText("Telling your partner your fantasies")).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByTestId("note-next")).toBeDisabled();
    await assertNoOverflowingText(page, RATING_RADIOS, "rating buttons (Layout B)");
    await expect(page).toHaveScreenshot("note-card-fresh-prompted.png");
  });

  test("notePrompt card — rated and note typed (Layout B saved, primary CTA enabled)", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Same walk to sharing-fantasies (give).
    for (let i = 0; i < 4; i++) {
      await page.getByRole("radio", { name: "No", exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }

    await expect(page.getByText("Telling your partner your fantasies")).toBeVisible();
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    const textarea = page.getByRole("textbox");
    await textarea.fill("happy to share what's been on my mind lately");

    // Defocus so the screenshot doesn't depend on browser-specific caret styling.
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("note-next")).toBeEnabled();
    await expect(page).toHaveScreenshot("note-card-rated-typed.png");
  });

  test("comparison row — notes attributed under match", async ({ alice, bob }) => {
    const NOTE = "open to anything around fantasy talk — let's see what comes up";

    const { partnerLink } = await createGroupAndSetup(alice, { adminName: "Alice", partnerName: "Bob" });
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Foundations");
    await alice.getByRole("button", { name: "Start", exact: true }).click();

    // Add a note via the inline "+ Add a note" affordance on the very
    // first question (eye-contact). Smaller hop than walking to a
    // notePrompt question and exercises the explicit-opt-in path.
    await alice.getByRole("button", { name: /add a note/i }).click();
    const textarea = alice.getByRole("textbox");
    await alice.getByRole("radio", { name: "Yes", exact: true }).click();
    await textarea.fill(NOTE);
    await alice.getByTestId("note-next").click();

    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();

    // Bob mirrors, no notes.
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Foundations");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    // Make sure the note row paints before the screenshot.
    await expect(bob.locator('[data-testid="match-notes"]', { hasText: NOTE })).toBeVisible();
    await expect(bob).toHaveScreenshot("comparison-with-notes.png");
  });

  test("review row — own note rendered inline below answer", async ({ page }) => {
    const NOTE = "first thing that comes to mind when this matters";

    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Use the inline "+ Add a note" affordance on the first card so the
    // captured row is for a non-notePrompt question (the simpler shape).
    await page.getByRole("button", { name: /add a note/i }).click();
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await page.getByRole("textbox").fill(NOTE);
    await page.getByTestId("note-next").click();

    // Skip the rest with No so we land at the end-of-questions screen
    // quickly, then jump to /review directly. Going through "Edit my
    // answers" routes via /questions which doesn't have a Review button —
    // /summary does, but the simplest path for a screenshot is direct nav.
    await answerAllQuestions(page, "no");
    await page.getByRole("button", { name: "I'm done", exact: true }).click();
    await page.goto(`${personBase(page.url())}/review`);

    await expect(page.getByText("Review your answers")).toBeVisible();
    // The italic note should be on the row for "Eye contact during intimate moments".
    await expect(page.getByText(NOTE)).toBeVisible();
    await expect(page).toHaveScreenshot("review-with-note.png");
  });
});
