import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const groupsCreatedCounter = new Counter({
  name: "groups_created_total",
  help: "Total groups created",
  registers: [registry],
});

export const groupsSetupCompletedCounter = new Counter({
  name: "groups_setup_completed_total",
  help: "Total groups that completed admin setup",
  registers: [registry],
});

export const syncPushCounter = new Counter({
  name: "sync_push_total",
  help: "Total sync push operations",
  labelNames: ["result"],
  registers: [registry],
});

export const markCompleteCounter = new Counter({
  name: "mark_complete_total",
  help: "Total persons who marked their answers complete",
  registers: [registry],
});

export const resultsViewedCounter = new Counter({
  name: "results_viewed_total",
  help: "Total results views",
  registers: [registry],
});

export const outboundClicksCounter = new Counter({
  name: "outbound_clicks_total",
  help: "Total outbound link clicks via /api/out proxy",
  labelNames: ["dest", "placement"],
  registers: [registry],
});
