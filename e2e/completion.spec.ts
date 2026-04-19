import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`completion flow (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("mark complete from Review screen", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Group & External");

      // Answer a couple of questions so Review has something to show, then
      // navigate: question header → Progress → Summary → Review answers.
      // That's the only UI-reachable way to land on /review.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("radio", { name: "No", exact: true }).click();
      await page.getByRole("radio", { name: "No", exact: true }).click();

      await page.getByRole("button", { name: "Progress", exact: true }).click();
      await expect(page.getByText("Your progress")).toBeVisible();
      await page.getByRole("button", { name: "Review answers", exact: true }).click();
      await expect(page.getByText("Review your answers")).toBeVisible();

      // Mark complete from Review
      await page.getByRole("button", { name: "I'm done", exact: true }).click();

      // Should land on waiting screen
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });

    test("mark complete from All Done screen", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Group & External");
      await answerAllQuestions(page, "no");

      // Mark complete from "All done!" screen
      await page.getByRole("button", { name: "I'm done", exact: true }).click();

      // Should land on waiting screen
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });

    test("complete → refresh → stays on waiting", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Group & External");
      await answerAllQuestions(page, "no");
      await page.getByRole("button", { name: "I'm done", exact: true }).click();
      await expect(page.getByText("Waiting for everyone")).toBeVisible();

      // Refresh — should stay on waiting, not bounce back to questions
      await page.reload();
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
    });
  });
}
