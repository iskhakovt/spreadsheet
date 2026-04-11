import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("edit after completion", () => {
  test("Alice edits an answer on /results, Bob sees the pair matches update live", async ({ alice, bob }) => {
    // Both Alice and Bob complete the questionnaire answering "yes" to everything
    // so they'll see "Match" matches when both land on /results.
    const { partnerLink } = await createGroupAndSetup(alice);

    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Both reach /results. Alice's view should update via WS.
    await expect(alice.getByText("Your results")).toBeVisible({ timeout: 5000 });
    await expect(bob.getByText("Your results")).toBeVisible({ timeout: 5000 });

    // Both should see "Match" labels since everyone answered yes
    await expect(alice.getByText("Match", { exact: true }).first()).toBeVisible();
    await expect(bob.getByText("Match", { exact: true }).first()).toBeVisible();

    // Snapshot Bob's match count BEFORE Alice's edit so we can assert a
    // concrete drop rather than a magic-number upper bound.
    const matchesBefore = await bob.getByText("Match", { exact: true }).count();
    expect(matchesBefore).toBeGreaterThan(0);

    // Alice clicks "Change my answers" — navigates back to /questions,
    // crucially WITHOUT calling unmarkComplete. Bob is NOT kicked from /results.
    await alice.getByText("Change my answers").click();
    await expect(alice).toHaveURL(/\/questions/);

    // Bob is still on /results (not kicked to /waiting)
    await expect(bob.getByText("Your results")).toBeVisible();

    // Alice changes her first answer from "yes" to "no". This triggers the
    // 3s sync.push debounce → server commit → journalEvents emit → Bob's
    // tracked subscription → setQueryData merge → Comparison re-render.
    await expect(alice.getByRole("radio", { name: "No" })).toBeVisible();
    await alice.getByRole("radio", { name: "No" }).click();

    // Poll Bob's match count until it drops. This covers the full pipeline
    // latency (debounce + network + subscription + merge + re-render)
    // without a hard-coded sleep.
    await expect(async () => {
      const matchesAfter = await bob.getByText("Match", { exact: true }).count();
      expect(matchesAfter).toBeLessThan(matchesBefore);
    }).toPass({ timeout: 10_000 });
  });

  // Single-user test — uses built-in `page` fixture, no manual context needed.
  test("Alice's /waiting screen has an 'Edit my answers' button that navigates without unmarking", async ({ page }) => {
    await createGroupAndSetup(page);

    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await answerAllQuestions(page, "yes");
    await page.getByRole("button", { name: "I'm done" }).click();

    // Page is now on /waiting
    await expect(page.getByText("Waiting for everyone")).toBeVisible();
    await expect(page).toHaveURL(/\/waiting/);

    // Click "Edit my answers" — navigates to /questions
    await page.getByRole("button", { name: "Edit my answers" }).click();
    await expect(page).toHaveURL(/\/questions/);

    // isCompleted should NOT have been touched server-side. We verify this
    // with a reload (not goBack alone) — goBack replays the SPA history
    // entry and could pass against a stale in-memory completion flag.
    // `reload()` forces the guard to re-evaluate against fresh server
    // status; if isCompleted were false, the guard would bounce us back
    // to /questions.
    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/waiting/);
    await expect(page.getByText("Waiting for everyone")).toBeVisible();
  });
});
