import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

/**
 * Verifies the tRPC `tracked()` resume protocol end-to-end: if Bob's WS drops,
 * Alice's journal writes continue, and when Bob's WS reconnects the server's
 * subscription generator replays entries since his last tracked id.
 *
 * This is the critical correctness test for the "lost event = stale results
 * forever" failure mode — without `tracked()`, a disconnected subscriber
 * would permanently miss edits that happened during the disconnect window.
 */
test.describe("tracked() reconnect resume", () => {
  test("Bob's WS drops during Alice's edit, catches up on reconnect", async ({ browser }) => {
    const aliceCtx = await browser.newContext();
    const alice = await aliceCtx.newPage();
    const { partnerLink } = await createGroupAndSetup(alice);

    await setCategories(alice, ["group"]);
    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob joins — start with WS allowed so he gets the initial subscription
    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await bob.goto(partnerLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Both reach /results via the WS push
    await expect(alice.getByText("Your results")).toBeVisible({ timeout: 5000 });
    await expect(bob.getByText("Your results")).toBeVisible({ timeout: 5000 });

    // Both see "Match" labels initially
    await expect(bob.getByText("Match").first()).toBeVisible();

    // Snapshot Bob's match count BEFORE the edit so we can assert a
    // concrete drop rather than a magic-number upper bound.
    const matchesBefore = await bob.getByText("Match").count();
    expect(matchesBefore).toBeGreaterThan(0);

    // --- BOB'S WS GOES DOWN ---
    // Block Bob's WS. Any new subscription message (including resume on
    // reconnect) will fail until we unblock.
    await bobCtx.route("**/api/trpc-ws**", (route) => route.abort());

    // Give the WS close some time to propagate — wsLink's auto-reconnect
    // will keep retrying in the background. Bob's current cached state on
    // /results remains visible.
    await bob.waitForTimeout(500);

    // --- ALICE EDITS WHILE BOB IS DISCONNECTED ---
    await alice.getByText("Change my answers").click();
    await expect(alice).toHaveURL(/\/questions/);
    await alice.getByRole("radio", { name: "No" }).click();

    // Wait for Alice's own sync.push to commit (debounce + network).
    // We poll rather than sleep — Alice's UI has no direct signal of
    // sync completion, so we check via localStorage: pendingOps clears
    // once sync succeeds.
    await expect(async () => {
      const pending = await alice.evaluate(() => {
        const token = window.location.pathname.split("/p/")[1]?.split(/[/#?]/)[0];
        if (!token) return "not-found";
        // Find the scoped pendingOps key (s{fnv1a(token)}:pendingOps)
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.endsWith(":pendingOps")) return localStorage.getItem(key);
        }
        return null;
      });
      expect(pending === null || pending === "[]").toBe(true);
    }).toPass({ timeout: 10_000 });

    // Bob hasn't seen the update — WS is blocked, his cached state is stale

    // --- BOB'S WS COMES BACK ---
    // Unblock WS so the next reconnect attempt succeeds
    await bobCtx.unroute("**/api/trpc-ws**");

    // Bob's wsLink reconnects and re-sends the subscription message with
    // the latest tracked id. The server's generator queries entries > id
    // and replays Alice's missed write. The `onData` merges into the cache,
    // Comparison re-renders.
    //
    // The recovery window is bounded by wsLink's reconnect backoff (default
    // retry delay is fast — <5s for first retry). Poll until the match
    // count drops.
    await expect(async () => {
      const matchesAfter = await bob.getByText("Match").count();
      expect(matchesAfter).toBeLessThan(matchesBefore);
    }).toPass({ timeout: 15_000 });

    await aliceCtx.close();
    await bobCtx.close();
  });
});
