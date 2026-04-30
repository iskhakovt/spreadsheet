import type { Context } from "hono";
import { outboundClicksCounter } from "./metrics.js";

// Destinations are hardcoded — no env override. The author's tip jar and
// source repo are intentionally baked into the bundle: it's a single
// upstream project, not a generic chassis for self-hosters to relabel.
// Forks who want to change either of these can change them in code.
export const OUTBOUND_DESTINATIONS = {
  source: "https://github.com/iskhakovt/spreadsheet",
  tip: "https://buymeacoffee.com/timurfyi",
} as const;

// Allowlist for the placement label — keeps Prometheus label cardinality
// bounded no matter what the client sends.
export const OUTBOUND_PLACEMENTS = new Set(["landing", "results"]);

export function outboundHandler(c: Context) {
  const dest = c.req.query("dest") ?? "";
  const url = OUTBOUND_DESTINATIONS[dest as keyof typeof OUTBOUND_DESTINATIONS];
  if (!url) return c.text("Not found", 404);

  const rawPlacement = c.req.query("placement") ?? "";
  const placement = OUTBOUND_PLACEMENTS.has(rawPlacement) ? rawPlacement : "unknown";

  outboundClicksCounter.inc({ dest, placement });
  return c.redirect(url, 302);
}
