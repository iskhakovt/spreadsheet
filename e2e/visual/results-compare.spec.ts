import { expect, test } from "../fixtures.js";
import {
  answerQuestionsCycling,
  createGroupAndSetup,
  goThroughIntro,
  narrowToCategory,
  WS_TIMEOUT,
} from "../helpers.js";

test.describe("results — compare-semantics rows", () => {
  // Locks the styling of the match types the other results baselines never
  // hit: "You differ" (agreement split), "Both pass" (aligned-no), "Noted"
  // (disclose), and the per-person StanceLine. "Sensory Environment" mixes
  // `agreement` (lighting/sound/scent) and `disclose` (sensory needs)
  // questions, so a varied answer split renders all of them on one page.
  test("agreement + disclosure rows render with per-person stances", async ({ alice, bob }) => {
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

    // Guard the premise: all three otherwise-uncaptured row types are present
    // before we snapshot, so a baseline can never silently lose them.
    await expect(bob.locator('[data-match-type="differ"]').first()).toBeVisible();
    await expect(bob.locator('[data-match-type="noted"]').first()).toBeVisible();
    await expect(bob.locator('[data-match-type="aligned-no"]').first()).toBeVisible();

    await expect(bob).toHaveScreenshot("results-compare-rows.png");
  });
});
