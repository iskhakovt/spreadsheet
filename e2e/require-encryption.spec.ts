import { expect, test } from "./fixtures.js";
import { stubRequireEncryption } from "./helpers.js";

test.describe("REQUIRE_ENCRYPTION=true enforcement (browser side)", () => {
  test("locks the encryption checkbox and forces encrypted: true on create", async ({ page }) => {
    await stubRequireEncryption(page, true);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await expect(page.getByText("Create your group")).toBeVisible();

    const checkbox = page.locator("#encrypted");

    // Attribute / ARIA contract.
    await expect(checkbox).toBeDisabled();
    await expect(checkbox).toBeChecked();

    // Behavioral contract — even a forced click can't toggle it. Catches a
    // regression where an onChange on the wrapping label bypasses `disabled`.
    await checkbox.click({ force: true });
    await expect(checkbox).toBeChecked();

    // Submit and assert the wire payload carries encrypted: true.
    const createReq = page.waitForRequest(
      (req) => /\/api\/trpc\/groups\.create/.test(req.url()) && req.method() === "POST",
    );
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    const body = (await createReq).postData() ?? "";
    expect(body).toContain('"encrypted":true');
    expect(body).not.toContain('"encrypted":false');
  });
});
