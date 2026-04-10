import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

test.describe("realtime status (WebSocket)", () => {
  test("Alice's waiting screen updates instantly when Bob completes (WS path)", async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();
    const { partnerLink } = await createGroupAndSetup(alice);

    // Alice answers and marks done
    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob joins and goes all the way through
    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");

    // Bob is about to mark done — start measuring how fast Alice gets the push.
    // This is the end-to-end latency from sync.markComplete → groupEvents emit
    // → Alice's WS onData → setQueryData → guard redirect.
    await bob.getByRole("button", { name: "I'm done" }).click();

    const start = Date.now();
    await expect(alice.getByText("Your results")).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - start;

    // Soft check: WS push is typically sub-second. Warn if it creeps up so we
    // notice regressions.
    if (elapsed > 2000) {
      console.warn(`WS push took ${elapsed}ms — slower than expected`);
    }

    await aliceCtx.close();
    await bobCtx.close();
  });
});
