import { expect, type Page } from "@playwright/test";
import { fnv1a } from "../packages/shared/src/hash.js";

/**
 * E2E test helpers — UI-driven by policy.
 *
 * ## The bypass policy
 *
 * Tests MUST exercise real user journeys. Anything a real user would see,
 * click, or navigate to is done through the UI — not by poking at routes,
 * localStorage, or query caches.
 *
 * The two exceptions:
 *   1. `scopedGet` — reading localStorage as an observer to assert
 *      invariants that are hard to read off the DOM (e.g. polling
 *      `pendingOps` until it clears to detect sync completion without
 *      baking in a hard sleep).
 *   2. `scopedSet` — writing localStorage to simulate adversarial state
 *      the UI can't produce (e.g. rolling back `stoken` to a stale value
 *      for the sync-conflict test).
 *
 * These are the sharp tools. If you reach for them, add a comment
 * explaining *why* no UI equivalent exists. If a reviewer can see a UI
 * path that would express the same intent, the helper is wrong.
 *
 * Why this matters: a prior `setCategories` helper wrote directly to
 * `selectedCategories` and every test called it to bypass the Summary
 * screen. That meant a fresh-user bug in `Question.tsx`'s category
 * default-selection (useEffect-in-lazy-init trap) went undetected —
 * *not a single test* actually mounted the question flow without
 * pre-seeded storage. Every bypass creates a blind spot that must be
 * closed elsewhere; it is safer not to create them in the first place.
 */

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

/** Extract the /p/{token} base path from a full URL. */
export function personBase(url: string): string {
  const match = url.match(/(\/p\/[^/#?]+)/);
  if (!match) throw new Error(`Can't extract person base from URL: ${url}`);
  return match[1];
}

/**
 * Read a scoped localStorage key for the current page's person.
 *
 * Reserved for invariants that can't be observed off the DOM (e.g.
 * polling `pendingOps` until it drains as a sync-completion signal).
 * Do NOT use this to check state that's visible in the UI — assert
 * the UI instead.
 */
export async function scopedGet(page: Page, key: string): Promise<string | null> {
  const prefix = scopePrefix(tokenFromUrl(page.url()));
  return page.evaluate(({ p, k }) => localStorage.getItem(p + k), { p: prefix, k: key });
}

/**
 * Write a scoped localStorage key for the current page's person.
 *
 * Reserved for adversarial state the UI can't produce (e.g. rolling
 * back `stoken` to force a sync conflict). Every call site MUST have
 * a comment explaining why there is no UI path.
 */
export async function scopedSet(page: Page, key: string, value: string): Promise<void> {
  const prefix = scopePrefix(tokenFromUrl(page.url()));
  await page.evaluate(({ p, k, v }) => localStorage.setItem(p + k, v), { p: prefix, k: key, v: value });
}

/** Create a group (all-questions mode by default), set up admin + partners. Returns partner links. */
export async function createGroupAndSetup(
  page: Page,
  opts: {
    mode?: "all" | "filtered";
    encrypted?: boolean;
    showTiming?: boolean;
    adminName?: string;
    partnerName?: string;
    /** Additional partner names beyond the first. Creates a 3+ person group. */
    extraPartners?: string[];
  } = {},
) {
  const {
    mode = "all",
    encrypted = false,
    showTiming = false,
    adminName = "Alice",
    partnerName = "Bob",
    extraPartners = [],
  } = opts;

  await page.goto("/");
  await page.getByText("Get started").click();

  if (mode === "all") {
    await page.getByText("All questions").click();
  }
  if (encrypted) {
    await page.getByLabel("End-to-end encryption").check();
  }
  if (showTiming) {
    await page.getByLabel('Ask "now or later?"').check();
  }

  await page.getByText("Create group").click();
  await expect(page).toHaveURL(/\/p\/.+/);

  await expect(page.getByText("Set up your group")).toBeVisible();
  await page.getByPlaceholder("Enter your name").fill(adminName);
  await page.getByPlaceholder("Partner's name").fill(partnerName);

  // Add extra partners via the "+ Add another person" button
  for (const name of extraPartners) {
    await page.getByText("+ Add another person").click();
    // Fill the last (newly added) partner name input
    const partnerInputs = page.getByPlaceholder("Partner's name");
    await partnerInputs.last().fill(name);
  }

  await page.getByText("Create & get links").click();

  await expect(page.getByText("You're all set")).toBeVisible();

  // Collect partner links only (not the admin's own link on encrypted groups).
  // Assert the expected count to fail fast with a clear message.
  const expectedPartnerCount = 1 + extraPartners.length;
  const linkInputs = page.locator('[data-testid="partner-link"]');
  await expect(linkInputs).toHaveCount(expectedPartnerCount);
  const partnerLinks: string[] = [];
  for (let i = 0; i < expectedPartnerCount; i++) {
    partnerLinks.push(await linkInputs.nth(i).inputValue());
  }

  // Backwards-compatible: return first link as `partnerLink` plus full array
  return { partnerLink: partnerLinks[0], partnerLinks };
}

/** Navigate through intro screen. */
export async function goThroughIntro(page: Page) {
  await expect(page.getByText("Here's how it works")).toBeVisible();
  await page.getByText("Let's go").click();
}

/**
 * Narrow the selected categories to a single target via the Summary UI.
 *
 * Precondition: the page is on the first category welcome screen (right
 * after `goThroughIntro`). This is the natural point in the journey where
 * a real user who wants to narrow their scope would click through to
 * Summary.
 *
 * Flow: Welcome → View all categories → (uncheck every category whose
 * label doesn't match `targetLabel`) → click the target category entry
 * → lands on the target's welcome screen, ready for `answerAllQuestions`.
 *
 * Adds a few seconds per test compared to bypassing via localStorage,
 * but exercises the Summary UI — which users actually use for this.
 */
export async function narrowToCategory(page: Page, targetLabel: string) {
  // From any category welcome, "View all categories" → Summary
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await page.getByRole("button", { name: "View all categories" }).click();

  await expect(page.getByText("Your progress")).toBeVisible();

  // Uncheck every category except the target. The checkbox accessibility
  // name is "Include <Category Label>". We read the list off the DOM so
  // this helper survives adding/removing categories without editing here.
  const checkboxes = page.getByRole("checkbox");
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = checkboxes.nth(i);
    const name = (await cb.getAttribute("aria-label")) ?? "";
    if (name === `Include ${targetLabel}`) continue;
    // Only uncheck if currently checked; Playwright's `.uncheck()` is a
    // no-op on an already-unchecked checkbox but still generates a click.
    if (await cb.isChecked()) {
      await cb.uncheck();
    }
  }

  // Click the target category row — this navigates directly to the
  // target's welcome screen via `onNavigateToCategory(category.id)`.
  // Escape regex metacharacters in the label so labels containing `(`,
  // `[`, `.`, `+`, `*`, `?` etc. don't break the match. Current labels
  // are metacharacter-free but this is cheap defense against future
  // labels like "Role Play (Fantasy)".
  const escapedLabel = targetLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^${escapedLabel}`) }).click();

  // We should now be on the target category's welcome screen, ready to
  // click Start.
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
}

/** Check if we've reached the end of questions. */
function doneLocator(page: Page) {
  return page.getByText("All done!").or(page.getByText("That's the last one"));
}

type Rating = "yes" | "no" | "maybe" | "if-partner-wants" | "fantasy";

/** Answer all visible questions cycling through the given ratings. Handles welcome screens automatically.
 *  `offset` shifts the starting index — useful for making two people answer differently with the same array. */
export async function answerQuestionsCycling(page: Page, ratings: readonly Rating[], offset = 0) {
  let i = offset;
  for (let guard = 0; guard < 200; guard++) {
    if (
      await doneLocator(page)
        .isVisible()
        .catch(() => false)
    )
      break;

    const startBtn = page.getByRole("button", { name: "Start" });
    const ratingLabel = page.getByText("Yes", { exact: true });
    await expect(startBtn.or(ratingLabel).or(doneLocator(page))).toBeVisible();

    if (
      await doneLocator(page)
        .isVisible()
        .catch(() => false)
    )
      break;

    if (await startBtn.isVisible().catch(() => false)) {
      if (!(await ratingLabel.isVisible().catch(() => false))) {
        await startBtn.click();
        continue;
      }
    }

    const rating = ratings[i % ratings.length];
    i++;

    if (rating === "yes") {
      await page.getByRole("radio", { name: "Yes" }).click();
    } else if (rating === "if-partner-wants") {
      await page.getByRole("radio", { name: "If partner wants" }).click();
    } else if (rating === "maybe") {
      await page.getByRole("radio", { name: "Maybe" }).click();
    } else if (rating === "fantasy") {
      await page.getByRole("radio", { name: "Fantasy" }).click();
    } else {
      await page.getByRole("radio", { name: "No" }).click();
    }

    // Dismiss timing if it appears (yes and if-partner-wants trigger it)
    if (rating === "yes" || rating === "if-partner-wants") {
      const nowBtn = page.getByRole("button", { name: "Now" });
      if (await nowBtn.isVisible().catch(() => false)) {
        await nowBtn.click();
      }
    }
  }
  await expect(doneLocator(page)).toBeVisible();
}

/** Answer all visible questions until done. Handles welcome screens automatically. */
export async function answerAllQuestions(page: Page, rating: "yes" | "no" | "maybe" = "yes") {
  for (let i = 0; i < 200; i++) {
    if (
      await doneLocator(page)
        .isVisible()
        .catch(() => false)
    )
      break;

    // Wait for either a welcome screen "Start" or a question rating label
    const startBtn = page.getByRole("button", { name: "Start" });
    const ratingLabel = page.getByText("Yes", { exact: true });
    await expect(startBtn.or(ratingLabel).or(doneLocator(page))).toBeVisible();

    if (
      await doneLocator(page)
        .isVisible()
        .catch(() => false)
    )
      break;

    // Dismiss welcome screen if showing (has "Start" but no rating labels)
    if (await startBtn.isVisible().catch(() => false)) {
      if (!(await ratingLabel.isVisible().catch(() => false))) {
        await startBtn.click();
        continue;
      }
    }

    if (rating === "yes") {
      await page.getByRole("radio", { name: "Yes" }).click();
      // Click "Now" if timing is enabled (showTiming), otherwise auto-advances
      const nowBtn = page.getByRole("button", { name: "Now" });
      if (await nowBtn.isVisible().catch(() => false)) {
        await nowBtn.click();
      }
    } else if (rating === "no") {
      await page.getByRole("radio", { name: "No" }).click();
    } else {
      await page.getByRole("radio", { name: "Maybe" }).click();
    }
  }
  await expect(doneLocator(page)).toBeVisible();
}
