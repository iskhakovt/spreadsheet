import { type ChildProcess, execSync, spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Network, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");

let container: StartedPostgreSqlContainer;
let serverProcess: ChildProcess | undefined;
let appContainer: StartedTestContainer | undefined;
let network: StartedNetwork | undefined;

/**
 * When E2E_IMAGE is set (CI), the app runs from the pre-built Docker
 * image — the actual artifact that ships. This catches packaging bugs
 * (wrong entrypoint, missing static assets, distroless issues).
 *
 * Locally, it falls back to `tsx` for fast iteration without a Docker
 * build. Set SKIP_E2E_BUILD=1 to reuse an existing web bundle.
 */
export default async function globalSetup() {
  const e2eImage = process.env.E2E_IMAGE;

  if (e2eImage) {
    return setupDocker(e2eImage);
  }
  return setupLocal();
}

// ---------------------------------------------------------------------------
// Docker path — tests the real image (CI)
// ---------------------------------------------------------------------------

async function setupDocker(imageName: string) {
  console.log(`[global-setup] using Docker image: ${imageName}`);

  // Shared network so the app container can reach Postgres by alias
  network = await new Network().start();

  container = await new PostgreSqlContainer("postgres:17").withNetwork(network).withNetworkAliases("pg").start();

  const internalDbUrl = `postgresql://${container.getUsername()}:${container.getPassword()}@pg:5432/${container.getDatabase()}`;

  // Run setup (migrate + seed) as a one-shot container
  const setupContainer = await new GenericContainer(imageName)
    .withNetwork(network)
    .withCommand(["setup"])
    .withEnvironment({ DATABASE_URL: internalDbUrl })
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(30_000)
    .start();
  await setupContainer.stop();

  // Start the server
  appContainer = await new GenericContainer(imageName)
    .withNetwork(network)
    .withExposedPorts(8080)
    .withCommand(["serve"])
    .withEnvironment({
      DATABASE_URL: internalDbUrl,
      STOKEN_SECRET: "e2e-test-secret-that-is-long-enough",
    })
    .withWaitStrategy(Wait.forHttp("/health", 8080).forStatusCode(200))
    .withStartupTimeout(30_000)
    .start();

  const host = appContainer.getHost();
  const port = appContainer.getMappedPort(8080);
  writeFileSync(PORT_FILE, `${host}:${port}`);
  console.log(`[global-setup] server ready at http://${host}:${port}`);

  return async () => {
    await appContainer?.stop();
    await container?.stop();
    await network?.stop();
    try {
      unlinkSync(PORT_FILE);
    } catch {}
  };
}

// ---------------------------------------------------------------------------
// Local path — fast iteration with tsx (no Docker build needed)
// ---------------------------------------------------------------------------

async function setupLocal() {
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

  container = await new PostgreSqlContainer("postgres:17").start();
  const url = container.getConnectionUri();

  const serverDir = resolve(import.meta.dirname, "../packages/server");
  execSync("pnpm exec tsx src/main.ts setup", {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const staticRoot = resolve(import.meta.dirname, "../packages/web/dist");
  const proc = spawn("pnpm", ["exec", "tsx", "src/main.ts", "serve"], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: url,
      STOKEN_SECRET: "e2e-test-secret",
      STATIC_ROOT: staticRoot,
      PORT: "0",
    },
    stdio: "pipe",
  });
  serverProcess = proc;

  const assignedPort = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 30_000);
    let buffer = "";
    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const log = JSON.parse(line) as { msg?: string; port?: number };
          if (log.msg === "server listening" && typeof log.port === "number") {
            clearTimeout(timeout);
            resolve(log.port);
            return;
          }
        } catch {
          // not JSON — ignore (e.g. tsx warnings)
        }
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      console.error("[Server]", data.toString());
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code} before printing port`));
    });
  });

  writeFileSync(PORT_FILE, `localhost:${assignedPort}`);

  return async () => {
    serverProcess?.kill();
    await container?.stop();
    try {
      unlinkSync(PORT_FILE);
    } catch {}
  };
}
