import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, narrowToCategory } from "./helpers.js";

test.describe("questionnaire flow", () => {
  test("create group → setup → answer questions", async ({ page }) => {
    // Create group
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/.+/);

    // Combined setup — admin name + partner
    await expect(page.getByText("Set up your group")).toBeVisible();
    await page.getByPlaceholder("Enter your name").fill("Alice");
    await page.getByPlaceholder("Partner's name").fill("Bob");
    await page.getByRole("button", { name: "Create & get links", exact: true }).click();

    // Links screen
    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();

    // Should see intro
    await expect(page.getByText("Here's how it works")).toBeVisible();
    await page.getByRole("button", { name: "Let's go", exact: true }).click();

    // Narrow to Foundations via Summary UI to keep the test focused, but
    // still exercises the real Summary flow (no localStorage poke).
    await narrowToCategory(page, "Foundations");

    // Should see category welcome screen
    await expect(page.getByText("Foundations")).toBeVisible();
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Should see first question
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "No", exact: true })).toBeVisible();

    // Answer with "Yes" → commits and auto-advances to the next question.
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Skip question", exact: true })).toBeVisible();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("tier picker appears on intro and filters questions", async ({ page }) => {
    await createGroupAndSetup(page);

    await page.getByRole("button", { name: "Start filling out", exact: true }).click();

    // Intro screen should show tier picker
    await expect(page.getByText("How many questions?")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Common")).toBeVisible();
    await expect(page.getByText("Adventurous")).toBeVisible();
    await expect(page.getByText("Edge")).toBeVisible();

    // "Curious" should be selected by default (has accent border)
    await page.getByRole("button", { name: "Let's go", exact: true }).click();

    // Should proceed to questions — narrow to a single category via UI
    await narrowToCategory(page, "Group & External");
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
  });

  test("question description renders inline in the reserved slot", async ({ page }) => {
    // Description rendering had no automated coverage. `eye-contact` is the
    // first Foundations question and carries a description, so we don't
    // need to navigate past anything to land on a question that has one.
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await page.getByRole("button", { name: "Let's go", exact: true }).click();
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(page.getByText("Eye contact during intimate moments")).toBeVisible();
    await expect(page.getByText(/Looking at each other while we're being intimate/)).toBeVisible();
  });

  test("help popover shows rating glossary", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await page.getByRole("button", { name: "Let's go", exact: true }).click();
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Open help on the rating screen — should show all five ratings.
    await page.getByRole("button", { name: /What do these ratings mean/ }).click();
    const ratingDialog = page.getByRole("dialog", { name: "Rating glossary", exact: true });
    await expect(ratingDialog).toBeVisible();
    await expect(ratingDialog.getByText("Fantasy only")).toBeVisible();
    await expect(ratingDialog.getByText(/Fun to think about/)).toBeVisible();

    // Close via the popover's close button.
    await ratingDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(ratingDialog).not.toBeVisible();
  });

  test("help popover dismisses when the user commits or navigates", async ({ page }) => {
    // Popovers that linger past the moment they were relevant overlay the
    // next screen's content. After committing an answer, advancing, or
    // navigating back, the help popover should close automatically.
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await page.getByRole("button", { name: "Let's go", exact: true }).click();
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Open → commit via keyboard → popover dismissed
    await page.getByRole("button", { name: /What do these ratings mean/ }).click();
    const dialog = page.getByRole("dialog", { name: "Rating glossary", exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("3");
    await expect(dialog).not.toBeVisible();

    // Open → Skip → popover dismissed (screen.key change, different path)
    await page.getByRole("button", { name: /What do these ratings mean/ }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Skip question", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("changing tier on Summary updates question counts", async ({ page }) => {
    await createGroupAndSetup(page);

    // Intro → pick Essentials tier via the Intro screen's tier picker.
    // The label is visible on Intro as part of the tier selector.
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await expect(page.getByText("How many questions?")).toBeVisible();
    await page.getByText("Essentials", { exact: true }).click();
    await page.getByRole("button", { name: "Let's go", exact: true }).click();

    // Narrow to Power Exchange (has a mix of T1, T2, T3 questions, so tier
    // changes produce visible count changes).
    await narrowToCategory(page, "Power Exchange");

    // Start category, land on a question, then navigate to Summary
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Progress", exact: true }).click();

    // Summary should show Essentials currently selected and a count for
    // Power Exchange. Scope the fraction lookup to the Power Exchange row
    // specifically — `page.locator("text=/\\d+\\/\\d+/").first()` is
    // DOM-order dependent and would silently read the wrong row if the
    // Summary layout ever changes (e.g. overall progress counter, or a
    // different category rendered first).
    await expect(page.getByText("Your progress")).toBeVisible();
    const powerRow = page
      .locator("div")
      .filter({ hasText: /^Power Exchange\s*\d+\/\d+/ })
      .first();
    const essentialsCountText = await powerRow.locator("text=/\\d+\\/\\d+/").textContent();
    const essentialTotal = Number(essentialsCountText?.split("/")[1] ?? 0);

    // Switch to Adventurous on Summary
    await page.getByText("Adventurous", { exact: true }).click();

    // Count should increase (more questions unlocked at higher tier)
    const adventurousCountText = await powerRow.locator("text=/\\d+\\/\\d+/").textContent();
    const adventurousTotal = Number(adventurousCountText?.split("/")[1] ?? 0);

    expect(adventurousTotal).toBeGreaterThan(essentialTotal);
  });
});
