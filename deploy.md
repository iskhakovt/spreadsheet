# Deploy

Single container, single process. Exposes two ports: `8080` (app) and `9090` (Prometheus metrics). Needs a Postgres database.

## Image

Pre-built images are published to GHCR on every release:

```bash
docker pull ghcr.io/iskhakovt/spreadsheet:<version>
```

## Environment Variables

| Variable | Required | Default | Description |
|-|-|-|-|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `STOKEN_SECRET` | Yes | — | HMAC secret for sync tokens (32+ random chars) |
| `PORT` | No | `8080` | HTTP port |
| `METRICS_PORT` | No | `9090` | Prometheus metrics port (bind to internal network only) |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `fatal`) |
| `REQUIRE_ENCRYPTION` | No | enforced | Set to literal `false` to let the create-group form expose an encryption opt-out checkbox (dev convenience). Any other value, or unset, keeps E2E encryption mandatory. Production should leave this unset. |

Generate `STOKEN_SECRET`:
```bash
openssl rand -base64 32
```

## First Deploy

```bash
IMAGE=ghcr.io/iskhakovt/spreadsheet:<version>

# 1. Migrate + seed (one step)
docker run --rm -e DATABASE_URL=postgres://user:pass@host/db "$IMAGE" setup

# 2. Start server
docker run -d --name spreadsheet \
  -e DATABASE_URL=postgres://user:pass@host/db \
  -e STOKEN_SECRET="$(openssl rand -base64 32)" \
  -p 8080:8080 \
  -p 9090:9090 \
  "$IMAGE"
```

## Subsequent Deploys

```bash
IMAGE=ghcr.io/iskhakovt/spreadsheet:<version>

# Migrate + seed (safe to re-run — idempotent)
docker run --rm -e DATABASE_URL=... "$IMAGE" setup

# Restart with new image
docker stop spreadsheet && docker rm spreadsheet
docker run -d --name spreadsheet \
  -e DATABASE_URL=... \
  -e STOKEN_SECRET=... \
  -p 8080:8080 \
  -p 9090:9090 \
  "$IMAGE"
```

## Commands

| Command | What |
|-|-|
| `serve` (default) | Start the HTTP server |
| `migrate` | Apply pending database migrations |
| `seed` | Upsert question bank data |
| `setup` | migrate + seed (convenience) |

## Health Check

```bash
curl http://localhost:8080/health
# {"status":"ok","version":"1.2.3"}
```

## Metrics

Prometheus metrics are available on a dedicated port (default `9090`):

```bash
curl http://localhost:9090/metrics
```

The metrics server listens on a separate port from the main app (default `9090`) so it can be firewalled off from public traffic independently. Point your Prometheus scrape config at `host:9090/metrics` and bind `METRICS_PORT` to an internal-only network interface.

Key metrics: `sse_connections_active{procedure}`, `http_request_duration_seconds`, `groups_created_total`, `groups_setup_completed_total`, `sync_push_total`, `mark_complete_total`, `results_viewed_total`, `outbound_clicks_total{dest, placement}`, plus Node.js default metrics (event loop lag, memory, CPU).

The `sse_connections_active{procedure}` gauge tracks open SSE subscription streams labeled by tRPC procedure path (`groups.onStatus`, `sync.onJournalChange`, `sync.onSelfJournalChange`). Useful alerts: gauge stuck at `0` for an extended window during business hours = something is silently breaking the stream upstream (proxy buffering, idle-timeout dropping connections, etc.); gauge growing monotonically = subscriptions opening but never closing, either a server-side leak or a client reconnect loop.

## Logging

The server outputs newline-delimited JSON (pino) in production. Each line is a structured object with `level`, `time`, `msg`, and request context. Pipe to `jq` for local debugging, or ship directly to a log aggregator (Loki, ELK, CloudWatch).

```bash
docker logs spreadsheet | jq .
```

Set `LOG_LEVEL=debug` for verbose output during troubleshooting.

Tokens and auth headers are redacted at the logger level — see [design/server.md](design/server.md#secret-redaction) for the mechanism and its limitations.

## Real-time subscriptions (SSE)

The app uses tRPC v11 over Server-Sent Events for real-time delivery (status broadcasts, journal updates). Three things to verify in front of the app:

### HTTP/2 termination is required

Browsers cap concurrent HTTP/1.1 connections to 6 per origin. A single `/results` tab opens 3 SSE streams; two such tabs saturate the cap and HTTP queries start queueing. **Production must terminate HTTP/2 (or HTTP/3) to the browser** so these streams multiplex onto one TCP connection (~100 stream cap negotiated by default).

Verified by every modern edge — Cloudflare, Caddy, Vercel, Fly, Render, Railway, nginx ≥1.10 all default to HTTP/2. Plain HTTP/1.1 reverse proxies will starve subscriptions under multi-tab use.

Smoke check after deploy:

```bash
curl --http2 -sI https://your-host/health
# Expect the first response line to be: HTTP/2 200
```

The point is to verify HTTP/2 negotiation, not the status code. `/health` is the right target because it returns a deterministic 200 and is unauthenticated. (Hitting `/api/trpc/groups.onStatus` directly with `HEAD` returns a 4xx — the protocol still negotiates correctly, but the status looks alarming.) If the first response line is `HTTP/1.1`, the fronting layer is downgrading and needs reconfiguration before this app can run reliably.

### SSE-friendly proxy config

Anything between the app and the browser that buffers responses will silently break SSE — frames pile up inside the buffer until it fills (or the response closes), and the browser sees one stale chunk instead of a live stream. Hono's own `compress()` middleware auto-skips `text/event-stream`, but external layers need attention:

- **nginx**: set `proxy_buffering off;` for the `/api/trpc/*` location, OR have the app set `X-Accel-Buffering: no` (already happens via tRPC's SSE producer).
- **Cloudflare**: ensure `Cache-Control: no-cache, no-transform` on subscription responses (set by tRPC).
- **AWS ALB / GCP HTTP(S) LB**: idle-timeout > 30s. Default is usually 60s — fine. The server pings every 30s to keep the connection warm; client gives up and reconnects after 35s of inactivity.
- **Heroku-style 30s exact idle timeouts**: edge-case — clients may see a brief disconnect/reconnect every 30s. Not data-loss-causing (`tracked()` resume backfills) but noisy in logs. Deploy somewhere with longer idle limits if possible.
- **Tuning the ping/reconnect margin**: the defaults (30s server ping, 35s client `reconnectAfterInactivityMs` — set in `packages/server/src/trpc/init.ts`) leave a 5s tolerance window. Real-world network jitter under load can cross 5s, causing spurious reconnect/backfill churn. For production, consider widening client tolerance to 45–60s (or aligning the server ping interval with the load-balancer idle-timeout), trading a slightly slower detection of genuinely-dead connections for fewer false-positive reconnects.

### Graceful shutdown semantics

On SIGTERM, the server fires `close()` on the metrics and main HTTP listeners. Open SSE streams break as the server socket drains; clients reconnect to the new instance with their last `tracked()` cursor in `Last-Event-ID`, and the procedure's backfill replays anything missed. A container roll = transient interruption (~3s of EventSource reconnect delay + backfill round-trip), no data loss. 5–10 second drain headroom is enough for the EventSource fixed retry to bridge.

## Notes

- **Migrations are not run on server start.** Run `setup` (or `migrate`) explicitly before `serve`. This prevents race conditions with multiple replicas.
- **Seed is idempotent.** `ON CONFLICT DO UPDATE` — safe to run on every deploy to pick up new/updated questions.
- **STOKEN_SECRET must be stable.** Changing it invalidates all active sync tokens. Users will need to re-sync (happens automatically on next answer).
- **Distroless image** — no shell, no package manager. Debug with `docker logs`, not `docker exec`.
- **Static assets** are embedded in the image (`/app/web/`). No separate web server needed.

## Building from Source

For air-gapped or custom builds:

```bash
docker build -t spreadsheet --build-arg VERSION=custom .
```
