import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  answerQuestionsCycling,
  createGroupAndSetup,
  goThroughIntro,
  NAV_TIMEOUT,
  narrowToCategory,
  WS_TIMEOUT,
} from "./helpers.js";

test.describe("results display", () => {
  test("shows correct match labels for different answer combinations", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Bondage & Restraint");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Bondage & Restraint");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(bob.getByText("You & Alice")).toBeVisible();

    // All should be matches (both yes). Target the data-match-type
    // attribute on match rows so we don't collide with summary-strip labels.
    const matchRows = bob.locator('[data-testid="match-row"][data-match-type="match"]');
    await expect(matchRows.first()).toBeVisible({ timeout: WS_TIMEOUT });
    expect(await matchRows.count()).toBeGreaterThan(0);

    // No other match types should appear.
    await expect(bob.locator('[data-testid="match-row"][data-match-type="both-maybe"]')).toHaveCount(0);
    await expect(bob.locator('[data-testid="match-row"][data-match-type="possible"]')).toHaveCount(0);
  });

  test("mixed answers produce varied match types", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");

    // The ratings cycle across "Group & External" in seed order. The first
    // question is the category gate `external-people-generally`, which is an
    // `agreement` question — Alice + Bob both "yes" there resolves to
    // `aligned-yes` ("Both in"), not `match`. The remaining items are
    // `activity` questions and produce the possible / both-maybe / fantasy
    // variety this test asserts. We only check that several *distinct* types
    // co-exist on one page, so exact screen↔question mapping doesn't matter.
    const aliceRatings = ["yes", "maybe", "maybe", "fantasy", "yes", "no", "if-partner-wants", "maybe"] as const;
    const bobRatings = ["yes", "yes", "maybe", "fantasy", "no", "yes", "maybe", "if-partner-wants"] as const;

    await answerQuestionsCycling(alice, aliceRatings);
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible({ timeout: NAV_TIMEOUT });

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerQuestionsCycling(bob, bobRatings);
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

    // Verify that multiple distinct match types appear on the same results
    // page. Use data-match-type to avoid colliding with summary strip labels.
    const row = (type: string) => bob.locator(`[data-testid="match-row"][data-match-type="${type}"]`);

    // The agreement gate (both "yes") + activity items give four distinct types.
    await expect(row("aligned-yes").first()).toBeVisible();
    await expect(row("possible").first()).toBeVisible();
    await expect(row("both-maybe").first()).toBeVisible();
    await expect(row("fantasy").first()).toBeVisible();
  });

  test("one says no — question hidden from results", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    // Use a pure-activity category: "Group & External" now carries an
    // `agreement` gate (external-people-generally), and an agreement question
    // surfaces a "differ" row on a yes/no split rather than hiding it. Bondage
    // is all activity, so the no-hides-the-row behavior under test still holds.
    await narrowToCategory(alice, "Bondage & Restraint");

    // Alice: all No
    await answerAllQuestions(alice, "no");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob: all Yes
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Bondage & Restraint");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible();

    // No matches should appear — all hidden because Alice said No. The
    // Comparison empty state copy was updated as part of the UI polish.
    await expect(bob.getByText("No overlaps this time")).toBeVisible();
  });

  test("give/receive match rows render without '(You)' parenthetical on viewer pair", async ({ alice, bob }) => {
    // "Bondage & Restraint" is purely give/receive (0 mutual questions in
    // the question bank), so every rendered match row exercises the
    // giveText/receiveText display path. "Group & External" (used by the
    // other tests) is mostly mutual and wouldn't catch a regression here.
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Bondage & Restraint");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Bondage & Restraint");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible();

    // At least one give/receive match row exists — category is purely g/r
    // so this guarantees the display path was exercised.
    const matchRows = bob.locator('[data-testid="match-row"]');
    await expect(matchRows.first()).toBeVisible();
    expect(await matchRows.count()).toBeGreaterThan(0);

    // Negative assertion: no row contains "(You)". Viewer is A on every
    // pair in a 2-person group, so the parenthetical must never appear.
    // This catches any regression where buildPairMatches' aIsViewer flag
    // isn't wired through correctly from Comparison.tsx.
    await expect(bob.getByText("(You)")).toHaveCount(0);
    await expect(alice.getByText("(You)")).toHaveCount(0);
  });

  test("disclosure rows show each person's stance even with no note", async ({ alice, bob }) => {
    // "Communication & Language" holds `avoid-specific-words` (a `disclose`
    // question → "Noted"). Both answer yes and write no note, yet each
    // person's stance must still render — the badge alone says nothing.
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Communication & Language");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Communication & Language");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

    const notedNotes = bob
      .locator('[data-testid="match-row"][data-match-type="noted"]')
      .first()
      .locator('[data-testid="match-notes"]');
    await expect(notedNotes).toBeVisible();
    await expect(notedNotes).toContainText("You");
    await expect(notedNotes).toContainText("Yes");
  });

  test("agreement-split rows show each person's stance", async ({ alice, bob }) => {
    // The "Group & External" gate (external-people-generally) is an
    // `agreement` question; Alice yes vs Bob no → "You differ", and the row
    // must reveal the opposing stances.
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "no");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

    const differNotes = bob
      .locator('[data-testid="match-row"][data-match-type="differ"]')
      .first()
      .locator('[data-testid="match-notes"]');
    await expect(differNotes).toBeVisible();
    await expect(differNotes).toContainText("Yes"); // Alice
    await expect(differNotes).toContainText("No"); // Bob (You)
  });

  test("Total matches headline excludes differ / noted / aligned-no rows", async ({ alice, bob }) => {
    // "Sensory Environment" mixes `agreement` (lighting/sound/scent) and
    // `disclose` (sensory needs) questions, so a varied split produces
    // differ + noted + aligned-no alongside counted rows — exercising the
    // EXCLUDED_FROM_TOTAL headline filter.
    const { partnerLink } = await createGroupAndSetup(alice);
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Sensory Environment");
    await answerQuestionsCycling(alice, ["yes", "no", "yes", "maybe", "no"]);
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Sensory Environment");
    await answerQuestionsCycling(bob, ["no", "no", "yes", "maybe", "yes"]);
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

    const rendered = await bob.locator('[data-testid="match-row"]').count();
    const excluded = await bob
      .locator('[data-match-type="differ"], [data-match-type="noted"], [data-match-type="aligned-no"]')
      .count();
    const total = Number(await bob.getByTestId("total-matches-count").textContent());

    // The scenario must actually produce excluded rows, or the check is vacuous.
    expect(excluded).toBeGreaterThan(0);
    expect(total).toBe(rendered - excluded);
  });
});
