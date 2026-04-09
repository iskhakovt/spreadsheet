import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`completion flow (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("mark complete from Review screen", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await setCategories(page, ["group"]);
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await answerAllQuestions(page, "no");

      // "All done!" shows — navigate to Review via URL instead
      await expect(page.getByText("All done!")).toBeVisible();
      const url = page.url().replace(/\/questions$/, "/review");
      await page.goto(url);
      await expect(page.getByText("Review your answers")).toBeVisible();

      // Mark complete from Review
      await page.getByRole("button", { name: "I'm done" }).click();

      // Should land on waiting screen
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });

    test("mark complete from All Done screen", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await setCategories(page, ["group"]);
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await answerAllQuestions(page, "no");

      // Mark complete from "All done!" screen
      await page.getByRole("button", { name: "I'm done" }).click();

      // Should land on waiting screen
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });

    test("complete → refresh → stays on waiting", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await setCategories(page, ["group"]);
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await answerAllQuestions(page, "no");
      await page.getByRole("button", { name: "I'm done" }).click();
      await expect(page.getByText("Waiting for everyone")).toBeVisible();

      // Refresh — should stay on waiting, not bounce back to questions
      await page.reload();
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });
  });
}
