import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

test.describe("results display", () => {
  test("shows correct match labels for different answer combinations", async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();

    const { partnerLink } = await createGroupAndSetup(alice);

    // Use "group" category (small) — answer with a specific pattern
    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);

    // Alice: answer all questions as Yes + Now
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: answer all questions as Yes + Now too (should produce all "Go for it")
    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your results")).toBeVisible();
    await expect(bob.getByText("Alice & Bob")).toBeVisible();

    // All should be "Go for it" (both yes + both now)
    const goForIt = bob.getByText("Go for it");
    const goForItCount = await goForIt.count();
    expect(goForItCount).toBeGreaterThan(0);

    // No other match types should appear
    await expect(bob.getByText("Match")).not.toBeVisible();
    await expect(bob.getByText("Worth discussing")).not.toBeVisible();
    await expect(bob.getByText("Possible")).not.toBeVisible();

    await aliceCtx.close();
    await bobCtx.close();
  });

  test("mixed answers produce varied match types", async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();

    const { partnerLink } = await createGroupAndSetup(alice);
    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);

    // Alice: answer all as Maybe
    await answerAllQuestions(alice, "maybe");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: answer all as Maybe too
    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "maybe");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your results")).toBeVisible();

    // All should be "Worth discussing" (both maybe)
    const worthDiscussing = bob.getByText("Worth discussing");
    expect(await worthDiscussing.count()).toBeGreaterThan(0);

    // No "Go for it" or "Match"
    await expect(bob.getByText("Go for it")).not.toBeVisible();
    await expect(bob.getByText("Match")).not.toBeVisible();

    await aliceCtx.close();
    await bobCtx.close();
  });

  test("one says no — question hidden from results", async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();

    const { partnerLink } = await createGroupAndSetup(alice);
    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);

    // Alice: all No
    await answerAllQuestions(alice, "no");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Done")).toBeVisible();

    // Bob: all Yes
    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    await expect(bob.getByText("Your results")).toBeVisible();

    // No matches should appear — all hidden because Alice said No
    await expect(bob.getByText("No matches found")).toBeVisible();

    await aliceCtx.close();
    await bobCtx.close();
  });
});
