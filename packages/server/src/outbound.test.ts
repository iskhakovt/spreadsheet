import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { outboundClicksCounter, registry } from "./metrics.js";
import { OUTBOUND_DESTINATIONS, outboundHandler } from "./outbound.js";

function makeApp() {
  const app = new Hono();
  app.get("/api/out", outboundHandler);
  return app;
}

beforeEach(() => {
  // Counter state is process-global. Reset before each case so assertions
  // about increment count don't depend on test ordering.
  outboundClicksCounter.reset();
});

describe("/api/out", () => {
  it("302-redirects to the hardcoded source URL", async () => {
    const res = await makeApp().request("/api/out?dest=source&placement=landing");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(OUTBOUND_DESTINATIONS.source);
  });

  it("302-redirects to the hardcoded tip URL", async () => {
    const res = await makeApp().request("/api/out?dest=tip&placement=results");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(OUTBOUND_DESTINATIONS.tip);
  });

  it("returns 404 for unknown destinations (allowlist is closed)", async () => {
    const res = await makeApp().request("/api/out?dest=evil&placement=landing");
    expect(res.status).toBe(404);
    // No counter increment for rejected requests — keeps the metric clean.
    const sample = await registry.getSingleMetric("outbound_clicks_total")?.get();
    expect(sample?.values).toEqual([]);
  });

  it("returns 404 when dest is missing", async () => {
    const res = await makeApp().request("/api/out");
    expect(res.status).toBe(404);
  });

  it("maps unknown placements to 'unknown' to bound label cardinality", async () => {
    const res = await makeApp().request("/api/out?dest=tip&placement=arbitrary-string");
    expect(res.status).toBe(302);
    const sample = await registry.getSingleMetric("outbound_clicks_total")?.get();
    expect(sample?.values).toEqual([
      expect.objectContaining({ labels: { dest: "tip", placement: "unknown" }, value: 1 }),
    ]);
  });

  it("increments the counter labelled with dest + placement", async () => {
    const app = makeApp();
    await app.request("/api/out?dest=source&placement=landing");
    await app.request("/api/out?dest=source&placement=landing");
    await app.request("/api/out?dest=tip&placement=results");
    const sample = await registry.getSingleMetric("outbound_clicks_total")?.get();
    expect(sample?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { dest: "source", placement: "landing" }, value: 2 }),
        expect.objectContaining({ labels: { dest: "tip", placement: "results" }, value: 1 }),
      ]),
    );
  });
});
