import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { WebSocketServer } from "ws";
import { createDatabase } from "./db/index.js";
import { renderIndex } from "./index-html.js";
import { type HonoLoggerEnv, logger } from "./logger.js";
import { registry, wsConnectionsGauge } from "./metrics.js";
import { outboundHandler } from "./outbound.js";
import { requestLogger } from "./request-logger.js";
import { makeSpaRoutes } from "./spa-routes.js";
import { GroupStore } from "./store/groups.js";
import { QuestionStore } from "./store/questions.js";
import { SyncStore } from "./store/sync.js";
import { createContext, createWSContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

logger.info("server starting");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.fatal("DATABASE_URL environment variable is required");
  throw new Error("DATABASE_URL environment variable is required");
}

const { db, close: closeDb } = createDatabase(databaseUrl);
const stores = {
  groups: new GroupStore(db),
  sync: new SyncStore(db),
  questions: new QuestionStore(db),
};

// Runtime config served as a separate /env-config.js file rather than inlined
// into index.html. The HTML references it with a parser-blocking
// `<script src="/env-config.js">` so window.__ENV is set before the main
// bundle parses. Decoupling env from the HTML lets `script-src 'self'` cover
// it (no per-deploy hash) and removes the ordering requirement that the /
// and /index.html routes had to come before serveStatic.
const envConfigJs = `window.__ENV=${JSON.stringify({
  REQUIRE_ENCRYPTION: process.env.REQUIRE_ENCRYPTION !== "false",
})};`;

const app = new Hono<HonoLoggerEnv>();

app.use("*", requestLogger(logger));

app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
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
    createContext: (_opts, c) => createContext(stores, c),
  }),
);

// Outbound click proxy — same-origin redirect with hardcoded allowlist of
// destinations (source repo, tip jar). Increments a Prometheus counter so
// click-through is visible without third-party analytics.
app.get("/api/out", outboundHandler);

// SPA fallback. Two pre-rendered variants:
//   default — landing & free routes: og:image = /og-image.png, standard copy
//   invite  — /p/:token: og:image = /og-invite.png, "Your turn" copy
// Messenger crawlers (Facebook, iMessage, WhatsApp) fetch og:image from the
// HTML at the invite URL, so per-token links unfurl with invite-framed copy.
let indexHtmlDefault: string | null = null;
let indexHtmlInvite: string | null = null;
const staticRoot = process.env.STATIC_ROOT ?? "../web/dist";
try {
  const raw = readFileSync(resolve(staticRoot, "index.html"), "utf-8");
  indexHtmlDefault = renderIndex(raw, {
    ogImage: "/og-image.png",
    ogTitle: "Spreadsheet",
    ogImageAlt: "Spreadsheet — find the overlap",
  });
  indexHtmlInvite = renderIndex(raw, {
    ogImage: "/og-invite.png",
    ogTitle: "You’ve been invited · Spreadsheet",
    ogImageAlt: "Spreadsheet — your turn",
  });
} catch (err) {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
    logger.warn({ staticRoot }, "index.html not found — SPA fallback disabled (expected during dev)");
  } else {
    logger.fatal({ err, staticRoot }, "failed to pre-render SPA fallback");
    throw err;
  }
}

const { serveBootstrap, serveDefault } = makeSpaRoutes(indexHtmlInvite, indexHtmlDefault);

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

// Static files (handles /, /index.html, /assets/*, /favicon.svg, etc.).
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

// Runtime env config — registered after serveStatic, so a static file at
// dist/env-config.js (if one ever ended up there) would win and shadow these
// live values. Today nothing in the build pipeline emits that name into dist/,
// which is why this works; if that ever changes, either delete the static
// file at startup or move this route above serveStatic. `no-store` because
// flipping a flag (e.g. REQUIRE_ENCRYPTION) without a rebuild is the whole
// point of this file; any cached copy defeats it.
app.get("/env-config.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(envConfigJs);
});

// SPA fallback for all remaining non-/p/ routes (e.g. /setup, /results, /group).
app.get("/*", serveDefault);

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 8080;
const server = serve({ fetch: app.fetch, port });
server.on("listening", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  logger.info({ port: actualPort }, "server listening");
});

// Metrics server — separate port so it can be firewalled off from public traffic
const metricsApp = new Hono();
metricsApp.get("/metrics", async (c) =>
  c.text(await registry.metrics(), 200, { "Content-Type": registry.contentType }),
);
const metricsPort = process.env.METRICS_PORT !== undefined ? Number(process.env.METRICS_PORT) : 9090;
const metricsServer = serve({ fetch: metricsApp.fetch, port: metricsPort });
metricsServer.on("listening", () => {
  const addr = metricsServer.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : metricsPort;
  logger.info({ port: actualPort }, "metrics server listening");
});
metricsServer.on("error", (err) => {
  logger.error(err, "metrics server error");
});

// WebSocket: tRPC subscriptions over /api/trpc-ws on the same HTTP server.
// `noServer: true` lets us pick which upgrade requests to handle so the rest
// (e.g. Vite HMR in dev) fall through.
const wss = new WebSocketServer({ noServer: true });

const wssHandler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: (opts) => createWSContext(stores, opts),
  keepAlive: {
    enabled: true,
    pingMs: 30_000,
    pongWaitMs: 5_000,
  },
});

wss.on("connection", (ws) => {
  wsConnectionsGauge.inc();
  logger.debug("ws connection opened");
  ws.on("close", () => {
    wsConnectionsGauge.dec();
    logger.debug("ws connection closed");
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/api/trpc-ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
  // Other upgrade paths are left untouched.
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  wssHandler.broadcastReconnectNotification();
  wss.close();
  metricsServer.close();
  // Close the DB pool *after* HTTP drains, so in-flight requests can finish
  // their queries. Closing earlier would tear sockets out from under handlers
  // that are still running.
  server.close(async () => {
    logger.info("http server closed");
    try {
      await closeDb();
      logger.info("db pool closed");
    } catch (err) {
      logger.error({ err }, "db pool close failed");
    }
  });
});
