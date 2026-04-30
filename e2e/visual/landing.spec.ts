import { expect, test } from "../fixtures.js";
import { stubRequireEncryption } from "../helpers.js";

test.describe("landing & create-group form", () => {
  test("landing page and form variants", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Spreadsheet")).toBeVisible();
    await expect(page).toHaveScreenshot("landing-home.png");

    // Open create-group form (default: filtered mode)
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await expect(page.getByText("Create your group")).toBeVisible();
    await expect(page).toHaveScreenshot("create-group-filtered.png");

    // Switch to all-questions mode — filtered settings disappear
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await expect(page).toHaveScreenshot("create-group-all.png");

    // Switch back to filtered, check both checkboxes
    await page.getByRole("radio", { name: "Filter by body", exact: true }).click();
    await page.getByLabel('Ask "now or later?"').check();
    await page.getByLabel("End-to-end encryption").check();
    await expect(page).toHaveScreenshot("create-group-all-options.png");
  });

  // The locked-checkbox state (REQUIRE_ENCRYPTION=true) has different cursor /
  // hover affordances than the default unchecked-and-clickable state — neither
  // existing snapshot covers it because global-setup runs the server with
  // REQUIRE_ENCRYPTION=false.
  test("create-group form with REQUIRE_ENCRYPTION=true", async ({ page }) => {
    await stubRequireEncryption(page, true);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await expect(page.getByText("Create your group")).toBeVisible();
    await expect(page).toHaveScreenshot("create-group-encryption-locked.png");
  });
});
