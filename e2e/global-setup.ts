import { type ChildProcess, execSync, spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");

let container: StartedPostgreSqlContainer;
let serverProcess: ChildProcess;

export default async function globalSetup() {
  // Start Postgres
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
