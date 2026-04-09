import { expect, type Page } from "@playwright/test";
import { fnv1a } from "../packages/shared/src/hash.js";

/** Compute the scoped localStorage key prefix for a token. */
function scopePrefix(token: string): string {
  return `s${fnv1a(token)}:`;
}

/** Extract the person token from the current page URL. */
function tokenFromUrl(url: string): string {
  const match = url.match(/\/p\/([^/#?]+)/);
  if (!match) throw new Error(`Can't extract token from URL: ${url}`);
  return match[1];
}

/** Read a scoped localStorage key for the current page's person. */
export async function scopedGet(page: Page, key: string): Promise<string | null> {
  const prefix = scopePrefix(tokenFromUrl(page.url()));
  return page.evaluate(({ p, k }) => localStorage.getItem(p + k), { p: prefix, k: key });
}

/** Write a scoped localStorage key for the current page's person. */
export async function scopedSet(page: Page, key: string, value: string): Promise<void> {
  const prefix = scopePrefix(tokenFromUrl(page.url()));
  await page.evaluate(({ p, k, v }) => localStorage.setItem(p + k, v), { p: prefix, k: key, v: value });
}

/** Create a group (all-questions mode by default), set up admin + one partner. Returns Bob's link. */
export async function createGroupAndSetup(
  page: Page,
  opts: { mode?: "all" | "filtered"; encrypted?: boolean; adminName?: string; partnerName?: string } = {},
) {
  const { mode = "all", encrypted = false, adminName = "Alice", partnerName = "Bob" } = opts;

  await page.goto("/");
  await page.getByText("Get started").click();

  if (mode === "all") {
    await page.getByText("All questions").click();
  }
  if (encrypted) {
    await page.getByLabel("End-to-end encryption").check();
  }

  await page.getByText("Create group").click();
  await expect(page).toHaveURL(/\/p\/.+/);

  await expect(page.getByText("Set up your group")).toBeVisible();
  await page.getByPlaceholder("Enter your name").fill(adminName);
  await page.getByPlaceholder("Partner's name").fill(partnerName);
  await page.getByText("Create & get links").click();

  await expect(page.getByText("You're all set")).toBeVisible();

  const partnerLink = await page.locator("input[readonly]").inputValue();

  return { partnerLink };
}

/** Navigate through intro screen. */
export async function goThroughIntro(page: Page) {
  await expect(page.getByText("Here's how it works")).toBeVisible();
  await page.getByText("Let's go").click();
}

/** Set selected categories via scoped localStorage. */
export async function setCategories(page: Page, categoryIds: string[]) {
  await scopedSet(page, "selectedCategories", JSON.stringify(categoryIds));
}

/** Set tier level via scoped localStorage. */
export async function setTier(page: Page, tier: number) {
  await scopedSet(page, "selectedTier", String(tier));
}

/** Answer all visible questions until "All done!" appears. Handles welcome screens automatically. */
export async function answerAllQuestions(page: Page, rating: "yes" | "no" | "maybe" = "yes") {
  for (let i = 0; i < 200; i++) {
    if (
      await page
        .getByText("All done!")
        .isVisible()
        .catch(() => false)
    )
      break;

    // Wait for either a welcome screen "Start" or a question rating button
    const startBtn = page.getByRole("button", { name: "Start" });
    const ratingBtn = page.getByRole("button", { name: "Yes" });
    await expect(startBtn.or(ratingBtn).or(page.getByText("All done!"))).toBeVisible();

    if (
      await page
        .getByText("All done!")
        .isVisible()
        .catch(() => false)
    )
      break;

    // Dismiss welcome screen if showing (has "Start" but no "Yes" button)
    if (await startBtn.isVisible().catch(() => false)) {
      if (!(await ratingBtn.isVisible().catch(() => false))) {
        await startBtn.click();
        continue;
      }
    }

    if (rating === "yes") {
      await page.getByRole("button", { name: "Yes" }).click();
      await page.getByRole("button", { name: "Now" }).click();
    } else if (rating === "no") {
      await page.getByRole("button", { name: "No" }).click();
    } else {
      await page.getByRole("button", { name: "Maybe" }).click();
    }
  }
  await expect(page.getByText("All done!")).toBeVisible();
}

/**
 * Click "Start filling out" then go through intro.
 * Optionally restrict to a single category (set before navigating).
 */
export async function startFillingWithCategory(page: Page, category: string) {
  await setCategories(page, [category]);
  await page.getByText("Start filling out").click();
  await goThroughIntro(page);
}
