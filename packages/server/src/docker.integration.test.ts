import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { type StartedTestContainer, GenericContainer, Network, type StartedNetwork, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

let network: StartedNetwork;
let postgres: StartedPostgreSqlContainer;
let server: StartedTestContainer;
let baseUrl: string;

beforeAll(async () => {
  // 1. Shared network so the app container can reach Postgres by alias
  network = await new Network().start();

  // 2. Postgres on that network
  postgres = await new PostgreSqlContainer("postgres:17")
    .withNetwork(network)
    .withNetworkAliases("db")
    .start();

  const internalUrl = `postgresql://${postgres.getUsername()}:${postgres.getPassword()}@db:5432/${postgres.getDatabase()}`;

  // 3. Build the app image from the repo root Dockerfile
  const image = await GenericContainer.fromDockerfile(repoRoot).build("spreadsheet-test", {
    deleteOnExit: false,
  });

  // 4. Run setup (migrate + seed) as a one-shot container
  const setupContainer = await image
    .withNetwork(network)
    .withCommand(["setup"])
    .withEnvironment({ DATABASE_URL: internalUrl })
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(30_000)
    .start();
  await setupContainer.stop();

  // 5. Start the server
  server = await image
    .withNetwork(network)
    .withExposedPorts(8080)
    .withCommand(["serve"])
    .withEnvironment({
      DATABASE_URL: internalUrl,
      STOKEN_SECRET: "docker-smoke-test-secret-that-is-long-enough",
    })
    .withWaitStrategy(Wait.forHttp("/health", 8080).forStatusCode(200))
    .withStartupTimeout(30_000)
    .start();

  baseUrl = `http://${server.getHost()}:${server.getMappedPort(8080)}`;
});

afterAll(async () => {
  await server?.stop();
  await postgres?.stop();
  await network?.stop();
});

describe("Docker image smoke test", () => {
  it("responds to health check", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("serves the question list API", async () => {
    const res = await fetch(`${baseUrl}/trpc/questions.list`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.data).toBeDefined();
    expect(body.result.data.length).toBeGreaterThan(100);
  });

  it("serves static assets (SPA index.html)", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });
});
