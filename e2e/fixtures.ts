import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");

/**
 * Named per-role fixtures for multi-context tests.
 *
 * Playwright's built-in `page` / `context` fixtures are test-scoped and
 * automatically disposed. But tests that simulate multiple users need
 * multiple BrowserContexts — one per person, so localStorage and cookies
 * are isolated — and Playwright does NOT auto-dispose contexts created
 * manually via `browser.newContext()`. Leaked contexts starve worker
 * memory and produce incomplete traces when a test fails mid-flow.
 *
 * We expose named fixtures so every test signature is both
 * self-documenting and leak-proof:
 *
 *   - `alice` / `bob` / `carol` — each provides a Page inside its own
 *     fresh BrowserContext. Used by multi-user tests like
 *     `two-player.spec.ts` (alice + bob) and `three-person.spec.ts`
 *     (all three). Laziness at the fixture level means a test that only
 *     destructures `{ alice }` never creates unused contexts.
 *
 *   - `multiTab` — a single shared BrowserContext plus a pre-created
 *     admin Page. Used only by `multi-tab.spec.ts`, which intentionally
 *     tests cross-tab localStorage isolation within one browser
 *     profile. The test creates additional pages via `ctx.newPage()`.
 *
 * Single-user tests keep using the built-in `page` fixture — no change,
 * already idiomatic.
 *
 * Cleanup runs in `use()` teardown regardless of pass/fail, and swallows
 * individual close errors so a partial teardown doesn't suppress others.
 */
export const test = base.extend<{
  alice: Page;
  bob: Page;
  carol: Page;
  multiTab: { ctx: BrowserContext; admin: Page };
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture convention — {} means no dependencies
  baseURL: async ({}, use) => {
    let hostPort: string;
    try {
      hostPort = readFileSync(PORT_FILE, "utf-8").trim();
    } catch {
      throw new Error(`E2E port file not found at ${PORT_FILE} — did globalSetup run?`);
    }
    if (!hostPort || !/^[\w.-]+:\d+$/.test(hostPort)) {
      throw new Error(`Invalid host:port in ${PORT_FILE}: "${hostPort}"`);
    }
    await use(`http://${hostPort}`);
  },
  alice: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = trackPageErrors(page);
    await use(page);
    assertNoPageErrors(errors, "alice");
    await ctx.close().catch(() => {});
  },
  bob: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = trackPageErrors(page);
    await use(page);
    assertNoPageErrors(errors, "bob");
    await ctx.close().catch(() => {});
  },
  carol: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = trackPageErrors(page);
    await use(page);
    assertNoPageErrors(errors, "carol");
    await ctx.close().catch(() => {});
  },
  multiTab: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    const errors = trackPageErrors(admin);
    await use({ ctx, admin });
    assertNoPageErrors(errors, "multiTab.admin");
    await ctx.close().catch(() => {});
  },
});

// Catches silent failures: a server-side TRPCError that the client surfaces
// only as an `error` console.log and the user sees as a no-op (e.g. dead
// "Add person" button regression in PR #115). Tests that don't explicitly
// assert against the failed UX still fail at teardown.
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Filter framework noise that fires on every page load and is unrelated
    // to test correctness:
    //   - React DevTools download nudge
    //   - Workbox / service-worker lifecycle logs
    //   - 404s on optional assets (Failed to load resource)
    //   - CSP violations from data:-URI background images in screenshot.css
    //     (intentional noise filter; meta-csp is strict in dev)
    if (/Download the React DevTools|workbox|skipWaiting|Failed to load resource|Content Security Policy/i.test(text)) {
      return;
    }
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

function assertNoPageErrors(errors: string[], who: string) {
  if (errors.length > 0) {
    throw new Error(`Page errors detected for ${who}:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

export { expect };
