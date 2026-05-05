import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  createGroupAndSetup,
  goThroughIntro,
  narrowToCategory,
  scopedGet,
  WS_TIMEOUT,
} from "./helpers.js";

/**
 * Verifies the tRPC `tracked()` resume protocol end-to-end: if Bob's SSE
 * stream drops, Alice's journal writes continue, and when Bob reconnects
 * the server's subscription generator replays entries since his last
 * tracked id.
 *
 * This is the critical correctness test for the "lost event = stale results
 * forever" failure mode — without `tracked()`, a disconnected subscriber
 * would permanently miss edits that happened during the disconnect window.
 *
 * Implementation note: severing the in-flight SSE response requires real
 * network teardown. `page.route` only sees the initial request, not chunks
 * streamed back on the open response, so `abort` on the route after the
 * stream opens is a no-op. We use CDP's
 * `Network.emulateNetworkConditions { offline: true }` to drop Bob's entire
 * network, which kills the open EventSource. `offline: false` restores
 * connectivity, and `httpSubscriptionLink` reopens the EventSource with the
 * browser's automatic `Last-Event-ID` header set to the latest tracked id —
 * which the server reads as `input.lastEventId` for backfill.
 */
test.describe("tracked() reconnect resume", () => {
  test("Bob's stream drops during Alice's edit, catches up on reconnect", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob joins — start online so he gets the initial subscription
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both reach /results via the live status push
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

    // Both see "match" (both-yes) rows initially. Target by data-match-type
    // attribute so we don't collide with summary-strip text ("Total matches").
    const bobMatchRows = bob.locator('[data-testid="match-row"][data-match-type="match"]');
    await expect(bobMatchRows.first()).toBeVisible();
    const matchesBefore = await bobMatchRows.count();
    expect(matchesBefore).toBeGreaterThan(0);

    // --- BOB'S NETWORK GOES DOWN (including his open EventSource) ---
    //
    // Use CDP to flip Bob's page offline. Unlike page.route (which only sees
    // the initial request, not chunks streamed back on the open response),
    // offline-mode actually severs the TCP connection. The browser's
    // EventSource observes a close, and `httpSubscriptionLink` queues a
    // reconnect that fires once connectivity returns.
    const bobCdp = await bob.context().newCDPSession(bob);
    await bobCdp.send("Network.enable");
    await bobCdp.send("Network.emulateNetworkConditions", {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });

    // Give the link a moment to observe the close + transition to the
    // connecting/retry state. Its auto-reconnect will keep failing while
    // offline, but we're about to come back online so that's fine.
    await bob.waitForTimeout(500);

    // --- ALICE EDITS WHILE BOB IS DISCONNECTED ---
    await alice.getByRole("button", { name: "Change my answers", exact: true }).click();
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
    // - Bob's EventSource is severed — the emission goes into the void for him
    // - His cached /results view still shows matchesBefore matches

    // --- BOB'S NETWORK COMES BACK ---
    // Restore connectivity. `httpSubscriptionLink`'s exponential-backoff
    // reconnect will succeed on the next attempt; the browser sends the
    // last received SSE id as `Last-Event-ID`, the server reads it as
    // `input.lastEventId`, and the generator replays entries > that id.
    // The `onData` reflex merges into the cache, Comparison re-renders
    // with the updated match count.
    await bobCdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    // Poll until Bob's match count drops. Generous timeout to cover the
    // link's reconnect backoff (first retry is sub-second, subsequent
    // retries grow; worst case we wait a few seconds).
    await expect(async () => {
      const matchesAfter = await bobMatchRows.count();
      expect(matchesAfter).toBeLessThan(matchesBefore);
    }).toPass({ timeout: 20_000 });

    await bobCdp.detach();
  });
});
