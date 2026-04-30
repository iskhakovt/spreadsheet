import { expect, test } from "./fixtures.js";

/**
 * Regression for the SW intercepting top-level navigations to /api/*.
 *
 * Before the fix: clicking the tip-jar link (a target="_blank" anchor to
 * /api/out?dest=tip) was caught by the service worker's navigateFallback,
 * which served cached index.html. The popup mounted the SPA on /api/out,
 * matched no route, and rendered the in-app 404 — the 302 the server
 * returns never reached the browser.
 *
 * After the fix: navigateFallbackDenylist excludes /^\/api\//, so the
 * popup hits the network, follows the 302, and lands on the destination.
 *
 * The bug only manifests once the SW is controlling the page, so we
 * waitForFunction on `navigator.serviceWorker.controller` before clicking.
 * A `fetch('/api/out')` from page context wouldn't reproduce it — `fetch`
 * skips navigation interception even when SW is active.
 */
test.describe("service worker / api navigation bypass", () => {
  test("clicking the tip-jar link reaches the outbound proxy, not the SPA 404", async ({ page, context }) => {
    // Stub the offsite destination so the test stays offline-deterministic.
    await context.route("**/buymeacoffee.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>BMC stub</body></html>" }),
    );

    await page.goto("/");
    // Wait for the SW to take control — the bug only appears under an
    // active controller. Without this, the test passes even when broken
    // because the first navigation predates SW activation.
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 10_000 });

    const popupPromise = context.waitForEvent("page");
    await page.getByRole("link", { name: /buy me a coffee/i }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");

    // If the SW intercepted, popup.url() would be the /api/out path with
    // the SPA shell rendered. Asserting the host catches that regression.
    expect(new URL(popup.url()).hostname).toBe("buymeacoffee.com");
  });
});
