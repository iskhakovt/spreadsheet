import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createDatabase } from "./db/index.js";
import { GroupStore } from "./store/groups.js";
import { QuestionStore } from "./store/questions.js";
import { SyncStore } from "./store/sync.js";
import { initSentry } from "./sentry.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

initSentry();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const db = createDatabase(databaseUrl);
const stores = {
  groups: new GroupStore(db),
  sync: new SyncStore(db),
  questions: new QuestionStore(db),
};

const app = new Hono();

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
  }),
);

// SPA fallback
let indexHtml: string | null = null;
try {
  indexHtml = readFileSync(resolve(staticRoot, "index.html"), "utf-8").replace("</head>", `${envScript}</head>`);
} catch {
  // index.html may not exist during dev
}

app.get("/*", (c) => {
  if (!indexHtml) return c.text("Not found", 404);
  return c.html(indexHtml);
});

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 8080;
const server = serve({ fetch: app.fetch, port });
server.on("listening", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  console.log(`listening on :${actualPort}`);
});
