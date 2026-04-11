# Spreadsheet

A yes/no/maybe list for couples and groups to discover shared sexual interests. See [DESIGN.md](DESIGN.md) for full design.

## Stack

- **Language:** TypeScript (full stack, shared types via tRPC)
- **Backend:** Node.js, Hono, tRPC, Drizzle, Zod
- **Frontend:** React, Vite 8, Tailwind, shadcn/ui (Base UI primitives)
- **Database:** Postgres (prod + dev), PGlite (unit tests)
- **Offline:** vite-plugin-pwa, localStorage
- **Testing:** Vitest, PGlite, testcontainers
- **Build:** pnpm, Biome

## Monorepo Structure

pnpm workspaces with three packages:

| Package | Responsibility |
|-|-|
| `packages/shared` | Zod schemas, TypeScript types, constants. Imported by both server and web. |
| `packages/server` | Hono HTTP server, tRPC routes, stores, Drizzle schema, seed data, migrations |
| `packages/web` | React SPA — Vite, shadcn/ui, pages, components, hooks, localStorage, sync, encryption |

Workspace dependency: `"@spreadsheet/shared": "workspace:*"` in both server and web.

Root `package.json` holds shared devDependencies (biome, vitest) and workspace scripts.

### Key Patterns

- **Admin token flow** — `groups.create` returns `adminToken` (no person). `setupAdmin` creates admin + partners + marks ready in one transaction, reusing adminToken as person token.
- **Encryption** — key in URL fragment `#key=...`, cached in `sessionStorage`. `wrapSensitive`/`unwrapSensitive` handle encrypt/decrypt transparently. Opaque `p:1:`/`e:1:` prefix format.
- **Routing** — wouter nested routes under `/p/:token`. Two navigation patterns:
  - **Universal guard**: `resolveRoute()` computes the correct screen from status. A `<Redirect>` at the top of the Switch redirects if the current route doesn't match. Free routes (`/invite`, `/summary`, `/review`) are exempt — users navigate there intentionally.
  - **Explicit navigation**: actions that change completion state (markComplete) navigate explicitly to `/waiting` because free routes are exempt from the guard. All other state changes use `await refreshStatus()` and let the guard redirect.
  - **Rule**: always `await` callbacks that trigger `refreshStatus()`. Fire-and-forget causes stale guards.
- **Auto-sync** — 3s debounce after last answer. Indicator hidden for first 5s (uses `visibility: hidden` for no layout shift). Conflict: merge + retry.
- **Question flow** — `Screen` discriminated union (`welcome` | `question`). Welcome interstitials at category boundaries. All categories on by default, managed from Summary screen. Timing sub-question ("now or later?") controlled by `group.showTiming`.
- **Session** — Zustand vanilla store (`lib/session.ts`) holds auth token + localStorage scope. Per-tab (module-scoped), not localStorage. `setSession(token)` called synchronously on every render.
- **Storage** — localStorage scoped by FNV-1a hash of token (`s{hash}:key`). Multiple persons coexist without cross-contamination. Shared `fnv1a` hash in `@spreadsheet/shared`.

### Server Structure

```
packages/server/src/
  db/         ← schema, migrations, helpers, seed (data layer)
  store/      ← GroupStore, SyncStore, QuestionStore (business logic + DB)
  trpc/       ← routes, context, middleware (transport layer)
  test/       ← shared test helpers
```

Dependencies flow one way: `trpc/ → store/ → db/`. Routes are thin — validation, auth guards, error mapping. Stores own all DB access.

### Store Pattern

Every store enforces transactions via a `#tx` private function. No raw `db` field — impossible to bypass:

```typescript
class GroupStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  constructor(db: Database) { this.#tx = (fn) => db.transaction(fn); }
  async setProfile(id: string, input: ...) {
    await this.#tx(tx => tx.update(persons).set(input).where(eq(persons.id, id)));
  }
}
```

Stores return result objects with `{ error: "..." }` for expected failures. Routes map these to `TRPCError`.

## Code Style

- **Idiomatic TypeScript** — use interfaces for object shapes, generics for reusable components.
- **`function` declarations for named exports** — `function foo()` not `const foo = () => {}`. Arrow functions for callbacks and inline lambdas only.
- **Naming** — lowercase-hyphenated filenames (`category-picker.tsx`), `.test.ts` suffix for tests. PascalCase for types/interfaces/components, camelCase for functions/variables.
- **Imports** — ESM with `.js` extensions. Named imports over default exports. No circular imports.
- **`#private` fields** — use ES2022 `#private` (runtime-enforced) over TypeScript `private` when writing classes.
- **Error handling** — throw `TRPCError` in procedures. Frontend catches via tRPC's error handling. No silent swallows.
- **No mutable state across boundaries** — return defensive copies, use `Readonly<T>` where practical.
- **Use the stack** — Zod for validation, Drizzle for queries, tRPC for API contracts. Don't reinvent.
- **Inject dependencies** — pass db/services as parameters, don't hard-import. Keeps tests clean.

## Commits

**Conventional Commits** — all messages follow `type(scope): description`. Types follow `@commitlint/config-conventional` defaults (`feat`, `fix`, `perf`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `style`, `revert`). Scope: `server`, `web`, `shared`, `db`. Semantic-release uses these to determine version bumps (`feat` → minor, `fix` → patch, `BREAKING CHANGE` → major). Non-conventional messages won't trigger a release. PR titles are validated by the `pr-title` CI job (commitlint). To customize the accepted types, edit `.releaserc.json` — `commitlint.config.js` derives its `type-enum` from there.

## Architecture Rules

- **All DB access goes through stores.** Routes never use `ctx.db` directly. Stores enforce transactions via `#tx`.
- **Columns are NOT NULL** unless explicitly nullable. Drizzle defaults to nullable — always add `.notNull()`.
- **UUIDv4 PKs** — all entity tables get `id UUIDv4` (`gen_random_uuid()`) and `created_at TIMESTAMPTZ DEFAULT now()`. Exception: `journal_entries` (bigserial PK) and reference data tables (`categories`, `questions` — text PK).
- **Text PKs for reference data** — `categories` and `questions` use human-readable text IDs (e.g. `"oral"`, `"cunnilingus"`). Stable across seeds, self-documenting.
- **Human-friendly language in user-facing text** — use natural terms people actually say ("eating out", "blowjob", "going down on") in `give_text`/`receive_text` and UI copy. Clinical terms (`cunnilingus`, `fellatio`) for IDs, schema, and docs only.
- **Upsert seed data** — question bank is seeded via `ON CONFLICT DO UPDATE`. Adding/renaming questions is a deploy, not a migration.
- **Postgres everywhere** — no SQLite, no dialect switching. PGlite for unit tests, real Postgres for dev/integration/prod.
- **Graceful local data migrations** — the service worker auto-updates the app without user interaction. New code can load against old localStorage data at any time. Rules:
  - Operation format is versioned (`p:1:`, `e:1:`) — new code must read all old versions, not just the current one.
  - localStorage schema changes must detect the old shape on load and migrate in place.
  - Never delete or rename a localStorage key without a migration path from the old key.
  - Pending ops are opaque strings — never change how they're stored in the queue, only how they're produced and consumed.
  - Test migrations: unit tests should verify that old-format data is correctly read by new code.

## Testing

### Principles

- **Store tests** use PGlite — test SQL logic, transactions, error returns
- **Route tests** use mocked stores — test auth guards, input validation, error mapping. No DB needed.
- **Pure function tests** — no mocks, no DB (crypto, journal, build-screens, stoken)
- Test contracts, not internals. If it's hard to test, fix the design.

### Three tiers

| Tier | Infra | What it tests |
|-|-|-|
| **store** `store/*.test.ts` | PGlite | SQL queries, transactions, data integrity |
| **route** `trpc/routes/*.test.ts` | Mocked stores | Auth, validation, error mapping, business rules |
| **pure** `lib/*.test.ts`, `stoken.test.ts` | None | Crypto, journal replay, screen building, match classification |
| **integration** `.integration.test.ts` | Postgres (testcontainers) | Full round-trips, seed data |
| **e2e** `e2e/*.spec.ts` | Playwright + Postgres | Full user flows |

Commands: `pnpm test` (unit + integration), `pnpm test:e2e` (requires `vite build` first).

### Test helpers

- `packages/server/src/test/factories.ts` — `anonCtx`, `authedCtx`, `createAndSetup`, `createGroupDirect`, `createCaller`
- `packages/server/src/test/pglite.ts` — `createTestDatabase()`, `truncateAll()`
- Route tests define `mockCtx()` locally with `vi.fn()` stubs for all stores
- `e2e/fixtures.ts` — custom Playwright fixture with dynamic `baseURL` (random port via `.e2e-port` file)
- `e2e/helpers.ts` — `createGroupAndSetup`, `answerAllQuestions`, `setCategories`, `scopedGet`, `scopedSet`

### E2E patterns

- Tests parameterized with `for (const encrypted of [false, true])` where encryption matters
- Single category (`setCategories(page, ["group"])`) for speed — uses scoped localStorage via `fnv1a` hash
- `answerAllQuestions` handles welcome screens automatically
- Sync-conflict test polls scoped `pendingOps` via `scopedGet` instead of clicking hidden UI
- Multi-tab tests use `context.newPage()` (shared localStorage) to verify scoped storage isolation

## Verification

After making changes, run:

```bash
pnpm -r typecheck && pnpm test
# For E2E: cd packages/web && pnpm exec vite build && cd ../.. && pnpm test:e2e
```

## Working with Tools

- **Research first.** Before implementing anything involving a library or integration, read the official docs. The documented approach is always better than a workaround.
- **Check versions.** Before adding a dependency, check the latest version on npm and read the setup guide. Don't assume versions from memory.
- **Review existing tools.** Before writing bespoke code, check if a maintained library covers the use case.

## Autonomy

- Adding/updating dev dependencies, editing existing files, running tests — go ahead.
- Adding a new **runtime dependency** — discuss first.
- Changing architecture, data model, or API shape — discuss first.
