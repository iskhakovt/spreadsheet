import { expect, test } from "../fixtures.js";
import {
  answerAllQuestions,
  answerQuestionsCycling,
  createGroupAndSetup,
  goThroughIntro,
  narrowToCategory,
} from "../helpers.js";

/** Extract the /p/{token} base path from a full URL. */
function personBase(url: string): string {
  const match = url.match(/(\/p\/[^/#?]+)/);
  if (!match) throw new Error(`Can't extract person base from URL: ${url}`);
  return match[1];
}

test.describe("3-person comparison", () => {
  test("pair tabs and switching pairs", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    const base = personBase(alice.url());

    // --- Invite screen with 3 members ---
    await alice.getByText("Start filling out").click();
    await alice.goto(base + "/invite");
    await expect(alice.getByText("Invite your partner")).toBeVisible();
    await expect(alice).toHaveScreenshot("invite-3-members.png");

    // Complete Alice
    await alice.goto(base + "/intro");
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // --- Waiting with 3 members (partial completion) ---
    await expect(alice).toHaveScreenshot("waiting-3p-partial.png");

    // Bob: mixed answers for match type variety in Alice&Bob pair
    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerQuestionsCycling(bob, ["yes", "maybe", "fantasy", "yes", "no"]);
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Carol: different mix for variety across all pairs
    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Group & External");
    await answerQuestionsCycling(carol, ["maybe", "yes", "fantasy", "no", "yes"]);
    await carol.getByRole("button", { name: "I'm done" }).click();

    // --- Results with 3 people: pair tabs ---
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 10_000 });
    await expect(alice.getByRole("tablist")).toBeVisible();
    await expect(alice).toHaveScreenshot("results-3p-first-tab.png");

    // Switch to second tab
    const tabs = alice.getByRole("tab");
    await tabs.nth(1).click();
    await expect(alice).toHaveScreenshot("results-3p-second-tab.png");

    // Switch to third tab (other-vs-other pair — shows parentheticals)
    await tabs.nth(2).click();
    await expect(alice).toHaveScreenshot("results-3p-third-tab.png");
  });
});
