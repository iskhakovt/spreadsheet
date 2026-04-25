import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, NAV_TIMEOUT, narrowToCategory, WS_TIMEOUT } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`refresh persistence (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("refresh on questions screen stays on questions", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
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
        timeout: WS_TIMEOUT,
      });
    });

    test("refresh on setup screen stays on setup", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Get started", exact: true }).click();
      await page.getByRole("radio", { name: "All questions", exact: true }).click();
      if (encrypted) {
        await page.getByLabel("End-to-end encryption").check();
      }
      await page.getByRole("button", { name: "Create group", exact: true }).click();
      await expect(page.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });

      await page.reload();

      await expect(page.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
    });
  });
}
