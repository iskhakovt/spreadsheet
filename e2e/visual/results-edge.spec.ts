import { expect, test } from "../fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory, WS_TIMEOUT } from "../helpers.js";

test.describe("results edge cases", () => {
  test("results with timing — green-light column visible", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { showTiming: true });

    // Bondage has 0 notePrompt questions — needed for the all-green-light
    // baseline. notePrompt questions short-circuit the now/later fan-out
    // (note replaces timing as the secondary signal), so a category with
    // notePrompt questions would produce a mix of green-light and plain
    // match rows in the screenshot.
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Bondage & Restraint");
    await answerAllQuestions(alice, "yes"); // answers yes + "Now" for timing
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Bondage & Restraint");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both answered yes + now → green-light matches with "Go for it" column
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(alice).toHaveScreenshot("results-with-timing.png");
  });

  test("results empty state — no overlaps", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    // Alice answers yes, Bob answers no → all hidden
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

    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(alice.getByText("No overlaps")).toBeVisible();
    await expect(alice).toHaveScreenshot("results-empty.png");
  });
});
