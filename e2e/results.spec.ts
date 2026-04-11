import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("results display", () => {
  test("shows correct match labels for different answer combinations", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { showTiming: true });

    // Alice: answer all questions as Yes + Now (showTiming enabled)
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: answer all questions as Yes + Now too (should produce all "Go for it")
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your matches")).toBeVisible();
    await expect(bob.getByText("You & Alice")).toBeVisible();

    // All should be green-light matches (both yes + both now). Target the
    // data-match-type attribute on match rows so we don't collide with the
    // summary-strip label which also reads "Go for it".
    const greenLightRows = bob.locator('[data-testid="match-row"][data-match-type="green-light"]');
    await expect(greenLightRows.first()).toBeVisible();
    expect(await greenLightRows.count()).toBeGreaterThan(0);

    // No other match types should appear — target by data-match-type so
    // we don't collide with summary strip labels (which always render,
    // including "Go for it" with count 0, so plain getByText won't work).
    await expect(bob.locator('[data-testid="match-row"][data-match-type="match"]')).toHaveCount(0);
    await expect(bob.locator('[data-testid="match-row"][data-match-type="both-maybe"]')).toHaveCount(0);
    await expect(bob.locator('[data-testid="match-row"][data-match-type="possible"]')).toHaveCount(0);
  });

  test("mixed answers produce varied match types", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");

    // Alice: answer all as Maybe
    await answerAllQuestions(alice, "maybe");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: answer all as Maybe too
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "maybe");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your matches")).toBeVisible();

    // All should be both-maybe (worth discussing). Target match-type
    // attribute to avoid collision with summary strip labels.
    const bothMaybeRows = bob.locator('[data-testid="match-row"][data-match-type="both-maybe"]');
    await expect(bothMaybeRows.first()).toBeVisible();
    expect(await bothMaybeRows.count()).toBeGreaterThan(0);

    // No green-light or plain match rows. Target by data-match-type so we
    // don't collide with the summary strip's always-visible "Go for it" label.
    await expect(bob.locator('[data-testid="match-row"][data-match-type="green-light"]')).toHaveCount(0);
    await expect(bob.locator('[data-testid="match-row"][data-match-type="match"]')).toHaveCount(0);
  });

  test("one says no — question hidden from results", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");

    // Alice: all No
    await answerAllQuestions(alice, "no");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: all Yes
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your matches")).toBeVisible();

    // No matches should appear — all hidden because Alice said No. The
    // Comparison empty state copy was updated as part of the UI polish.
    await expect(bob.getByText("No overlaps this time")).toBeVisible();
  });
});
