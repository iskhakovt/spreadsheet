import { expect, test } from "./fixtures.js";

for (const encrypted of [false, true]) {
  test.describe(`filtered mode — admin picks anatomy (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("shows anatomy pickers in setup and completes", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Get started", exact: true }).click();

      // Default is "Filter by body"
      if (encrypted) {
        await page.getByLabel("End-to-end encryption").check();
      }
      await page.getByRole("button", { name: "Create group", exact: true }).click();
      await expect(page).toHaveURL(/\/p\/.+/);

      await expect(page.getByText("Set up your group")).toBeVisible();
      await page.getByPlaceholder("Enter your name").fill("Alice");

      // Admin's body type picker
      await expect(page.getByText("Your body type")).toBeVisible();
      const adminSection = page.locator("text=Your body type").locator("..").locator("..");
      await adminSection.getByRole("radio", { name: "Vulva", exact: true }).click();

      // Partner
      await page.getByPlaceholder("Partner's name").fill("Bob");
      await expect(page.getByText("Their body type")).toBeVisible();
      const partnerSection = page.locator("text=Their body type").locator("..").locator("..");
      await partnerSection.getByRole("radio", { name: "Penis", exact: true }).click();

      await page.getByRole("button", { name: "Create & get links", exact: true }).click();
      await expect(page.getByText("You're all set")).toBeVisible();
    });
  });
}
