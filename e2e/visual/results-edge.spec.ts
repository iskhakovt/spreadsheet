import { expect, test } from "../fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "../helpers.js";

test.describe("results edge cases", () => {
  test("results with timing — green-light column visible", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { showTiming: true });

    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes"); // answers yes + "Now" for timing
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both answered yes + now → green-light matches with "Go for it" column
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 10_000 });
    await expect(alice).toHaveScreenshot("results-with-timing.png");
  });

  test("results empty state — no overlaps", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    // Alice answers yes, Bob answers no → all hidden
    await alice.getByText("Start filling out").click();
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

    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 10_000 });
    await expect(alice.getByText("No overlaps")).toBeVisible();
    await expect(alice).toHaveScreenshot("results-empty.png");
  });
});
