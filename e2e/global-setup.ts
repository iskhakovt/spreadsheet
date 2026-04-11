import { type ChildProcess, execSync, spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");

let container: StartedPostgreSqlContainer;
let serverProcess: ChildProcess;

export default async function globalSetup() {
  // Build the web bundle FIRST. The Hono server we're about to start
  // serves `packages/web/dist` as a static root; if we skip this step,
  // E2E runs against whatever stale bundle happens to be in dist/ —
  // which silently hides source changes and produces false pass/fail
  // signals.
  //
  // Why build here rather than in `webServer.command` (the Playwright
  // idiom): our server needs a dynamic `DATABASE_URL` from a
  // testcontainer that's resolved later in this same globalSetup.
  // `webServer.command` runs in a subshell with env snapshotted at
  // Playwright startup, so the testcontainer URL can't reach it. The
  // build-in-globalSetup pattern is the pragmatic fit for this stack.
  //
  // Escape hatch for local iteration: set SKIP_E2E_BUILD=1 when you
  // KNOW the bundle is already fresh (e.g. you just ran `vite build`
  // manually, or you're iterating on test logic without touching
  // packages/web source). CI should always do a fresh build, so
  // SKIP_E2E_BUILD must never be set in CI env.
  if (process.env.SKIP_E2E_BUILD === "1") {
    console.log("[global-setup] SKIP_E2E_BUILD=1 — reusing existing packages/web/dist");
  } else {
    const webDir = resolve(import.meta.dirname, "../packages/web");
    console.log("[global-setup] building packages/web...");
    const buildStart = Date.now();
    execSync("pnpm exec vite build", {
      cwd: webDir,
      stdio: "inherit",
    });
    console.log(`[global-setup] build done in ${Date.now() - buildStart}ms`);
  }

  // Start Postgres. The container URL is returned dynamically and
  // plumbed into both the setup subcommand and the server's env.
  container = await new PostgreSqlContainer("postgres:17").start();
  const url = container.getConnectionUri();

  // Run migrations + seed
  const serverDir = resolve(import.meta.dirname, "../packages/server");
  execSync("pnpm exec tsx src/main.ts setup", {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  // Start the server on a random port
  const staticRoot = resolve(import.meta.dirname, "../packages/web/dist");
  serverProcess = spawn("pnpm", ["exec", "tsx", "src/main.ts", "serve"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: url,
      STOKEN_SECRET: "e2e-test-secret",
      STATIC_ROOT: staticRoot,
      PORT: "0",
    },
    stdio: "pipe",
  });

  // Wait for server to report its actual port
  const assignedPort = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 30_000);
    serverProcess.stdout?.on("data", (data: Buffer) => {
      const match = data.toString().match(/listening on :(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error("[Server]", data.toString());
    });
    serverProcess.on("error", reject);
    serverProcess.on("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code} before printing port`));
    });
  });

  // Write port for Playwright fixtures to read
  writeFileSync(PORT_FILE, String(assignedPort));

  return async () => {
    serverProcess?.kill();
    await container?.stop();
    try {
      unlinkSync(PORT_FILE);
    } catch {}
  };
}
