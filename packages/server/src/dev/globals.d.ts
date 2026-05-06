// Ambient declaration for the dev-only handoff between the spreadsheetDev
// Vite plugin (writer, in packages/web/vite.config.ts) and the
// @hono/vite-dev-server entry (reader, in dev/entry.ts). The plugin sets
// these on `globalThis` once during configureServer; the entry reads them
// at module-load time on first request. Module-not-imported pattern: both
// consumers use `globalThis.__spreadsheetDev*` directly — TypeScript merges
// this declaration into the global scope as long as the file is in the
// project's `include` (server tsconfig picks it up via `src/**/*`; web's
// tsconfig has an explicit entry for it next to the trpc router).
import type { ShellRenderer } from "../spa-routes.js";
import type { DevState } from "./state.js";

declare global {
  // eslint-disable-next-line no-var
  var __spreadsheetDevState: DevState | undefined;
  // eslint-disable-next-line no-var
  var __spreadsheetDevShell: ShellRenderer | undefined;
}

export {};
