import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./fixtures.js";

const metricsBase = `http://${readFileSync(resolve(import.meta.dirname, ".e2e-metrics-port"), "utf-8").trim()}`;

function parseGauge(body: string, name: string): number {
  const match = new RegExp(`^${name}\\s+([\\d.]+)`, "m").exec(body);
  return match ? parseFloat(match[1]) : 0;
}

test("GET /metrics returns Prometheus text format with expected metrics", async ({ request }) => {
  const response = await request.get(`${metricsBase}/metrics`);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const body = await response.text();
  expect(body).toContain("groups_created_total");
  expect(body).toContain("groups_setup_completed_total");
  expect(body).toContain("sync_push_total");
  expect(body).toContain("mark_complete_total");
  expect(body).toContain("results_viewed_total");
  expect(body).toContain("ws_connections_active");
  expect(body).toContain("http_request_duration_seconds");
});

test("main app port does not serve /metrics", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/metrics`);
  expect(response.status()).toBe(404);
});

test("ws_connections_active gauge increments on connect and decrements on close", async ({
  page,
  baseURL,
  request,
}) => {
  const getGauge = async () => {
    const body = await (await request.get(`${metricsBase}/metrics`)).text();
    return parseGauge(body, "ws_connections_active");
  };

  const before = await getGauge();

  const wsUrl = baseURL!.replace("http://", "ws://") + "/api/trpc-ws";
  await page.evaluate((url) => {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        (window as unknown as Record<string, unknown>).__e2eWs = ws;
        resolve();
      };
    });
  }, wsUrl);

  await expect.poll(getGauge, { timeout: 5_000 }).toBeGreaterThan(before);

  await page.evaluate(() => {
    ((window as unknown as Record<string, unknown>).__e2eWs as WebSocket).close();
  });

  await expect.poll(getGauge, { timeout: 5_000 }).toBe(before);
});
