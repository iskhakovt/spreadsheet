import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

test.describe("answer variety", () => {
  test("all rating types and timing options work", async ({ page }) => {
    await createGroupAndSetup(page, { showTiming: true });
    await setCategories(page, ["group"]);
    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    // Dismiss category welcome screen
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // Q1: Yes + Now
    await page.getByRole("radio", { name: "Yes" }).check();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now" }).click();

    // Q2: Yes + Later
    await page.getByRole("radio", { name: "Yes" }).check();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Later" }).click();

    // Q3: If partner wants + Now (also triggers timing)
    await page.getByRole("radio", { name: "If partner wants" }).check();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now" }).click();

    // Q4: Maybe (no timing, advances immediately)
    await page.getByRole("radio", { name: "Maybe" }).check();
    await expect(page.getByRole("radio", { name: "Yes" })).toBeVisible();

    // Q5: Fantasy only (no timing)
    await page.getByRole("radio", { name: "Fantasy only" }).check();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("skip advances without recording an answer", async ({ page }) => {
    await createGroupAndSetup(page);
    await setCategories(page, ["group"]);
    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // Answer Q1
    await page.getByRole("radio", { name: "No" }).check();

    // Skip Q2
    await page.getByText("Skip").click();

    // Answer Q3
    await page.getByRole("radio", { name: "No" }).check();

    // Back should go to previous question (which was answered with No)
    await page.getByText("Back").click();
    await expect(page.getByRole("radio", { name: "No" })).toBeVisible();
  });
});
