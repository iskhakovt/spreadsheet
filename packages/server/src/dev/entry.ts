import { createApp } from "../app.js";

/**
 * Entry point for @hono/vite-dev-server. Returns the Hono app whose `.fetch`
 * handles every request that lands on the dev port (Vite's listener) and
 * isn't claimed by Vite's own asset middlewares.
 *
 * State (DB pool, stores, the Vite-aware shell renderer) is owned by the
 * `spreadsheetDev` plugin in packages/web/vite.config.ts and stashed on
 * `globalThis` before the first request lands. This entry just picks them
 * up — keeping it free of init lets the entry re-evaluate cheaply on edits
 * without leaking DB connections.
 */
const state = globalThis.__spreadsheetDevState;
const shell = globalThis.__spreadsheetDevShell;

if (!state || !shell) {
  throw new Error(
    "dev-entry loaded before spreadsheetDev plugin initialised globalThis — check vite.config.ts plugin order",
  );
}

const app = createApp({
  stores: state.stores,
  shell,
  dev: true,
  envConfig: { REQUIRE_ENCRYPTION: process.env.REQUIRE_ENCRYPTION !== "false" },
});

export default app;
