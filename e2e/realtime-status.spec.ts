import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("realtime status (WebSocket)", () => {
  test("Alice's waiting screen updates instantly when Bob completes (WS path)", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    // Alice answers and marks done
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob joins and goes all the way through
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");

    // Bob is about to mark done — start the clock BEFORE the click so we
    // capture the full click → mutation → groupEvents emit → Alice's WS
    // onData → setQueryData → guard redirect path. Starting after the
    // click would hide the click's own processing time.
    const start = Date.now();
    await bob.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 5000 });
    const elapsed = Date.now() - start;

    // Soft check: WS push is typically sub-second. Warn if it creeps up so we
    // notice regressions.
    if (elapsed > 2000) {
      console.warn(`WS push took ${elapsed}ms — slower than expected`);
    }
  });
});
