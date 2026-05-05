import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { createDatabase } from "./db/index.js";
import { renderIndex } from "./index-html.js";
import { logger } from "./logger.js";
import { registry } from "./metrics.js";
import type { ShellRenderer } from "./spa-routes.js";
import { GroupStore } from "./store/groups.js";
import { QuestionStore } from "./store/questions.js";
import { SyncStore } from "./store/sync.js";

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

// Pre-render the SPA shell once at startup. Two variants:
//   default — landing & free routes: og:image = /og-image.png, standard copy
//   invite  — /p/:token: og:image = /og-invite.png, "Your turn" copy
// Messenger crawlers (Facebook, iMessage, WhatsApp) fetch og:image from the
// HTML at the invite URL, so per-token links unfurl with invite-framed copy.
const staticRoot = process.env.STATIC_ROOT ?? "../web/dist";
let cachedDefault: string | null = null;
let cachedInvite: string | null = null;
try {
  const raw = readFileSync(resolve(staticRoot, "index.html"), "utf-8");
  cachedDefault = renderIndex(raw, {
    ogImage: "/og-image.png",
    ogTitle: "Spreadsheet",
    ogImageAlt: "Spreadsheet — find the overlap",
  });
  cachedInvite = renderIndex(raw, {
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

const shell: ShellRenderer = {
  default: async () => cachedDefault,
  invite: async () => cachedInvite,
};

const app = createApp({
  stores,
  shell,
  envConfig: { REQUIRE_ENCRYPTION: process.env.REQUIRE_ENCRYPTION !== "false" },
  staticRoot,
});

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

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  metricsServer.close();
  // Close the DB pool *after* HTTP drains, so in-flight requests can finish
  // their queries. Closing earlier would tear sockets out from under handlers
  // that are still running. Open SSE streams close naturally when the server
  // socket closes; clients reconnect to the new instance with their last
  // `tracked()` cursor and replay anything they missed.
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
