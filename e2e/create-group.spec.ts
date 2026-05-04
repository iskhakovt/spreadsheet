import { expect, test } from "./fixtures.js";

test.describe("landing and group creation", () => {
  test("shows landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Spreadsheet")).toBeVisible();
    await expect(page.getByText("Discover what")).toBeVisible();
    await expect(page.getByText("Get started")).toBeVisible();
  });

  test("back button from create form returns to landing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await expect(page.getByText("Create your group")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.goBack();
    await expect(page.getByRole("button", { name: "Get started", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("back button after submit returns to landing pitch, not the create form", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/.+/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Get started", exact: true })).toBeVisible();
    await expect(page.getByText("Create your group")).not.toBeVisible();
  });

  test("creates a group and sets up members", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();

    // Create group form — switch to "All questions" for simpler test
    await expect(page.getByText("Create your group")).toBeVisible();
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();

    // Should redirect to /p/{token}
    await expect(page).toHaveURL(/\/p\/.+/);

    // Should see combined setup screen (admin)
    await expect(page.getByText("Set up your group")).toBeVisible();
    await page.getByPlaceholder("Enter your name").fill("TestUser");
    await page.getByPlaceholder("Partner's name").fill("Partner");

    // Submit — creates partner + marks ready
    await page.getByRole("button", { name: "Create & get links", exact: true }).click();

    // Should see links screen
    await expect(page.getByText("You're all set")).toBeVisible();
    await expect(page.getByText("Partner's link")).toBeVisible();
  });
});
