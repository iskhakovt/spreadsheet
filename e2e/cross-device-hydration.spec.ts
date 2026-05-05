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
 *
 * Parameterized over `encrypted ∈ {false, true}` so the decrypt path
 * (replayJournal + unwrapSensitive inside useSelfJournal) is exercised in
 * encrypted mode. In encrypted mode the fragment-borne `#key=...` must be
 * preserved when building the summary URL — Playwright's page.url() does
 * include the fragment, but `personBase()` strips it, so we re-attach.
 */
test.describe("cross-device hydration from server journal", () => {
  for (const encrypted of [false, true]) {
    test(`fresh browser context sees previously-given answers via Summary [encrypted=${encrypted}]`, async ({
      page,
      alice,
    }) => {
      // Original device: create group. After setupAdmin, the "You're all
      // set" screen exposes the admin's invite link — capture it BEFORE
      // any further navigation, because TanStack Router's pushState
      // navigations drop the URL fragment (same pattern as the wouter
      // note in design/ui.md). The admin link's input value is the
      // canonical URL including `#key=` when encrypted.
      await createGroupAndSetup(page, { encrypted });
      const adminUrl = await page.getByLabel("Your invite link").inputValue();
      if (encrypted) {
        expect(adminUrl).toContain("#key=");
      }

      // Now answer all questions in one category and wait for sync.
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Aftercare");
      await answerAllQuestions(page, "yes");

      // Wait for auto-sync to drain (default 3s debounce).
      await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

      // Build the summary URL by re-attaching the fragment from the
      // captured admin URL — necessary so alice.goto on a fresh
      // BrowserContext has the key it needs to decrypt the journal.
      const fragment = adminUrl.includes("#") ? adminUrl.slice(adminUrl.indexOf("#")) : "";
      const summaryUrl = personBase(adminUrl) + "/summary" + fragment;

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
      // In encrypted mode this also exercises decryption: the entries on the
      // wire are e:1:... blobs, and replayJournal must unwrap them with the
      // group key from the URL fragment before the count can render.
      await expect(alice.getByText(`${originalAnswered}/${originalAnswered}`).first()).toBeVisible({
        timeout: NAV_TIMEOUT,
      });

      // selfJournalCursor was persisted on hydration so the next reload
      // becomes a delta fetch instead of a full replay.
      const cursorOnFresh = await scopedGet(alice, "selfJournalCursor");
      expect(cursorOnFresh).not.toBeNull();
      expect(Number(cursorOnFresh)).toBeGreaterThan(0);
    });

    test(`delta fetch on subsequent reload — cursor stays put on empty delta [encrypted=${encrypted}]`, async ({
      page,
    }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Aftercare");

      // Answer one question, wait for sync.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

      // The self-journal subscription's onData advances the cursor as soon as
      // SSE delivers the entry — wait for it before reloading.
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
  }
});
