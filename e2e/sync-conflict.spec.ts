import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, scopedGet, scopedSet, setCategories } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`sync conflict resolution (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("stale stoken conflict resolves without data loss", async ({ page }) => {
      await createGroupAndSetup(page, { encrypted });
      await setCategories(page, ["group"]);
      await page.getByText("Start filling out").click();
      await goThroughIntro(page);
      await expect(page.getByText(/\d+ questions/)).toBeVisible();
      await page.getByRole("button", { name: "Start" }).click();

      // Q1: answer Yes + Now
      await page.getByRole("button", { name: "Yes" }).click();
      await page.getByRole("button", { name: "Now" }).click();

      // Wait for auto-sync to complete
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Save the current stoken
      const stokenAfterQ1 = await scopedGet(page, "stoken");
      expect(stokenAfterQ1).toBeTruthy();

      // Q2: answer No
      await page.getByRole("button", { name: "No" }).click();

      // Wait for auto-sync
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Roll back stoken to stale value
      await scopedSet(page, "stoken", stokenAfterQ1!);

      // Q3: answer Maybe
      await page.getByRole("button", { name: "Maybe" }).click();

      // Wait for auto-sync to handle the conflict + retry
      await expect(async () => {
        const raw = await scopedGet(page, "pendingOps");
        expect(JSON.parse(raw || "[]").length).toBe(0);
      }).toPass({ timeout: 10_000 });

      // Verify all 3 answers survived the merge
      const answersRaw = await scopedGet(page, "answers");
      const answers = JSON.parse(answersRaw || "{}");
      expect(Object.keys(answers).length).toBe(3);

      const ratings = Object.values(answers as Record<string, { rating: string }>).map((a) => a.rating);
      expect(ratings).toContain("yes");
      expect(ratings).toContain("no");
      expect(ratings).toContain("maybe");
    });
  });
}
