import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`refresh persistence (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("refresh on questions screen stays on questions", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await setCategories(page, ["group"]);
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      // Wait for welcome screen to load, then dismiss
      await expect(page.getByText(/\d+ questions/)).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Start" }).click();

      await expect(page.getByRole("button", { name: "Yes" })).toBeVisible();
      expect(page.url()).toMatch(/\/questions/);

      await page.reload();

      // After reload with existing answers=0, welcome screen shows again (fresh mount, no answers)
      // But the URL stays on /questions
      expect(page.url()).toMatch(/\/questions/);
      // Wait for content to load — either welcome or question screen
      await expect(
        page.getByText(/\d+ questions/).or(page.getByRole("button", { name: "Yes" })),
      ).toBeVisible({ timeout: 10000 });
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

      await expect(page.getByText("Set up your group")).toBeVisible({ timeout: 10000 });
    });
  });
}
