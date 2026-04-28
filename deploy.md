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
| `TIP_JAR_URL` | No | unset | Optional `http(s)://` URL — when set, a quiet "Buy me a coffee" link renders next to the GitHub source link on Landing and `/results`. Unset hides the link entirely. |

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

Key metrics: `ws_connections_active`, `http_request_duration_seconds`, `groups_created_total`, `groups_setup_completed_total`, `sync_push_total`, `mark_complete_total`, `results_viewed_total`, plus Node.js default metrics (event loop lag, memory, CPU).

## Logging

The server outputs newline-delimited JSON (pino) in production. Each line is a structured object with `level`, `time`, `msg`, and request context. Pipe to `jq` for local debugging, or ship directly to a log aggregator (Loki, ELK, CloudWatch).

```bash
docker logs spreadsheet | jq .
```

Set `LOG_LEVEL=debug` for verbose output during troubleshooting.

Tokens and auth headers are redacted at the logger level — see [design/server.md](design/server.md#secret-redaction) for the mechanism and its limitations.

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
