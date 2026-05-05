import { type ChildProcess, execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from "testcontainers";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");
const METRICS_PORT_FILE = resolve(import.meta.dirname, ".e2e-metrics-port");

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

  container = await new PostgreSqlContainer("public.ecr.aws/docker/library/postgres:18")
    .withNetwork(network)
    .withNetworkAliases("pg")
    .start();

  // Use URL constructor to properly encode username/password
  const dbUrl = new URL("", "postgresql://");
  dbUrl.hostname = "pg";
  dbUrl.port = "5432";
  dbUrl.pathname = container.getDatabase();
  dbUrl.username = container.getUsername();
  dbUrl.password = container.getPassword();
  const internalDbUrl = dbUrl.toString();

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
    .withExposedPorts(8080, 9090)
    .withCommand(["serve"])
    .withEnvironment({
      DATABASE_URL: internalDbUrl,
      STOKEN_SECRET: "e2e-test-secret",
      REQUIRE_ENCRYPTION: "false",
    })
    .withWaitStrategy(Wait.forHttp("/health", 8080).forStatusCode(200))
    .withStartupTimeout(30_000)
    .start();

  const host = appContainer.getHost();
  const port = appContainer.getMappedPort(8080);
  const metricsPort = appContainer.getMappedPort(9090);
  writeFileSync(PORT_FILE, `${host}:${port}`);
  writeFileSync(METRICS_PORT_FILE, `${host}:${metricsPort}`);
  console.log(`[global-setup] server ready at http://${host}:${port}`);

  return async () => {
    // Stop app first (closes DB connections), then Postgres, then network
    await appContainer?.stop().catch(() => {});
    await container?.stop().catch(() => {});
    await network?.stop().catch(() => {});
    for (const f of [PORT_FILE, METRICS_PORT_FILE]) {
      try {
        unlinkSync(f);
      } catch {}
    }
  };
}

// ---------------------------------------------------------------------------
// Local path — fast iteration with tsx (no Docker build needed)
// ---------------------------------------------------------------------------

/**
 * Resolve a bin from node_modules/.bin, falling back to `pnpm exec <name>`.
 * Inside the Playwright Docker container there is no pnpm — only the
 * monorepo's node_modules tree mounted from the host. pnpm may hoist the
 * bin to the root or keep it in a package-specific node_modules, so check
 * all likely locations.
 */
function resolveBin(name: string): string {
  const monorepoRoot = resolve(import.meta.dirname, "..");
  for (const dir of ["", "packages/server", "packages/web"]) {
    const candidate = resolve(monorepoRoot, dir, `node_modules/.bin/${name}`);
    if (existsSync(candidate)) return candidate;
  }
  return `pnpm exec ${name}`;
}

async function setupLocal() {
  if (process.env.SKIP_E2E_BUILD === "1") {
    console.log("[global-setup] SKIP_E2E_BUILD=1 — reusing existing packages/web/dist");
  } else {
    const webDir = resolve(import.meta.dirname, "../packages/web");
    console.log("[global-setup] building packages/web...");
    const buildStart = Date.now();
    const vite = resolveBin("vite");
    execSync(`${vite} build`, {
      cwd: webDir,
      stdio: "inherit",
    });
    console.log(`[global-setup] build done in ${Date.now() - buildStart}ms`);
  }

  container = await new PostgreSqlContainer("public.ecr.aws/docker/library/postgres:18").start();
  const url = container.getConnectionUri();

  const serverDir = resolve(import.meta.dirname, "../packages/server");
  const tsx = resolveBin("tsx");
  execSync(`${tsx} src/main.ts setup`, {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const staticRoot = resolve(import.meta.dirname, "../packages/web/dist");
  const proc = spawn(tsx, ["src/main.ts", "serve"], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: url,
      STOKEN_SECRET: "e2e-test-secret",
      STATIC_ROOT: staticRoot,
      PORT: "0",
      METRICS_PORT: "0",
      REQUIRE_ENCRYPTION: "false",
    },
    stdio: "pipe",
  });
  serverProcess = proc;

  const [assignedPort, assignedMetricsPort] = await new Promise<[number, number]>((resolve, reject) => {
    if (!proc.stdout) return reject(new Error("Server stdout not available"));
    const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 30_000);
    let mainPort: number | undefined;
    let metricsPort: number | undefined;
    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        const log = JSON.parse(line) as { msg?: string; port?: number };
        if (log.msg === "server listening" && typeof log.port === "number") mainPort = log.port;
        if (log.msg === "metrics server listening" && typeof log.port === "number") metricsPort = log.port;
        if (mainPort !== undefined && metricsPort !== undefined) {
          clearTimeout(timeout);
          rl.close();
          resolve([mainPort, metricsPort]);
        }
      } catch {
        // not JSON — ignore (e.g. tsx warnings)
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
  writeFileSync(METRICS_PORT_FILE, `localhost:${assignedMetricsPort}`);

  return async () => {
    if (serverProcess) {
      serverProcess.kill();
      await once(serverProcess, "close", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
    await container?.stop();
    for (const f of [PORT_FILE, METRICS_PORT_FILE]) {
      try {
        unlinkSync(f);
      } catch {}
    }
  };
}
