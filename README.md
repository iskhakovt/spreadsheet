# Spreadsheet

A yes/no/maybe list for couples and groups to discover shared sexual interests. Rate activities privately, see only the overlaps.

## Stack

TypeScript full stack — Hono, tRPC v11 (HTTP + WebSocket), Drizzle, React 19, Vite 8, Tailwind, shadcn/ui, TanStack Query v5 (server state + real-time subscriptions). Optional E2E encryption (AES-256-GCM). Postgres. Distroless Docker image.

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
pnpm test:visual        # Visual regression (Playwright screenshots, desktop + mobile)
```

Visual regression baselines are stored via [Git LFS](https://git-lfs.github.com). Run `git lfs install` after cloning.

```bash
pnpm test:visual:new     # Generate baselines for new tests only
pnpm test:visual:update  # Regenerate all baselines (after intentional UI changes)
```

## Deploy

See [deploy.md](deploy.md) for self-hosting — pre-built images, environment variables, migrations, and production notes.

## Architecture

See [design/](design/) for the full design — schema, sync protocol, encryption, UI, server architecture.

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
