import { expect, test } from "../fixtures.js";

test.describe("landing & create-group form", () => {
  test("landing page and form variants", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Spreadsheet")).toBeVisible();
    await expect(page).toHaveScreenshot("landing-home.png");

    // Open create-group form (default: filtered mode)
    await page.getByText("Get started").click();
    await expect(page.getByText("Create your group")).toBeVisible();
    await expect(page).toHaveScreenshot("create-group-filtered.png");

    // Switch to all-questions mode — filtered settings disappear
    await page.getByText("All questions").click();
    await expect(page).toHaveScreenshot("create-group-all.png");

    // Switch back to filtered, check both checkboxes
    await page.getByText("Filter by body").click();
    await page.getByLabel('Ask "now or later?"').check();
    await page.getByLabel("End-to-end encryption").check();
    await expect(page).toHaveScreenshot("create-group-all-options.png");
  });
});
