import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`refresh persistence (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("refresh on questions screen stays on questions", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Group & External");
      // Dismiss welcome screen and land on first question
      await expect(page.getByText(/\d+ questions/)).toBeVisible();
      await page.getByRole("button", { name: "Start", exact: true }).click();

      await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeVisible();
      expect(page.url()).toMatch(/\/questions/);

      await page.reload();

      // After reload with existing answers=0, welcome screen shows again (fresh mount, no answers)
      // But the URL stays on /questions
      expect(page.url()).toMatch(/\/questions/);
      // Wait for content to load — either welcome or question screen
      await expect(
        page.getByText(/\d+ questions/).or(page.getByRole("radio", { name: "Yes", exact: true })),
      ).toBeVisible({
        timeout: 10000,
      });
    });

    test("refresh on setup screen stays on setup", async ({ page }) => {
      await page.goto("/");
      await page.getByText("Get started").click();
      await page.getByText("All questions").click();
      if (encrypted) {
        await page.getByLabel("End-to-end encryption").check();
      }
      await page.getByText("Create group").click();
      await expect(page.getByText("Set up your group")).toBeVisible();

      await page.reload();

      await expect(page.getByText("Set up your group")).toBeVisible();
    });
  });
}
