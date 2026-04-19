import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory, scopedGet } from "./helpers.js";

/**
 * Verifies the tRPC `tracked()` resume protocol end-to-end: if Bob's WS drops,
 * Alice's journal writes continue, and when Bob's WS reconnects the server's
 * subscription generator replays entries since his last tracked id.
 *
 * This is the critical correctness test for the "lost event = stale results
 * forever" failure mode — without `tracked()`, a disconnected subscriber
 * would permanently miss edits that happened during the disconnect window.
 *
 * Implementation note: dropping Bob's WS requires more than
 * `page.route("**\/api/trpc-ws**", abort)`. Playwright's route handler only
 * sees the initial HTTP upgrade handshake, not the frames on an established
 * WebSocket — so `abort` on the route after the upgrade is a no-op, and the
 * existing WS would continue delivering Alice's edit via the normal live-
 * stream path (not via tracked resume). We use CDP's
 * `Network.emulateNetworkConditions { offline: true }` to sever Bob's entire
 * network, which actually kills the existing WS connection. The subsequent
 * `offline: false` restores connectivity, and `wsLink`'s auto-reconnect
 * re-sends the subscription message with the latest tracked id.
 */
test.describe("tracked() reconnect resume", () => {
  test("Bob's WS drops during Alice's edit, catches up on reconnect", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    await alice.getByText("Start filling out").click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob joins — start with WS allowed so he gets the initial subscription
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both reach /results via the WS push
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 5000 });
    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: 5000 });

    // Both see "match" (both-yes) rows initially. Target by data-match-type
    // attribute so we don't collide with summary-strip text ("Total matches").
    const bobMatchRows = bob.locator('[data-testid="match-row"][data-match-type="match"]');
    await expect(bobMatchRows.first()).toBeVisible();
    const matchesBefore = await bobMatchRows.count();
    expect(matchesBefore).toBeGreaterThan(0);

    // --- BOB'S NETWORK GOES DOWN (including his existing WS) ---
    //
    // Use CDP to flip Bob's page offline. Unlike page.route (which only
    // intercepts HTTP-level traffic including the WS upgrade but NOT frames
    // on an established WS), offline-mode actually severs the TCP connection,
    // which the tRPC wsLink observes as a close event and queues for
    // auto-reconnect. This is the only reliable way from Playwright to force
    // the reconnect path.
    const bobCdp = await bob.context().newCDPSession(bob);
    await bobCdp.send("Network.enable");
    await bobCdp.send("Network.emulateNetworkConditions", {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });

    // Give wsLink a moment to observe the close + transition to the
    // connecting/retry state. Its auto-reconnect will keep failing while
    // offline, but we're about to come back online so that's fine.
    await bob.waitForTimeout(500);

    // --- ALICE EDITS WHILE BOB IS DISCONNECTED ---
    await alice.getByText("Change my answers").click();
    await expect(alice).toHaveURL(/\/questions/);
    await alice.getByRole("radio", { name: "No", exact: true }).click();

    // Poll Alice's pendingOps via scopedGet (rationale in helpers.ts:
    // sync completion is not observable from the DOM — there's no
    // "last synced" indicator, and the sync indicator is hidden during
    // the 5s grace window. scopedGet is the least-bad signal).
    await expect(async () => {
      const pending = await scopedGet(alice, "pendingOps");
      expect(pending === null || pending === "[]").toBe(true);
    }).toPass({ timeout: 10_000 });

    // At this point:
    // - The server's journal has Alice's new entry committed
    // - journalEvents has emitted the append
    // - Bob's WS is severed — the emission goes into the void for him
    // - His cached /results view still shows matchesBefore matches

    // --- BOB'S NETWORK COMES BACK ---
    // Restore connectivity. wsLink's exponential-backoff reconnect will
    // succeed on the next attempt, re-send the subscription message with
    // Bob's last tracked id, and the server's generator will replay entries
    // > that id. The `onData` reflex merges into the cache, Comparison
    // re-renders with the updated match count.
    await bobCdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    // Poll until Bob's match count drops. Generous timeout to cover the
    // wsLink reconnect backoff (first retry is sub-second, subsequent
    // retries grow; worst case we wait a few seconds).
    await expect(async () => {
      const matchesAfter = await bobMatchRows.count();
      expect(matchesAfter).toBeLessThan(matchesBefore);
    }).toPass({ timeout: 20_000 });

    await bobCdp.detach();
  });
});
