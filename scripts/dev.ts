/**
 * Dev infrastructure script — starts Postgres, runs migrations + seed, starts
 * Vite. Vite hosts the Hono server in-process via the spreadsheetDev plugin
 * + @hono/vite-dev-server (see packages/web/vite.config.ts), so /p/:token
 * runs the real bootstrap handler — no proxy, no second tsx-watch process.
 *
 * Run via: pnpm dev
 */

import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const ROOT = resolve(import.meta.dirname, "..");
const SERVER_DIR = resolve(ROOT, "packages/server");
const WEB_DIR = resolve(ROOT, "packages/web");

async function main() {
  console.log("Starting Postgres...");
  const container = await new PostgreSqlContainer("public.ecr.aws/docker/library/postgres:18")
    .withReuse()
    .withLabels({ "com.spreadsheet.dev": "true" })
    .start();

  const url = container.getConnectionUri();
  console.log(`Postgres ready: ${url}`);

  const env = {
    ...process.env,
    DATABASE_URL: url,
    STOKEN_SECRET: "dev-secret",
  };

  // Migrate + seed (once, before Vite picks up the DB pool)
  console.log("Running setup...");
  execSync("pnpm exec tsx src/main.ts setup", { cwd: SERVER_DIR, env, stdio: "inherit" });

  // Vite owns everything from here: serves the SPA, hosts Hono in-process
  // (every transport — queries, mutations, SSE subscriptions — rides through
  // the same /api/trpc/* fetch handler). No second process.
  console.log("Starting Vite (with in-process Hono)...");
  const vite = spawn("pnpm", ["exec", "vite"], {
    cwd: WEB_DIR,
    env,
    stdio: "inherit",
  });

  function cleanup(exitCode = 0) {
    vite.kill();
    // Container stays running (withReuse) — fast restart next time
    process.exit(exitCode);
  }

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  vite.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Vite exited with code ${code}`);
      cleanup(code);
    }
  });
}

main().catch((err) => {
  console.error("Dev startup failed:", err);
  process.exit(1);
});
