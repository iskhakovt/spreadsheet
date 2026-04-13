import { execSync } from "node:child_process";
import { resolve } from "node:path";

let stop: (() => Promise<void>) | undefined;

export async function setup() {
  let url = process.env.DATABASE_URL;

  // If DATABASE_URL is already set (e.g. CircleCI Postgres sidecar),
  // skip testcontainers. Otherwise spin up a container locally.
  if (!url) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:17").start();
    url = container.getConnectionUri();
    process.env.DATABASE_URL = url;
    stop = () => container.stop();
  }

  process.env.STOKEN_SECRET ||= "integration-test-secret";

  // Run migrations + seed via the main entrypoint
  const serverDir = resolve(import.meta.dirname, "..");
  execSync("pnpm exec tsx src/main.ts setup", {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

export async function teardown() {
  await stop?.();
}
