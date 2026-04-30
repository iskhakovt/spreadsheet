import { expect, test } from "./fixtures.js";

test.describe("public /questions browser", () => {
  test("Landing → Browse the questions → search filters the list and the count updates", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Spreadsheet" })).toBeVisible();

    // Click the public-browser link in the Landing footer.
    await page.getByRole("link", { name: "Browse the questions" }).click();
    await expect(page).toHaveURL(/\/questions$/);
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();

    // The page suspends on `trpc.questions.list`; once it resolves, the
    // count text is the most reliable readiness signal.
    await expect(page.getByText(/of \d+ questions shown/)).toBeVisible();

    // Type a narrow search — `blindfold` is a known tier-2 mutual question
    // in Sensory environment. Pick a stem that's unique enough to filter
    // down to a small handful of rows.
    await page.getByRole("searchbox", { name: "Search questions" }).fill("blindfold");

    // Count text should drop to a tiny number — assert the "of 276" total
    // stays put while the visible count shrinks. Pin the format more
    // narrowly than just /\d+/ so an off-by-one rendering bug surfaces.
    await expect(page.getByText(/of 276 questions shown/)).toBeVisible();
    const blindfoldRow = page.getByText("Blindfold", { exact: true }).first();
    await expect(blindfoldRow).toBeVisible();

    // Tier-1 chip narrows further. Use the radio role so we hit the
    // sticky filter bar's button, not the badge on a row card.
    await page.getByRole("radio", { name: "Essentials", exact: true }).click();
    // No tier-1 questions match `blindfold` (it's tier 2), expect empty.
    await expect(page.getByText("No questions match your filter.")).toBeVisible();

    // Clearing the search restores results within the tier-1 filter.
    await page.getByRole("searchbox", { name: "Search questions" }).fill("");
    await expect(page.getByText(/of 276 questions shown/)).toBeVisible();
    // Eye contact is tier-1 in Foundations — should be in the unfiltered tier-1 list.
    await expect(page.getByText("Eye contact during intimate moments").first()).toBeVisible();
  });

  test("filter changes snap the user back to the filter bar instead of stranding them mid-list", async ({ page }) => {
    await page.goto("/questions");
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();

    // The "X of Y questions shown" count is the readiness + change signal.
    // Capture the initial text dynamically so the test isn't coupled to the
    // current corpus size.
    const count = page.getByText(/of \d+ questions shown/);
    await expect(count).toBeVisible();
    const initialCountText = (await count.textContent()) ?? "";

    // Scroll deep into the list. 2000px is well past the hero + filter bar
    // and lands somewhere in the middle of the question list.
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);

    // Tier change is the ergonomic test: tier=1 still leaves enough rows
    // that the page is taller than a single viewport, so the browser's
    // own scroll-clamp doesn't trivialise the snap. After the click, the
    // filter bar should be in viewport (sentinel snap brought us back).
    // Wait for the count to change — that's the proof the filter committed
    // and the layout effect ran.
    await page.getByRole("radio", { name: "Essentials", exact: true }).click();
    await expect(count).not.toHaveText(initialCountText);
    await expect(count).toHaveText(/of \d+ questions shown/);
    await expect(page.getByRole("searchbox", { name: "Search questions" })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(1000);

    // Search filter — same property. Reset to Edge tier (so the count
    // returns to the full corpus), capture the new baseline, scroll deep,
    // type a search, and wait for the count to change again.
    await page.getByRole("radio", { name: "Edge", exact: true }).click();
    await expect(count).toHaveText(initialCountText);
    await page.evaluate(() => window.scrollTo(0, 2000));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
    await page.getByRole("searchbox", { name: "Search questions" }).fill("oral");
    await expect(count).not.toHaveText(initialCountText);
    await expect(count).toHaveText(/of \d+ questions shown/);
    await expect(page.getByRole("searchbox", { name: "Search questions" })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(1000);
  });

  test("clicking a `requires` chip jumps to the parent and flashes it", async ({ page }) => {
    await page.goto("/questions");
    await expect(page.getByRole("heading", { name: "Browse the bank" })).toBeVisible();
    await expect(page.getByText(/of \d+ questions shown/)).toBeVisible();

    // `slow-sex` (Foundations) requires `sex-generally`. The chip on its
    // row should jump to the parent. Find the chip near the slow-sex row.
    const chip = page.getByRole("button", { name: "requires sex-generally" }).first();
    await expect(chip).toBeVisible();
    await chip.click();

    // The parent card should now be on screen and carry the flash class
    // briefly. Assert the parent is in viewport and the flash class
    // applied. The flash auto-removes after the animation, so check it
    // shortly after click.
    const parent = page.locator('[data-question-id="sex-generally"]');
    await expect(parent).toBeInViewport();
    await expect(parent).toHaveClass(/question-flash/);
  });
});
