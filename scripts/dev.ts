/**
 * Dev infrastructure script — starts Postgres, runs migrations + seed, starts server + Vite.
 * Run via: pnpm dev
 */

import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const ROOT = resolve(import.meta.dirname, "..");
const SERVER_DIR = resolve(ROOT, "packages/server");

async function main() {
  console.log("Starting Postgres...");
  const container = await new PostgreSqlContainer("postgres:17")
    .withReuse()
    .withLabels({ "com.spreadsheet.dev": "true" })
    .start();

  const url = container.getConnectionUri();
  console.log(`Postgres ready: ${url}`);

  const serverEnv = {
    ...process.env,
    DATABASE_URL: url,
    STOKEN_SECRET: "dev-secret",
    STATIC_ROOT: resolve(ROOT, "packages/web/dist"),
  };

  // Migrate + seed (once, before starting server)
  console.log("Running setup...");
  execSync("pnpm exec tsx src/main.ts setup", { cwd: SERVER_DIR, env: serverEnv, stdio: "inherit" });

  // Start server
  console.log("Starting server...");
  const server = spawn("pnpm", ["exec", "tsx", "watch", "src/index.ts"], {
    cwd: SERVER_DIR,
    env: serverEnv,
    stdio: "inherit",
  });

  // Start web dev server (proxy returns 503 while backend is starting)
  const web = spawn("pnpm", ["exec", "vite"], {
    cwd: resolve(ROOT, "packages/web"),
    stdio: "inherit",
  });

  // Handle shutdown
  function cleanup() {
    server.kill();
    web.kill();
    // Container stays running (withReuse) — fast restart next time
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  server.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Server exited with code ${code}`);
      cleanup();
    }
  });
}

main().catch((err) => {
  console.error("Dev startup failed:", err);
  process.exit(1);
});
