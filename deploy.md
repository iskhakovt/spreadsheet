# Deploy

Single container, single process, single port. Needs a Postgres database.

## Environment Variables

| Variable | Required | Default | Description |
|-|-|-|-|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `STOKEN_SECRET` | Yes | — | HMAC secret for sync tokens (32+ random chars) |
| `PORT` | No | `8080` | HTTP port |
| `SENTRY_DSN` | No | — | Sentry/GlitchTip DSN for server errors |
| `SENTRY_DSN_FRONTEND` | No | `$SENTRY_DSN` | Separate DSN for frontend (injected at runtime) |

Generate `STOKEN_SECRET`:
```bash
openssl rand -base64 32
```

## Build

```bash
docker build -t spreadsheet .
```

## First Deploy

Run migrations + seed before starting the server:

```bash
# 1. Migrate schema
docker run --rm \
  -e DATABASE_URL=postgres://user:pass@host/db \
  spreadsheet migrate

# 2. Seed question bank
docker run --rm \
  -e DATABASE_URL=postgres://user:pass@host/db \
  spreadsheet seed

# 3. Start server
docker run -d \
  -e DATABASE_URL=postgres://user:pass@host/db \
  -e STOKEN_SECRET=$(openssl rand -base64 32) \
  -p 8080:8080 \
  spreadsheet
```

Or combine migrate + seed in one step:

```bash
docker run --rm -e DATABASE_URL=... spreadsheet setup
docker run -d -e DATABASE_URL=... -e STOKEN_SECRET=... -p 8080:8080 spreadsheet
```

## Subsequent Deploys

```bash
# Migrate (safe to run if no pending migrations)
docker run --rm -e DATABASE_URL=... spreadsheet migrate

# Seed (upserts — safe to re-run, updates question bank)
docker run --rm -e DATABASE_URL=... spreadsheet seed

# Restart server with new image
docker stop spreadsheet && docker rm spreadsheet
docker run -d --name spreadsheet \
  -e DATABASE_URL=... \
  -e STOKEN_SECRET=... \
  -p 8080:8080 \
  spreadsheet
```

## Commands

| Command | What |
|-|-|
| `serve` (default) | Start the HTTP server |
| `migrate` | Apply pending database migrations |
| `seed` | Upsert question bank data |
| `setup` | migrate + seed (convenience for first deploy / CI) |

## Health Check

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

## Notes

- **Migrations are not run on server start.** Run `migrate` explicitly before `serve`. This prevents race conditions with multiple replicas.
- **Seed is idempotent.** `ON CONFLICT DO UPDATE` — safe to run on every deploy to pick up new/updated questions.
- **STOKEN_SECRET must be stable.** Changing it invalidates all active sync tokens. Users will need to re-sync (happens automatically on next answer).
- **Distroless image** — no shell, no package manager. Debug with `docker logs`, not `docker exec`.
- **Static assets** are embedded in the image (`/app/web/`). No separate web server needed.
