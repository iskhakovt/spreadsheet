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
import { requestLogger } from "./request-logger.js";
import { initSentry } from "./sentry.js";
import { GroupStore } from "./store/groups.js";
import { QuestionStore } from "./store/questions.js";
import { SyncStore } from "./store/sync.js";
import { createContext, createWSContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

initSentry();
logger.info("server starting");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.fatal("DATABASE_URL environment variable is required");
  throw new Error("DATABASE_URL environment variable is required");
}

const db = createDatabase(databaseUrl);
const stores = {
  groups: new GroupStore(db),
  sync: new SyncStore(db),
  questions: new QuestionStore(db),
};

const app = new Hono<HonoLoggerEnv>();

app.use("*", requestLogger(logger));

// Health check — container orchestration uses this
app.get("/health", (c) => c.json({ status: "ok" }));

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

// Runtime config injected into index.html as window.__ENV
const runtimeEnv = JSON.stringify({
  SENTRY_DSN: process.env.SENTRY_DSN_FRONTEND ?? process.env.SENTRY_DSN ?? "",
});
const envScript = `<script>window.__ENV=${runtimeEnv}</script>`;

// Static files
const staticRoot = process.env.STATIC_ROOT ?? "../web/dist";
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

// SPA fallback. Two pre-rendered variants:
//   default — landing & free routes: og:image = /og-image.png, standard copy
//   invite  — /p/:token: og:image = /og-invite.png, "Your turn" copy
// Messenger crawlers (Facebook, iMessage, WhatsApp) fetch og:image from the
// HTML at the invite URL, so per-token links unfurl with invite-framed copy.
let indexHtmlDefault: string | null = null;
let indexHtmlInvite: string | null = null;
try {
  const raw = readFileSync(resolve(staticRoot, "index.html"), "utf-8").replace("</head>", `${envScript}</head>`);
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

app.get("/*", (c) => {
  const html = c.req.path.startsWith("/p/") ? indexHtmlInvite : indexHtmlDefault;
  if (!html) return c.text("Not found", 404);
  c.header("Cache-Control", "no-cache");
  return c.html(html);
});

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 8080;
const server = serve({ fetch: app.fetch, port });
server.on("listening", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  logger.info({ port: actualPort }, "server listening");
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
  logger.debug("ws connection opened");
  ws.on("close", () => logger.debug("ws connection closed"));
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
  server.close(() => {
    logger.info("http server closed");
  });
});
