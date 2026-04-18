import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, narrowToCategory } from "./helpers.js";

test.describe("questionnaire flow", () => {
  test("create group → setup → answer questions", async ({ page }) => {
    // Create group
    await page.goto("/");
    await page.getByText("Get started").click();
    await page.getByText("All questions").click();
    await page.getByLabel('Ask "now or later?"').check();
    await page.getByText("Create group").click();
    await expect(page).toHaveURL(/\/p\/.+/);

    // Combined setup — admin name + partner
    await expect(page.getByText("Set up your group")).toBeVisible();
    await page.getByPlaceholder("Enter your name").fill("Alice");
    await page.getByPlaceholder("Partner's name").fill("Bob");
    await page.getByText("Create & get links").click();

    // Links screen
    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByText("Start filling out").click();

    // Should see intro
    await expect(page.getByText("Here's how it works")).toBeVisible();
    await page.getByText("Let's go").click();

    // Narrow to Foundations via Summary UI to keep the test focused, but
    // still exercises the real Summary flow (no localStorage poke).
    await narrowToCategory(page, "Foundations");

    // Should see category welcome screen
    await expect(page.getByText("Foundations")).toBeVisible();
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // Should see first question
    await expect(page.getByRole("radio", { name: "Yes" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "No" })).toBeVisible();

    // Answer with "Yes" → should show timing
    await page.getByRole("radio", { name: "Yes" }).click();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now" }).click();

    // Should advance to next question
    await expect(page.getByRole("button", { name: "Skip question" })).toBeVisible();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("tier picker appears on intro and filters questions", async ({ page }) => {
    await createGroupAndSetup(page);

    await page.getByText("Start filling out").click();

    // Intro screen should show tier picker
    await expect(page.getByText("How many questions?")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Curious")).toBeVisible();
    await expect(page.getByText("Adventurous")).toBeVisible();

    // "Curious" should be selected by default (has accent border)
    await page.getByText("Let's go").click();

    // Should proceed to questions — narrow to a single category via UI
    await narrowToCategory(page, "Group & External");
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
  });

  test("question description renders inline in the reserved slot", async ({ page }) => {
    // Description rendering had no automated coverage. `phone-sex` is the
    // first Foundations question with a description; the two prior
    // questions (`dirty-talk`, `sexting`) each have giveText + receiveText
    // so they expand into two screens each → answer No four times to
    // advance past them and land on phone-sex.
    await createGroupAndSetup(page);
    await page.getByText("Start filling out").click();
    await page.getByText("Let's go").click();
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start" }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("radio", { name: "No" }).click();
    }

    await expect(page.getByText("Phone sex / voice notes")).toBeVisible();
    await expect(page.getByText(/Sexual conversation or erotic audio over the phone/)).toBeVisible();
  });

  test("help popover shows rating glossary; switches to timing on the sub-question", async ({ page }) => {
    await createGroupAndSetup(page, { showTiming: true });
    await page.getByText("Start filling out").click();
    await page.getByText("Let's go").click();
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start" }).click();

    // Open help on the rating screen — should show all five ratings.
    await page.getByRole("button", { name: /What do these ratings mean/ }).click();
    const ratingDialog = page.getByRole("dialog", { name: "Rating glossary" });
    await expect(ratingDialog).toBeVisible();
    await expect(ratingDialog.getByText("Fantasy only")).toBeVisible();
    await expect(ratingDialog.getByText(/Fun to think about/)).toBeVisible();

    // Close via the popover's close button (heading is below the popover so
    // a "click outside" via heading would just hit the dialog's overlay).
    await ratingDialog.getByRole("button", { name: "Close" }).click();
    await expect(ratingDialog).not.toBeVisible();
    await page.getByRole("radio", { name: "Yes" }).click();
    await expect(page.getByRole("button", { name: "Now" })).toBeVisible();

    // Help should now show the timing glossary, not ratings.
    await page.getByRole("button", { name: /What do these timings mean/ }).click();
    const timingDialog = page.getByRole("dialog", { name: "Timing glossary" });
    await expect(timingDialog).toBeVisible();
    await expect(timingDialog.getByText("Now", { exact: true })).toBeVisible();
    await expect(timingDialog.getByText(/I'd like to try this soon/)).toBeVisible();
  });

  test("changing tier on Summary updates question counts", async ({ page }) => {
    await createGroupAndSetup(page);

    // Intro → pick Essentials tier via the Intro screen's tier picker.
    // The label is visible on Intro as part of the tier selector.
    await page.getByText("Start filling out").click();
    await expect(page.getByText("How many questions?")).toBeVisible();
    await page.getByText("Essentials").click();
    await page.getByText("Let's go").click();

    // Narrow to Power Exchange (has a mix of T1, T2, T3 questions, so tier
    // changes produce visible count changes).
    await narrowToCategory(page, "Power Exchange");

    // Start category, land on a question, then navigate to Summary
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Progress" }).click();

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
    await page.getByText("Adventurous").click();

    // Count should increase (more questions unlocked at higher tier)
    const adventurousCountText = await powerRow.locator("text=/\\d+\\/\\d+/").textContent();
    const adventurousTotal = Number(adventurousCountText?.split("/")[1] ?? 0);

    expect(adventurousTotal).toBeGreaterThan(essentialTotal);
  });
});
