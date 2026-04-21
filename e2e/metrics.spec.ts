import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const metricsBase = `http://${readFileSync(resolve(import.meta.dirname, ".e2e-metrics-port"), "utf-8").trim()}`;

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
