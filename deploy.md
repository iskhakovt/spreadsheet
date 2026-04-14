# Deploy

Single container, single process, single port. Needs a Postgres database.

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
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `fatal`) |
| `SENTRY_DSN` | No | — | Sentry/GlitchTip DSN for server errors |
| `SENTRY_DSN_FRONTEND` | No | `$SENTRY_DSN` | Separate DSN for frontend (injected at runtime) |

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
# {"status":"ok"}
```

## Logging

The server outputs newline-delimited JSON (pino) in production. Each line is a structured object with `level`, `time`, `msg`, and request context. Pipe to `jq` for local debugging, or ship directly to a log aggregator (Loki, ELK, CloudWatch).

```bash
docker logs spreadsheet | jq .
```

Set `LOG_LEVEL=debug` for verbose output during troubleshooting.

Tokens and auth headers are redacted at the logger level — see [design/server.md](design/server.md#secret-redaction) for the mechanism and its limitations.

## Monitoring

Sentry/GlitchTip is optional. Two DSNs:

- `SENTRY_DSN` — used by the server. Unset to disable server-side error reporting.
- `SENTRY_DSN_FRONTEND` — used by the browser bundle. Defaults to `SENTRY_DSN` if unset. Set separately when you want client and server errors to land in different projects.

The frontend DSN is **injected at serve time** into `index.html` as `window.__ENV.SENTRY_DSN`, not baked into the JS bundle. This means the same built image can target multiple environments without rebuilding — changing the env var and restarting is enough.

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
