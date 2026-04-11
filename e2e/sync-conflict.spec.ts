import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory, scopedGet, scopedSet } from "./helpers.js";

/**
 * This test uses `scopedGet` and `scopedSet` — the two "sharp tool"
 * helpers reserved for invariants/state the UI cannot observe or produce.
 * The rationale per helper:
 *
 *  - `scopedGet(page, "pendingOps")` — sync completion is not observable
 *    from the DOM. The sync indicator is hidden during a 5s grace window,
 *    and even outside that window it shows "N unsynced" rather than "last
 *    synced ID". We need a deterministic signal that the push has landed
 *    before rolling back the stoken; polling pendingOps until it drains
 *    is the least-bad option and beats a hard sleep.
 *
 *  - `scopedSet(page, "stoken", stale)` — corrupting the stoken to force
 *    a sync conflict is adversarial by design. The UI will never produce
 *    a stale stoken on its own — the whole point is to prove the conflict
 *    path works when something external has poisoned the cursor. There
 *    is no UI equivalent.
 */
for (const encrypted of [false, true]) {
  test.describe(`sync conflict resolution (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("stale stoken conflict resolves without data loss", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Group & External");
      await expect(page.getByText(/\d+ questions/)).toBeVisible();
      await page.getByRole("button", { name: "Start" }).click();

      // Q1: answer Yes
      await page.getByRole("radio", { name: "Yes" }).click();

      // Wait for auto-sync to complete (pendingOps drain)
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Save the current stoken — we'll use it to force a conflict
      const stokenAfterQ1 = await scopedGet(page, "stoken");
      expect(stokenAfterQ1).toBeTruthy();

      // Q2: answer No
      await page.getByRole("radio", { name: "No" }).click();

      // Wait for auto-sync
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Roll back stoken to stale value — adversarial manipulation,
      // no UI path for this
      await scopedSet(page, "stoken", stokenAfterQ1!);

      // Q3: answer Maybe
      await page.getByRole("radio", { name: "Maybe" }).click();

      // Wait for auto-sync to handle the conflict + retry
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Verify all 3 answers survived the merge by navigating to the
      // Review screen via the Progress link + Summary (UI-reachable path)
      await page.getByRole("button", { name: "Progress" }).click();
      await expect(page.getByText("Your progress")).toBeVisible();
      await page.getByRole("button", { name: "Review answers" }).click();
      await expect(page.getByText("Review your answers")).toBeVisible();

      // Expect Yes, No, Maybe to all appear in the review list
      await expect(page.getByText("Yes", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("No", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Maybe", { exact: true }).first()).toBeVisible();
    });
  });
}
