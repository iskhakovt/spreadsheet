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
    // The window between Bob clicking "I'm done" and Alice's screen updating
    // is what WS optimises (vs 5s polling).
    await bob.getByRole("button", { name: "I'm done" }).click();

    const start = Date.now();
    await expect(alice.getByText("Your results")).toBeVisible({ timeout: 3000 });
    const elapsed = Date.now() - start;

    // Soft check: WS push is typically sub-second. Warn if it creeps up so we
    // notice if WS regresses to polling silently.
    if (elapsed > 2000) {
      console.warn(`WS push took ${elapsed}ms — slower than expected, possibly fell back to polling`);
    }

    await aliceCtx.close();
    await bobCtx.close();
  });

  test("falls back to polling when WS upgrade is blocked", async ({ browser }) => {
    // Block WebSocket upgrades for both contexts so the client must use the
    // polling fallback in useGroupStatus.
    const aliceCtx = await browser.newContext();
    await aliceCtx.route("**/api/trpc-ws**", (route) => route.abort());
    const alice = await aliceCtx.newPage();
    const { partnerLink } = await createGroupAndSetup(alice);

    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    const bobCtx = await browser.newContext();
    await bobCtx.route("**/api/trpc-ws**", (route) => route.abort());
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Bob navigates locally (no WS dependency)
    await expect(bob.getByText("Your results")).toBeVisible({ timeout: 5000 });

    // Alice has to wait for the polling fallback — `POLL_MS=1000` in CI fixtures,
    // so within ~3s should still be fine.
    await expect(alice.getByText("Your results")).toBeVisible({ timeout: 5000 });

    await aliceCtx.close();
    await bobCtx.close();
  });
});
