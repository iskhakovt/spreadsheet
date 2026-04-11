import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro } from "./helpers.js";

/**
 * Regression guard for the "No questions for your selected categories"
 * empty state.
 *
 * Every other E2E test calls `setCategories(page, [...])` before
 * navigating into the question flow. That helper writes directly to
 * scoped localStorage and bypasses the UI entirely — which means the
 * fresh-user code path (no categories stored → component mounts →
 * default-selection propagates through a re-render) was never actually
 * exercised.
 *
 * A prior bug in Question.tsx initialised `selectedCategories` from
 * localStorage inline and tried to set defaults in a useEffect. Because
 * useEffect doesn't trigger a re-render by itself, the first render
 * passed an empty category list to buildScreens, `qScreens.length === 0`,
 * and the empty-state card painted instead of the first question. The
 * fix lifted the default into a useState lazy initializer so the value is
 * present on first render.
 *
 * This test does NOT call setCategories — it relies entirely on the UI
 * default path. If the bug regresses, the first assertion fails with the
 * empty-state message still visible.
 */
test("fresh user: clicking Start filling out lands on the first question (no preseed)", async ({ page }) => {
  await createGroupAndSetup(page);

  // Start the question flow from the post-setup screen. The app has NOT
  // been told which categories to use — this is the path a real first-time
  // user takes.
  await page.getByText("Start filling out").click();
  await goThroughIntro(page);

  // The empty-state card must not appear — the fresh-user default
  // (auto-select all categories) must have kicked in before first paint.
  await expect(page.getByText("No questions for your selected categories.")).toHaveCount(0);

  // And we should be inside the flow: either the first Category Welcome
  // screen (pressable "Start" button) or the first Question (rating radios).
  const welcomeStart = page.getByRole("button", { name: "Start" });
  const yesRadio = page.getByRole("radio", { name: "Yes" });
  await expect(welcomeStart.or(yesRadio)).toBeVisible();
});
