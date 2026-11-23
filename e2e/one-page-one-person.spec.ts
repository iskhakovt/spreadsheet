import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, NAV_TIMEOUT } from "./helpers.js";

/**
 * One page = one person: when a page that belongs to Alice is asked to show
 * Bob's link, it reloads instead of switching in place. An in-place switch
 * would leave per-page state from Alice's session alive (queued tRPC
 * batches, SSE streams, async sync work) and has no cookie for Bob unless
 * his link was loaded as a document before.
 *
 * No UI performs such a switch today (group creation uses a full
 * navigation; partner links are copy-only), so the test simulates one with
 * a pushState navigation the router picks up. That's the bypass this guards
 * against: a future in-app link, or anything else that moves the router to
 * another token without loading a page.
 */
test.describe("one page = one person", () => {
  for (const encrypted of [false, true]) {
    test(`a different person's link reloads the page instead of switching in place [encrypted=${encrypted}]`, async ({
      alice,
    }) => {
      const { partnerLink } = await createGroupAndSetup(alice, { encrypted });
      await expect(alice).toHaveURL(/\/p\/.+/);

      // Survives an in-place navigation, not a page load.
      await alice.evaluate(() => {
        (window as unknown as { onePageMarker?: boolean }).onePageMarker = true;
      });

      const bob = new URL(partnerLink);
      // A real document request for Bob's link: that's what sets his session
      // cookie server-side. (The #key= fragment never goes on the wire.)
      const documentRequest = alice.waitForRequest(
        (req) => req.isNavigationRequest() && req.url() === bob.origin + bob.pathname,
      );
      const reloaded = alice.waitForEvent("load");
      // On a timer so this evaluate returns before the page goes away.
      await alice.evaluate((target) => {
        // TanStack's history notifies the router on pushState itself.
        setTimeout(() => window.history.pushState({}, "", target));
      }, bob.pathname + bob.hash);
      await documentRequest;
      await reloaded;

      // A fresh page on Bob's link, showing Bob's first screen rather than
      // Alice's state or "Link not found". Bob's layout then moves on to
      // /intro (dropping the fragment), so match the path prefix. In the
      // encrypted run, the intro rendering at all proves the key came through:
      // without it Bob's status can't be opened.
      expect(
        await alice.evaluate(() => (window as unknown as { onePageMarker?: boolean }).onePageMarker ?? null),
      ).toBeNull();
      await expect(alice.getByText("Here's how it works")).toBeVisible({ timeout: NAV_TIMEOUT });
      expect(new URL(alice.url()).pathname.startsWith(bob.pathname)).toBe(true);
    });
  }
});
