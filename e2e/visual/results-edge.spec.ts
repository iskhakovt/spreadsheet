import { expect, test } from "../fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory, WS_TIMEOUT } from "../helpers.js";

test.describe("results edge cases", () => {
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
