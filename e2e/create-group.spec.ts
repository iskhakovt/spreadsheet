import { expect, test } from "./fixtures.js";

test.describe("landing and group creation", () => {
  test("shows landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Spreadsheet")).toBeVisible();
    await expect(page.getByText("Discover what")).toBeVisible();
    await expect(page.getByText("Get started")).toBeVisible();
  });

  test("creates a group and sets up members", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Get started").click();

    // Create group form — switch to "All questions" for simpler test
    await expect(page.getByText("Create your group")).toBeVisible();
    await page.getByText("All questions").click();
    await page.getByText("Create group").click();

    // Should redirect to /p/{token}
    await expect(page).toHaveURL(/\/p\/.+/);

    // Should see combined setup screen (admin)
    await expect(page.getByText("Set up your group")).toBeVisible();
    await page.getByPlaceholder("Enter your name").fill("TestUser");
    await page.getByPlaceholder("Partner's name").fill("Partner");

    // Submit — creates partner + marks ready
    await page.getByText("Create & get links").click();

    // Should see links screen
    await expect(page.getByText("You're all set")).toBeVisible();
    await expect(page.getByText("Partner's link")).toBeVisible();
  });
});
