import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { type HonoLoggerEnv, logger } from "./logger.js";
import { outboundHandler } from "./outbound.js";
import { requestLogger } from "./request-logger.js";
import { makeSpaRoutes, type ShellRenderer } from "./spa-routes.js";
import type { GroupStore } from "./store/groups.js";
import type { QuestionStore } from "./store/questions.js";
import type { SyncStore } from "./store/sync.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

export interface Stores {
  groups: GroupStore;
  sync: SyncStore;
  questions: QuestionStore;
}

export interface AppOptions {
  stores: Stores;
  shell: ShellRenderer;
  /**
   * When true, the strict CSP is relaxed for Vite's HMR client (inline scripts
   * and source-map eval) and static file serving is disabled — Vite owns asset
   * delivery in dev.
   */
  dev?: boolean;
  /**
   * Build-time / runtime config exposed to the SPA via /env-config.js. The
   * SPA reads `window.__ENV.REQUIRE_ENCRYPTION`. Server is the single source
   * of truth so a deploy can flip the flag without rebuilding the bundle.
   */
  envConfig?: { REQUIRE_ENCRYPTION: boolean };
  /** When set, /* serves precompressed static files from this root. Prod only. */
  staticRoot?: string;
}

export function createApp(opts: AppOptions): Hono<HonoLoggerEnv> {
  const { stores, shell, dev = false, envConfig, staticRoot } = opts;

  const app = new Hono<HonoLoggerEnv>();

  app.use("*", requestLogger(logger));

  app.use("*", async (c, next) => {
    await next();
    if (dev) {
      // Dev CSP: 'unsafe-inline' for the inline <script> tags transformIndexHtml
      // injects (Vite client import + React Refresh runtime hook), 'unsafe-eval'
      // for sourcemap / TS-transform tooling. img-src adds blob: for source
      // maps, font-src adds data: for inline-encoded font fallbacks Vite emits.
      c.header(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
      );
    } else {
      c.header(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
      );
    }
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
    if (c.req.header("x-forwarded-proto") === "https") {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
  });

  // Health check — container orchestration uses this
  app.get("/health", (c) => c.json({ status: "ok", version: process.env.VERSION ?? "dev" }));

  // Compress API responses (static files are pre-compressed)
  app.use("/api/*", compress());

  // tRPC API
  app.use(
    "/api/trpc/*",
    trpcServer({
      endpoint: "/api/trpc",
      router: appRouter,
      createContext: (opts, c) => createContext(stores, opts, c),
    }),
  );

  // Outbound click proxy — same-origin redirect with hardcoded allowlist of
  // destinations (source repo, tip jar). Increments a Prometheus counter so
  // click-through is visible without third-party analytics.
  app.get("/api/out", outboundHandler);

  const { serveBootstrap, serveDefault } = makeSpaRoutes(shell);

  // /p/:token (and sub-paths) — bootstrap-only: validates token, sets a
  // per-person httpOnly session cookie, serves the invite-flavoured HTML.
  // Client-side `replaceState`s the URL to root once it's read its session
  // identity (the hash) — see web-side bootstrap route.
  //
  // Registered before serveStatic so the per-token cookie is always set and
  // the invite-flavoured OG meta is served, even though /p/* doesn't exist
  // as a file in dist/.
  app.get("/p/:token", serveBootstrap);
  app.get("/p/:token/*", serveBootstrap);

  // Static files (handles /, /index.html, /assets/*, /favicon.svg, etc.). Prod
  // only — in dev Vite serves all assets directly via its own middleware
  // (which runs before our Hono middleware in @hono/vite-dev-server's flow).
  if (staticRoot) {
    app.use(
      "/*",
      serveStatic({
        root: staticRoot,
        precompressed: true,
        onFound: (path, c) => {
          if (path.includes("/assets/")) {
            c.header("Cache-Control", "public, max-age=31536000, immutable");
          } else if (/\/(sw|registerSW|workbox-[^/]+)\.js$|\/manifest\.webmanifest$/.test(path)) {
            c.header("Cache-Control", "no-cache");
          } else {
            c.header("Cache-Control", "public, max-age=3600");
          }
        },
      }),
    );
  }

  // Runtime env config — registered after serveStatic, so a static file at
  // dist/env-config.js (if one ever ended up there) would win and shadow these
  // live values. Today nothing in the build pipeline emits that name into dist/,
  // which is why this works; if that ever changes, either delete the static
  // file at startup or move this route above serveStatic. `no-store` because
  // flipping a flag (e.g. REQUIRE_ENCRYPTION) without a rebuild is the whole
  // point of this file; any cached copy defeats it.
  if (envConfig) {
    const envConfigJs = `window.__ENV=${JSON.stringify(envConfig)};`;
    app.get("/env-config.js", (c) => {
      c.header("Content-Type", "application/javascript; charset=utf-8");
      c.header("Cache-Control", "no-store");
      return c.body(envConfigJs);
    });
  }

  // SPA fallback for all remaining non-/p/ routes (e.g. /setup, /results, /group).
  app.get("/*", serveDefault);

  return app;
}
