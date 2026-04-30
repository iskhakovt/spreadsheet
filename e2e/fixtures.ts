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
/**
 * Helper used by every fixture below. Subscribes at the context level so
 * pages opened later in the test (`ctx.newPage()` from `multiTab`, etc.)
 * are tracked too. Returns the live errors array; the fixture asserts on
 * it at teardown.
 *
 * Only `pageerror` — not `console.error`. console.error mixes app signal
 * with framework/browser noise (HTTP auto-logs without URLs, CSP, SW
 * lifecycle, devtools nudges) and a filter list grows with every quirk,
 * risking real-bug suppression. Unhandled rejections are unambiguous and
 * are the actual smoking gun for silent-failure bugs (e.g. the dead "Add
 * person" button regression — server rejected `addPerson`, the client
 * never caught it, mutateAsync's rejection became an unhandled rejection).
 */
function trackContextPageErrors(ctx: BrowserContext): string[] {
  const errors: string[] = [];
  ctx.on("page", (page) => {
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  });
  return errors;
}

function assertNoPageErrors(errors: string[], who: string) {
  if (errors.length > 0) {
    throw new Error(`Page errors detected for ${who}:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

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
  // Override the built-in `context` so single-user tests using the default
  // `page` fixture get pageerror tracking automatically — no per-test code,
  // no per-fixture boilerplate. Playwright's default `page` fixture is
  // derived from this `context`, so the tracking transparently applies.
  context: async ({ context }, use) => {
    const errors = trackContextPageErrors(context);
    try {
      await use(context);
      assertNoPageErrors(errors, "context");
    } finally {
      // Built-in teardown closes the context.
    }
  },
  alice: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const errors = trackContextPageErrors(ctx);
    const page = await ctx.newPage();
    try {
      await use(page);
      assertNoPageErrors(errors, "alice");
    } finally {
      await ctx.close().catch(() => {});
    }
  },
  bob: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const errors = trackContextPageErrors(ctx);
    const page = await ctx.newPage();
    try {
      await use(page);
      assertNoPageErrors(errors, "bob");
    } finally {
      await ctx.close().catch(() => {});
    }
  },
  carol: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const errors = trackContextPageErrors(ctx);
    const page = await ctx.newPage();
    try {
      await use(page);
      assertNoPageErrors(errors, "carol");
    } finally {
      await ctx.close().catch(() => {});
    }
  },
  multiTab: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const errors = trackContextPageErrors(ctx);
    const admin = await ctx.newPage();
    try {
      await use({ ctx, admin });
      assertNoPageErrors(errors, "multiTab");
    } finally {
      await ctx.close().catch(() => {});
    }
  },
});

export { expect };
