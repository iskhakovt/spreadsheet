import { expect, test } from "./fixtures.js";

/**
 * Verifies the SW navigateFallbackDenylist is exhaustive in both directions:
 *
 *   (a) every public-facing static asset and runtime-routed file falls
 *       through to the network (the SW must not serve the SPA shell), and
 *   (b) every SPA route still gets the SPA shell (the denylist must not
 *       over-match).
 *
 * The bug class this guards against: a navigation request to /og-image.png
 * (or any non-precached static asset) gets caught by workbox's
 * navigateFallback and served cached index.html, so a Facebook crawler or
 * a user typing the URL gets HTML instead of the actual file. The existing
 * static-assets.spec.ts uses page.request.get() which bypasses the SW
 * entirely, so it can't observe this regression.
 *
 * The pattern matches sw-api-bypass.spec.ts: navigate to /, wait for
 * navigator.serviceWorker.controller, THEN navigate to the candidate URL
 * so the SW is in the loop for the second navigation.
 */

interface Asset {
  readonly url: string;
  readonly contentType: RegExp;
}

const STATIC_ASSETS: readonly Asset[] = [
  { url: "/og-image.png", contentType: /^image\/png\b/i },
  { url: "/og-invite.png", contentType: /^image\/png\b/i },
  { url: "/favicon.svg", contentType: /^image\/svg\+xml\b/i },
  { url: "/logo.svg", contentType: /^image\/svg\+xml\b/i },
  { url: "/icon-192.png", contentType: /^image\/png\b/i },
  { url: "/icon-512.png", contentType: /^image\/png\b/i },
  { url: "/apple-touch-icon.png", contentType: /^image\/png\b/i },
  { url: "/robots.txt", contentType: /^text\/plain\b/i },
  { url: "/manifest.webmanifest", contentType: /manifest\+json|application\/json/i },
  { url: "/env-config.js", contentType: /^application\/javascript\b/i },
];

const SPA_ROUTES: readonly string[] = [
  "/",
  "/questions",
  "/p/fake-token-just-for-meta",
  "/p/fake-token-just-for-meta/setup",
];

test.describe("service worker / static-asset passthrough", () => {
  test("static assets bypass the SW shell once the SW is controlling", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 10_000 });

    for (const { url, contentType } of STATIC_ASSETS) {
      const res = await page.goto(url);
      expect(res, `no response for ${url}`).not.toBeNull();
      expect(res?.status(), `${url} returned non-200`).toBe(200);
      const got = res?.headers()["content-type"] ?? "";
      expect(got, `${url} content-type "${got}" — looks like the SPA shell`).toMatch(contentType);
    }
  });

  test("SPA routes still get the SPA shell (denylist must not over-match)", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 10_000 });

    for (const url of SPA_ROUTES) {
      const res = await page.goto(url);
      expect(res, `no response for ${url}`).not.toBeNull();
      expect(res?.status(), `${url} returned non-200`).toBe(200);
      const got = res?.headers()["content-type"] ?? "";
      expect(got, `${url} expected SPA shell, got "${got}"`).toMatch(/^text\/html\b/i);
    }
  });
});
