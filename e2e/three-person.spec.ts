import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

/**
 * 3-person E2E test — exercises pair tabs, keyboard navigation, and the
 * "(Name)" parenthetical on other-vs-other pairs that only appear in
 * groups of 3+. Uses "Touch & Body" which has both mutual and give/receive
 * questions so both display paths are exercised.
 */
test.describe("3-person group results", () => {
  test("pair tabs render for all 3 pairs with correct labels", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    // Alice: fill out and mark complete
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Touch & Body");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob: fill out and mark complete
    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Touch & Body");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();
    await expect(bob.getByText("Waiting for everyone")).toBeVisible();

    // Carol: fill out and mark complete — triggers results for all
    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Touch & Body");
    await answerAllQuestions(carol, "yes");
    await carol.getByRole("button", { name: "I'm done" }).click();

    // Carol should see the results page
    await expect(carol.getByText("Your matches")).toBeVisible();

    // (a) Verify 3 pair tabs are rendered — viewer-pairs first, then other-vs-other.
    // Carol is the viewer, so tabs should be: "You & Alice", "You & Bob", "Alice & Bob"
    const tabList = carol.getByRole("tablist", { name: "Pair results" });
    await expect(tabList).toBeVisible();

    const tabs = tabList.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText("You & Alice");
    await expect(tabs.nth(1)).toContainText("You & Bob");
    await expect(tabs.nth(2)).toContainText("Alice & Bob");

    // First tab should be active by default
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");

    // Polycule subtitle renders for 3+ people
    await expect(carol.getByText("3 people, one shared space")).toBeVisible();
  });

  test("clicking pair tabs switches visible results", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    // Everyone answers yes so all pairs have matches
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Touch & Body");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();

    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Touch & Body");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Touch & Body");
    await answerAllQuestions(carol, "yes");
    await carol.getByRole("button", { name: "I'm done" }).click();

    await expect(carol.getByText("Your matches")).toBeVisible();

    // Click the "Alice & Bob" tab (other-vs-other pair)
    const tabList = carol.getByRole("tablist", { name: "Pair results" });
    await tabList.getByRole("tab", { name: /Alice & Bob/ }).click();

    // The tabpanel should be visible with matches
    const tabpanel = carol.getByRole("tabpanel");
    await expect(tabpanel).toBeVisible();
    const matchRows = tabpanel.locator('[data-testid="match-row"]');
    await expect(matchRows.first()).toBeVisible();
    expect(await matchRows.count()).toBeGreaterThan(0);

    // Switch back to "You & Alice" tab
    await tabList.getByRole("tab", { name: /You & Alice/ }).click();
    await expect(carol.getByRole("tabpanel")).toBeVisible();
  });

  test("other-vs-other pair shows parenthetical name on give/receive rows", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    // Everyone answers yes
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Touch & Body");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();

    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Touch & Body");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Touch & Body");
    await answerAllQuestions(carol, "yes");
    await carol.getByRole("button", { name: "I'm done" }).click();

    await expect(carol.getByText("Your matches")).toBeVisible();

    // Navigate to other-vs-other pair: "Alice & Bob"
    const tabList = carol.getByRole("tablist", { name: "Pair results" });
    await tabList.getByRole("tab", { name: /Alice & Bob/ }).click();

    // (b) Other-vs-other give/receive rows should have "(Alice)" parenthetical
    // because Alice is person A and aIsViewer=false. Touch & Body has give/receive
    // questions like "Giving a sensual massage (Alice)" to disambiguate whose
    // perspective the row is from.
    const tabpanel = carol.getByRole("tabpanel");
    await expect(tabpanel.getByText(/\(Alice\)/)).toBeVisible();

    // Verify viewer's own pair does NOT have parentheticals
    await tabList.getByRole("tab", { name: /You & Alice/ }).click();
    // On viewer pairs, no parenthetical should appear since rows naturally
    // read from the viewer's perspective
    await expect(carol.getByRole("tabpanel").getByText(/\(You\)/)).toHaveCount(0);
  });

  test("tab keyboard navigation cycles through pairs", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Touch & Body");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();

    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Touch & Body");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Touch & Body");
    await answerAllQuestions(carol, "yes");
    await carol.getByRole("button", { name: "I'm done" }).click();

    await expect(carol.getByText("Your matches")).toBeVisible();

    const tabList = carol.getByRole("tablist", { name: "Pair results" });
    const tabs = tabList.getByRole("tab");

    // Focus first tab
    await tabs.nth(0).focus();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

    // (c) ArrowRight moves to second tab
    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();

    // ArrowRight again moves to third tab
    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();

    // ArrowRight wraps around to first tab
    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toBeFocused();

    // ArrowLeft wraps to last tab
    await carol.keyboard.press("ArrowLeft");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();

    // Home jumps to first tab
    await carol.keyboard.press("Home");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toBeFocused();

    // End jumps to last tab
    await carol.keyboard.press("End");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();
  });
});
