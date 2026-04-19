import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("answer variety", () => {
  test("all rating types and timing options work", async ({ page }) => {
    await createGroupAndSetup(page, { showTiming: true });
    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    // Dismiss category welcome screen
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Q1: Yes + Now
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now", exact: true }).click();

    // Q2: Yes + Later
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Later", exact: true }).click();

    // Q3: If partner wants + Now (also triggers timing)
    await page.getByRole("radio", { name: "If partner wants", exact: true }).click();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now", exact: true }).click();

    // Q4: Maybe (no timing, advances immediately)
    await page.getByRole("radio", { name: "Maybe", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeVisible();

    // Q5: Fantasy only (no timing)
    await page.getByRole("radio", { name: "Fantasy only", exact: true }).click();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("skip advances without recording an answer", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Answer Q1
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // Skip Q2
    await page.getByRole("button", { name: "Skip question", exact: true }).click();

    // Answer Q3
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // Back should go to previous question (which was answered with No)
    await page.getByText("Back").click();
    await expect(page.getByRole("radio", { name: "No", exact: true })).toBeVisible();
  });
});
