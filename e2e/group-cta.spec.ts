import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory, personBase } from "./helpers.js";

test.describe("admin /group primary CTA — state machine", () => {
  test("cycles through Start / Continue / View my answers as admin progresses", async ({ page }) => {
    // Fresh admin, group just marked ready — isReady=true, no answers yet.
    await createGroupAndSetup(page);
    const base = personBase(page.url());

    // -- State 1: "Start filling out" (no answers yet) --
    await page.goto(base + "/group");
    await expect(page.getByText("Your group")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start filling out", exact: true })).toBeVisible();

    // Click Start filling out → should land on intro (first time) or questions
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await expect(page.getByText("Here's how it works")).toBeVisible({ timeout: 2_000 });
    await goThroughIntro(page);

    // Narrow to a small category, answer a couple of questions (enough to
    // have local answers but far short of finishing the whole flow).
    await narrowToCategory(page, "Aftercare");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("radio", { name: "No", exact: true }).click();
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // -- State 2: "Continue" (some answers, not done) --
    await page.goto(base + "/group");
    await expect(page.getByText("Your group")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    // The other CTA states must be absent — guard against regressions that
    // would render multiple labels simultaneously.
    await expect(page.getByRole("button", { name: "Start filling out", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View my answers", exact: true })).toHaveCount(0);

    // Clicking Continue returns admin to questions flow (intro is skipped
    // now that hasSeenIntro is true).
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/questions$/);

    // Finish answering to trigger the completed state. Answer all remaining
    // questions with "no" (doesn't trigger the timing sub-question).
    let safety = 0;
    while (safety++ < 60) {
      const done = page.getByText("All done!").or(page.getByText("That's the last one"));
      if (await done.isVisible().catch(() => false)) break;
      const noRadio = page.getByRole("radio", { name: "No", exact: true });
      if (await noRadio.isVisible().catch(() => false)) {
        await noRadio.click();
        continue;
      }
      // Skip over any welcome interstitials if narrowing produced one.
      const startBtn = page.getByRole("button", { name: "Start", exact: true });
      if (await startBtn.isVisible().catch(() => false)) {
        await startBtn.click();
      }
    }
    await page.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(page.getByText("Waiting for everyone")).toBeVisible();

    // -- State 3: "View my answers" (completed admin returning to /group) --
    await page.goto(base + "/group");
    await expect(page.getByText("Your group")).toBeVisible();
    await expect(page.getByRole("button", { name: "View my answers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start filling out", exact: true })).toHaveCount(0);

    // Clicking View my answers → /review.
    await page.getByRole("button", { name: "View my answers", exact: true }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByText("Review your answers")).toBeVisible();
  });
});
