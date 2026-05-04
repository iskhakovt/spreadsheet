import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, NAV_TIMEOUT, narrowToCategory } from "./helpers.js";

test.describe("answer variety", () => {
  test("all rating types work", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");
    // Dismiss category welcome screen
    await expect(page.getByText(/\d+ questions/)).toBeVisible({ timeout: NAV_TIMEOUT });
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Cycle through every rating; each commits and auto-advances.
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await page.getByRole("radio", { name: "If partner wants", exact: true }).click();
    await page.getByRole("radio", { name: "Maybe", exact: true }).click();
    await page.getByRole("radio", { name: "Fantasy only", exact: true }).click();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("skip advances without recording an answer", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");
    await expect(page.getByText(/\d+ questions/)).toBeVisible({ timeout: NAV_TIMEOUT });
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Answer Q1
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // Skip Q2
    await page.getByRole("button", { name: "Skip question", exact: true }).click();

    // Answer Q3
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // Back should go to previous question (which was answered with No)
    await page.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(page.getByRole("radio", { name: "No", exact: true })).toBeVisible();
  });
});
