import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  createGroupAndSetup,
  goThroughIntro,
  narrowToCategory,
  WS_PERF_TIMEOUT,
} from "./helpers.js";

test.describe("realtime status (WebSocket)", () => {
  test("Alice's waiting screen updates instantly when Bob completes (WS path)", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    // Alice answers and marks done
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
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
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_PERF_TIMEOUT });
    const elapsed = Date.now() - start;

    // Hard check: WS push must arrive on the first delivery attempt.
    // A reconnect cycle adds ~1–3 s; > 2000 ms means we hit the retry path.
    expect(elapsed).toBeLessThan(2000);
  });
});
