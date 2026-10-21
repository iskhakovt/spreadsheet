import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("mirror.gcr.io/library/postgres:18").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.STOKEN_SECRET = "integration-test-secret";

  // Run migrations + seed via the main entrypoint
  // packages/server — tsx resolves `src/main.ts` against it. pnpm ≤10.27's exec
  // silently moved to the package root; newer pnpm keeps the given cwd.
  const serverDir = resolve(import.meta.dirname, "../..");
  execSync("pnpm exec tsx src/main.ts setup", {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

export async function teardown() {
  await container?.stop();
}
