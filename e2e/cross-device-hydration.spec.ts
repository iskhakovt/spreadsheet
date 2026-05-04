import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  createGroupAndSetup,
  goThroughIntro,
  NAV_TIMEOUT,
  narrowToCategory,
  personBase,
  scopedGet,
} from "./helpers.js";

/**
 * Regression for #135 — a participant opens their /p/$token#key=… link on a
 * device that has no localStorage entry for that token (different device,
 * private window, cleared site data, fresh PWA install). They expect to see
 * their previous answers pre-filled. The journal is the source of truth, so
 * useSelfJournal hydrates them on mount.
 *
 * The "fresh device" is simulated by loading the same person URL in an
 * independent BrowserContext (the `alice` fixture) — separate localStorage,
 * no cookies — after the original tab has answered + synced.
 */
test.describe("cross-device hydration from server journal", () => {
  test("fresh browser context sees previously-given answers via Summary", async ({ page, alice }) => {
    // Original device: create group, narrow scope, answer all questions in
    // a single category. The journal now holds those answers.
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");
    await answerAllQuestions(page, "yes");

    // Wait for auto-sync to drain (default 3s debounce).
    await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

    const summaryUrl = personBase(page.url()) + "/summary";

    // Capture the original device's answered count. The "X of Y" total on
    // /summary depends on the local `selectedCategories` UI pref, which is
    // device-local — so we extract just the X (number of answered keys) to
    // compare across devices, since that's what the journal carries.
    await page.goto(summaryUrl);
    const originalText = await page
      .getByText(/\d+ of \d+ answered/)
      .first()
      .textContent();
    const originalAnswered = Number(originalText!.match(/^(\d+)/)![1]);
    expect(originalAnswered).toBeGreaterThan(0);

    // Fresh device — independent BrowserContext, no shared localStorage.
    // /summary is a free route so the guard doesn't redirect even though
    // hasSeenIntro is false on this fresh device.
    await alice.goto(summaryUrl);

    // After hydration, the per-category progress on Aftercare matches the
    // original (the journal carries answers, not category selections — so
    // we look at the category row, which is the canonical "answered count
    // for this category" regardless of which categories are enabled).
    // Aftercare row text format: "Aftercare ... X/Y" where X is answered.
    // Match using a flexible regex to avoid coupling to layout details.
    await expect(alice.getByText(`${originalAnswered}/${originalAnswered}`).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });

    // selfJournalCursor was persisted on hydration so the next reload
    // becomes a delta fetch instead of a full replay.
    const cursorOnFresh = await scopedGet(alice, "selfJournalCursor");
    expect(cursorOnFresh).not.toBeNull();
    expect(Number(cursorOnFresh)).toBeGreaterThan(0);
  });

  test("delta fetch on subsequent reload — cursor stays put on empty delta", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");

    // Answer one question, wait for sync.
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

    // The self-journal subscription's onData advances the cursor as soon as
    // the WS delivers the entry — wait for it before reloading.
    await expect.poll(() => scopedGet(page, "selfJournalCursor"), { timeout: 5_000 }).not.toBeNull();
    const cursorAfterFirst = await scopedGet(page, "selfJournalCursor");
    expect(Number(cursorAfterFirst)).toBeGreaterThan(0);

    // Reload — the layout's useSelfJournal calls sync.selfJournal with the
    // saved cursor, gets an empty delta, cursor stays put.
    await page.reload();
    // After reload the flow auto-advances past the answered question. Step
    // back to Q1 to verify the previous "Yes" survived.
    await page.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toHaveAttribute("aria-checked", "true", {
      timeout: NAV_TIMEOUT,
    });
    expect(await scopedGet(page, "selfJournalCursor")).toBe(cursorAfterFirst);
  });
});
