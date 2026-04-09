# Spreadsheet

A yes/no/maybe list for couples and groups to discover shared sexual interests. Rate activities privately, see only the overlaps.

## Stack

TypeScript full stack — Hono, tRPC, Drizzle, React, Vite, Tailwind, shadcn/ui. Optional E2E encryption (AES-256-GCM). Postgres. Distroless Docker image.

## Quick Start

```bash
# Prerequisites: Node 24, pnpm, Docker

# Install dependencies (also sets up pre-commit hooks via Husky)
pnpm install

# Start everything (Postgres + schema + server + web)
pnpm dev
```

`pnpm dev` starts Postgres via Testcontainers, applies the schema, then runs the backend (`:8080`) and Vite dev server (`:5173`) in parallel. Postgres container persists across restarts (fast re-launch).

## Testing

```bash
pnpm test               # Unit tests (PGlite, no Docker needed)
pnpm test:integration   # Integration tests (Testcontainers, needs Docker)
pnpm test:e2e           # E2E tests (Playwright + Testcontainers)
```

## Build

```bash
# Docker image
docker build -t spreadsheet .

# Run
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  -e STOKEN_SECRET="..." \
  spreadsheet
```

## Architecture

See [DESIGN.md](DESIGN.md) for the full design — schema, sync protocol, encryption, UI.

```
packages/
  shared/     Zod schemas, types, crypto format helpers
  server/     Hono + tRPC + Drizzle + Postgres
  web/        React + Vite + Tailwind + shadcn/ui
```

## CI/CD

- **CI:** Typecheck → lint → unit/integration/e2e → semantic-release
- **Publish:** Tag `v*` → Docker build → push to GHCR
- **Dependabot:** Weekly updates for npm, Docker, GitHub Actions

## License

Code: [Apache License 2.0](LICENSE)

Question bank (`packages/server/src/db/seed.ts`): [CC BY 4.0](packages/server/src/db/LICENSE-QUESTIONS)

The name "Spreadsheet" and associated branding are not licensed under either license (Apache 2.0 Section 6).
