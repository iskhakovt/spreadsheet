import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

/**
 * 3-person E2E test — exercises pair tabs, keyboard navigation, and the
 * "(Name)" parenthetical on other-vs-other pairs that only appear in
 * groups of 3+. Uses "Touch & Body" which has both mutual and give/receive
 * questions so both display paths are exercised.
 *
 * This is deliberately a single test: the setup (3 people answering ~20
 * questions each) is expensive, and the assertions are non-destructive —
 * checking tabs, parentheticals, and keyboard nav sequentially costs
 * seconds vs. minutes of duplicated setup.
 */
test.describe("3-person group results", () => {
  test("pair tabs, parentheticals, and keyboard navigation", async ({ alice, bob, carol }) => {
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

    // ── (a) Pair-tab rendering ──────────────────────────────────────────
    // Verify 3 pair tabs render — viewer-pairs first, then other-vs-other.
    // Carol is the viewer, so tabs: "You & Alice", "You & Bob", "Alice & Bob"
    const tabList = carol.getByRole("tablist", { name: "Pair results" });
    await expect(tabList).toBeVisible();

    const tabs = tabList.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText("You & Alice");
    await expect(tabs.nth(1)).toContainText("You & Bob");
    await expect(tabs.nth(2)).toContainText("Alice & Bob");

    // First tab active by default
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");

    // Polycule subtitle renders for 3+ people
    await expect(carol.getByText("3 people, one shared space")).toBeVisible();

    // ── (b) Tab switching ───────────────────────────────────────────────
    // Click the other-vs-other tab and verify match rows appear
    await tabList.getByRole("tab", { name: /Alice & Bob/ }).click();
    const tabpanel = carol.getByRole("tabpanel");
    await expect(tabpanel).toBeVisible();
    const matchRows = tabpanel.locator('[data-testid="match-row"]');
    await expect(matchRows.first()).toBeVisible();
    expect(await matchRows.count()).toBeGreaterThan(0);

    // ── (c) Parenthetical on other-vs-other pairs ───────────────────────
    // Give/receive rows should have "(Alice)" parenthetical because Alice
    // is person A and aIsViewer=false — disambiguates whose perspective.
    const parentheticalRows = tabpanel.getByText(/\(Alice\)/);
    await expect(parentheticalRows.first()).toBeVisible();
    expect(await parentheticalRows.count()).toBeGreaterThan(1);

    // Viewer's own pair must NOT have parentheticals
    await tabList.getByRole("tab", { name: /You & Alice/ }).click();
    await expect(carol.getByRole("tabpanel").getByText(/\(You\)/)).toHaveCount(0);

    // ── (d) Keyboard navigation (roving tabindex) ───────────────────────
    // Focus first tab
    await tabs.nth(0).focus();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

    // ArrowRight cycles forward
    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();

    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();

    // ArrowRight wraps to first
    await carol.keyboard.press("ArrowRight");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toBeFocused();

    // ArrowLeft wraps to last
    await carol.keyboard.press("ArrowLeft");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();

    // Home → first, End → last
    await carol.keyboard.press("Home");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toBeFocused();

    await carol.keyboard.press("End");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(2)).toBeFocused();
  });
});
