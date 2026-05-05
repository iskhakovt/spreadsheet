# Spreadsheet

A yes/no/maybe list for couples and groups to discover shared sexual interests. See [design/](design/) for full design.

## Stack

- **Language:** TypeScript (full stack, shared types via tRPC)
- **Backend:** Node.js, Hono, tRPC v11 (HTTP, queries/mutations + SSE subscriptions via `httpSubscriptionLink`), Drizzle, Zod
- **Frontend:** React 19, Vite 8, Tailwind, shadcn/ui (Base UI primitives), TanStack Router v1, TanStack Query v5 + `@trpc/tanstack-react-query`
- **Database:** Postgres (prod + dev), PGlite (unit tests)
- **Offline:** vite-plugin-pwa, localStorage
- **Testing:** Vitest, PGlite, testcontainers, Playwright
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
- **Routing** — TanStack Router v1 file-based routing. Route tree auto-generated to `src/routeTree.gen.ts` (excluded from linting). Structure: `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/p/$token/route.tsx` (layout) + 10 child screen routes.
  - **Universal guard**: `resolveRoute()` computes the correct screen from status. Lives in the `/p/$token` layout component (not `beforeLoad`) so real-time SSE status changes (e.g. everyone completes → `/results`) redirect before paint via `useLayoutEffect` + `navigate`. Free routes (`/group`, `/summary`, `/review`, `/questions`) are exempt — users reach them intentionally.
  - **`/questions` is a free route** so marked-complete users can edit via the "Edit my answers" / "Change my answers" buttons on `/waiting` and `/results` without unmarking their completion state. `useMarkComplete` navigates to `/p/$token/waiting` explicitly after the mutation (the guard no longer auto-routes there).
  - **`PersonAppContext`** — the `/p/$token` layout route provides live status, questions data, `startKey`, and shared mutations to all child routes via React context. Use `usePersonApp()` in any child screen.
  - **Mutations self-invalidate** via `useMutation({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }) })`. Always return the invalidation promise so the mutation stays pending until the refetch completes — this is what replaces the old `await refreshStatus()` threading.
- **Data fetching** — TanStack Query v5 via `@trpc/tanstack-react-query` (`useTRPC()` returns a typed proxy).
  - Reads: `useSuspenseQuery(trpc.x.queryOptions(...))`. Top-level `<Suspense>` boundary in `src/routes/__root.tsx` handles loading.
  - Writes: `useMutation(trpc.x.mutationOptions({ onSuccess: invalidate }))`. Use `mutate()` for fire-and-forget with local callbacks; `mutateAsync()` when you need to await the result.
  - Live updates: `useSubscription(trpc.x.subscriptionOptions(...))` with `setQueryData` in `onData` to feed updates into the same cache entry that an HTTP query populated.
  - **Never call `.query()` / `.mutate()` on a singleton** — there is no `trpc` singleton, only the `useTRPC()` proxy inside hooks/components. If you need imperative access from a non-hook context, use `useTRPCClient()`.
- **Real-time delivery** — three independent event buses on the server, three SSE subscriptions on the client (via `httpSubscriptionLink`, mounted on the same `/api/trpc` endpoint as queries/mutations):
  - `groupEvents` (+ `groups.onStatus` subscription) — status snapshots on every broadcasting mutation (setProfile, markReady, addPerson, removePerson, markComplete, unmarkComplete). No `tracked()` because status is snapshot-based — a reconnect just yields the current state.
  - `journalEvents` (+ `sync.onJournalChange` subscription) — group-wide append-only journal events. Gated by the all-complete precondition (cross-member privacy). Used by `Comparison` on `/results`. Uses tRPC v11 `tracked()` for resume-safe reconnect; the bigserial entry id flows through the SSE event id, the browser sends it back as `Last-Event-ID` on reconnect, and tRPC surfaces it as `input.lastEventId` for backfill.
  - `selfJournalEvents` (+ `sync.onSelfJournalChange` subscription) — per-person append-only journal events for the caller's own entries. Ungated. Used by `useSelfJournal` to keep the answers cache live across devices: a write on device A propagates to device B (same person token) within the SSE round-trip. Same `tracked()` resume semantics.
  - `sync.push` emits to **both** `journalEvents` and `selfJournalEvents` on every successful commit. The two buses are independent and addressed differently (group id vs person id), so a subscriber sees only the deliveries it asked for.
  - **Subscribe-before-query invariant** in both journal subscriptions: the generator attaches the `on(emitter, ...)` iterable BEFORE querying the backfill. Events emitted during the query window are buffered in the iterable, not lost. Covered by integration tests.
- **Auth on subscriptions** — EventSource can't set custom headers, so the `sessionKey` (fnv1a hash of token, non-secret) travels via `connectionParams` (URL query) instead of the `X-Session-Key` header used by queries/mutations. The actual token is in the httpOnly cookie, which EventSource sends automatically same-origin. `createContext` reads either source and resolves `s_${sessionKey}` to the token uniformly.
- **No polling fallback** — the app relies entirely on `httpSubscriptionLink` auto-reconnect + `tracked()` resume via `Last-Event-ID` + SSE pings (server `sse.ping.intervalMs: 30_000`, client `reconnectAfterInactivityMs: 35_000` — set in `trpc/init.ts`). If the stream is persistently broken the app degrades (reload fixes).
- **Hono compress + SSE** — Hono's `compress()` middleware (since [PR #3833](https://github.com/honojs/hono/pull/3833), Jan 2025) auto-skips `text/event-stream` responses, so subscriptions stream live through the `app.use("/api/*", compress())` middleware without per-route opt-out. Don't reintroduce a buffering middleware on the API path.
- **Auto-sync** — 3s debounce after last answer, indicator after 5s. Owned by `useSyncQueue(totalQuestions)` in `lib/use-sync-queue.ts` — wraps `useMutation(trpc.sync.push)` with debounce + conflict-merge retry.
- **Question flow** — `Screen` discriminated union (`welcome` | `question`). Welcome interstitials at category boundaries. All categories on by default, managed from Summary screen. Visibility per question is computed by `lib/visibility.ts`'s `visibleSides()` — combines anatomy targeting + tier filter + dependency gating (transitive, per-side for give/receive). A welcome screen is skipped when its category has zero visible questions for the user.
- **Dependency gating** — questions can declare `requires: [parent-id, ...]` in `questions.yml`. AND-only multi-parent semantics: a child is hidden if any required parent is answered "no" (transitively). Per-side mapping when both sides are give/receive. Stored in the `question_dependencies` junction table; seed validation rejects cycles, unknown refs, child-tier-below-parent, and child-before-parent in array order. Single source of truth in the seed; the "is this a gate?" boolean is derived (`childrenOf.size >= 3`), not stored.
- **Session** — Zustand vanilla store (`lib/session.ts`) holds auth token + localStorage scope. Per-tab (module-scoped), not localStorage. `setSession(token)` called synchronously on every render. Orthogonal to the TanStack cache (which is also per-tab).
- **Self journal as source of truth for answers** — the per-person journal on the server is the source of truth for the answers map. The `useSelfJournal` hook (`lib/self-journal.ts`) materializes it into the TanStack cache slot `["sync", "self-journal"]` via `sync.selfJournal` (delta fetch from a numeric cursor) plus the `sync.onSelfJournalChange` subscription (live deltas). On every play-page mount the layout suspense-fetches the delta since the persisted cursor, replays + decrypts via `replayJournal`, and overlays the local `pendingOps` outbox via `mergeAfterRejection` so unsent local writes win for keys with pending ops. Cross-device hydration is automatic — opening the link on a fresh device replays the journal on mount; opening on a second device sees writes from the first within the SSE round-trip.
- **Storage** — localStorage scoped by FNV-1a hash of token (`s{hash}:key`). Multiple persons coexist without cross-contamination. Shared `fnv1a` hash in `@spreadsheet/shared`. The contract:
  - **localStorage owns** the outbox and UI prefs: `pendingOps` (write-side authoritative), `stoken` (push cursor), UI prefs (`hasSeenIntro`, `selectedTier`, `selectedCategories`, `currentScreen`).
  - **TanStack cache owns** server state: `groups.status`, `questions.list`, `sync.journal` (group-wide, gated), and the new `["sync", "self-journal"]` slot for the caller's own answers.
  - **Write-through persistence**: `["sync", "self-journal"]` writes the materialized `answers` map and `selfJournalCursor` back to localStorage on every update so first paint on subsequent reloads renders from the persisted snapshot while the delta fetch runs in parallel. The localStorage `answers` key is a derived cache, not the model — never write to it directly outside the self-journal hook.

### Server Structure

```
packages/server/src/
  main.ts     ← CLI dispatcher (serve|migrate|seed|setup). Built as the Docker entrypoint.
  index.ts    ← Hono app setup (serve-only). Used directly by `tsx watch` in dev.
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

- **Inclusive language (mandatory)** — use `allowlist`/`denylist`, not `whitelist`/`blacklist`; `main`, not `master`; `primary`/`replica`, not `master`/`slave`. Applies to code, comments, docs, commit messages, and PR descriptions. If you encounter legacy terms while editing nearby code, fix them in the same change.
- **Readonly props** — wrap component props in `Readonly<>` at the function signature: `function Foo({ x }: Readonly<FooProps>)` for named types, `function Bar({ x }: Readonly<{ x: string }>)` for inline types. Follows the Next.js convention. No lint rule enforces this — it's a manual convention.
- **Idiomatic TypeScript** — use interfaces for object shapes, generics for reusable components.
- **`function` declarations for named exports** — `function foo()` not `const foo = () => {}`. Arrow functions for callbacks and inline lambdas only.
- **Naming** — lowercase-hyphenated filenames (`category-picker.tsx`), `.test.ts` suffix for tests. PascalCase for types/interfaces/components, camelCase for functions/variables.
- **Imports** — ESM with `.js` extensions. Named imports over default exports. No circular imports.
- **`#private` fields** — use ES2022 `#private` (runtime-enforced) over TypeScript `private` when writing classes.
- **Error handling** — throw `TRPCError` in procedures. Frontend catches via tRPC's error handling. No silent swallows.
- **No mutable state across boundaries** — return defensive copies, use `Readonly<T>` where practical.
- **Use the stack** — Zod for validation, Drizzle for queries, tRPC for API contracts. Don't reinvent.
- **Domain types go in `@spreadsheet/shared`, not `RouterOutputs`** — when a procedure returns a shape the UI names or narrows (e.g. `Person`, `GroupStatus`), define it as a Zod schema in `@spreadsheet/shared/types.ts` and have the procedure `.output(schema)` for runtime validation. The client imports named types directly (`import type { Person } from "@spreadsheet/shared"`) and can use `Pick<Person, "isCompleted">` freely. Reach for `inferRouterOutputs<AppRouter>` / `NonNullable<RouterOutputs[...][...]>` chains only for ad-hoc spots where a shape isn't worth naming.
- **Inject dependencies** — pass db/services as parameters, don't hard-import. Keeps tests clean.
- **Conditional classNames** — always use the `cn()` helper (`lib/cn.ts`) for conditional classes: `cn("base", condition && "extra")`. Never use template literals or string concatenation for conditional className assembly.
- **Icons** — use `lucide-react` for all icons. Never write inline `<svg>` icons by hand. Import the named icon component and set `size` and `strokeWidth` props: `<Pencil size={14} strokeWidth={1.5} />`. Browse available icons at https://lucide.dev/icons/.
- **Prefer the library API over raw browser primitives** — when TanStack Router, TanStack Query, or another library in the stack offers an API for what you need, use it instead of touching `window.history`, `document.cookie`, `fetch`, etc. directly. Examples: `navigate({ replace: true, state })` over `window.history.replaceState`; `navigate({ to })` over `window.location.assign` (unless a hard reload is required, e.g. server-set cookies); `useTRPC()` query/mutation hooks over raw `fetch`. Reach for the primitive only when the library genuinely doesn't cover the case (e.g. PRG-style auth bootstrap that must hit the server). Going through the library keeps types, store updates, and dev-tools integrations in sync.

## Commits

**Conventional Commits** — all messages follow `type(scope): description`. Types follow `@commitlint/config-conventional` defaults (`feat`, `fix`, `perf`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `style`, `revert`). Scope: `server`, `web`, `shared`, `db`. Semantic-release uses these to determine version bumps (`feat` → minor, `fix` → patch, `BREAKING CHANGE` → major). Non-conventional messages won't trigger a release. PR titles are validated by the `pr-title` CI job (commitlint). To customize the accepted types, edit `.releaserc.json` — `commitlint.config.js` derives its `type-enum` from there.

**Type semantics** — use the type that triggers the correct release, not the one that "sort of" matches:

| Type | Meaning | Triggers release? |
|-|-|-|
| `feat` | New user-visible feature or capability, including UI redesigns / visual refreshes | ✅ minor |
| `fix` | User-visible bug fix | ✅ patch |
| `perf` | Performance improvement users may feel | ✅ patch |
| `refactor` | Internal restructuring, no user-visible change | ❌ |
| `style` | **Code** formatting only (whitespace, semicolons, lint fixes) — **not** visual/UX changes | ❌ |
| `test` | Test-only changes | ❌ |
| `docs` | Documentation only | ❌ |
| `chore` / `ci` / `build` | Tooling / infra / deps | ❌ |

**Key gotcha**: `style` in Angular's conventional-commits vocabulary means **code formatting**, not visual design. A UI polish that users can see is `feat`, because it ships changes to production and users experience them. Using `style` for a visual refresh silently suppresses the release — users won't see the new design until some unrelated `feat`/`fix` lands later.

**Bringing `main` forward into a feature branch — use `git merge`, not `git rebase`.** Rebase rewrites published commits, which forces a push, breaks the PR review's commit-level discussion threading, and invalidates any local clones. Merge is reversible and preserves the branch's history. The squash-merge at PR-close collapses everything anyway, so the linear-history argument for rebase doesn't apply here.

## Architecture Rules

- **All DB access goes through stores.** Routes never use `ctx.db` directly. Stores enforce transactions via `#tx`.
- **Columns are NOT NULL** unless explicitly nullable. Drizzle defaults to nullable — always add `.notNull()`.
- **UUIDv4 PKs** — all entity tables get `id UUIDv4` (`gen_random_uuid()`) and `created_at TIMESTAMPTZ DEFAULT now()`. Exception: `journal_entries` (bigserial PK) and reference data tables (`categories`, `questions` — text PK).
- **Text PKs for reference data** — `categories` and `questions` use human-readable text IDs (e.g. `"oral"`, `"cunnilingus"`). Stable across seeds, self-documenting.
- **Human-friendly language in user-facing text** — use natural terms people actually say ("eating out", "blowjob", "going down on") in `give_text`/`receive_text` and UI copy. Clinical terms (`cunnilingus`, `fellatio`) for IDs, schema, and docs only.
- **Sync seed data** — question bank seed deletes categories / questions / dependencies that disappeared from `questions.yml`, then upserts current rows via `ON CONFLICT DO UPDATE`. FK-safe order: deps → questions → upsert categories → upsert questions → delete stale categories. Adding, renaming, or removing questions is a deploy, not a migration. Existing journal entries that reference removed IDs become orphaned text — harmless, won't render anywhere because `list()` no longer returns those questions.
- **Postgres everywhere** — no SQLite, no dialect switching. PGlite for unit tests, real Postgres for dev/integration/prod.
- **Don't log secrets.** Tokens (`adminToken`, `partnerTokens`, person `token`), passwords, and auth headers (`x-person-token`, `authorization`, `cookie`) must never be passed to the logger. Log only the fields you need; sanitize at the call site. There's a redact safety net in `packages/server/src/logger.ts` (covered by `logger.test.ts`), but pino's `*` wildcard is single-level only — anything nested deeper than one level leaks. Treat the redact list as belt-and-suspenders, not primary defense.
- **Graceful local data migrations** — the service worker auto-updates the app without user interaction. New code can load against old localStorage data at any time. Rules:
  - Operation format is versioned (`p:1:`, `e:1:`) — new code must read all old versions, not just the current one.
  - localStorage schema changes must detect the old shape on load and migrate in place.
  - Never delete or rename a localStorage key without a migration path from the old key. Absent keys are fine — the self-journal cursor (`selfJournalCursor`) being absent on first new-code boot triggers a full replay, which is the bootstrap path by design.
  - Pending ops are opaque strings — never change how they're stored in the queue, only how they're produced and consumed.
  - Test migrations: unit tests should verify that old-format data is correctly read by new code.
- **Self-state goes through the journal, not new localStorage keys** — any new client-authored field that needs cross-device persistence must travel as a journal operation. localStorage is reserved for: the outbox (`pendingOps`), the push cursor (`stoken`), UI prefs (`hasSeenIntro`, `selectedTier`, `selectedCategories`, `currentScreen`), and write-through snapshots of the self-journal cache (`answers`, `selfJournalCursor`) that exist purely for first-paint hydration on the next reload. Adding a new device-local-only field that doesn't fall in those categories is a smell: it will diverge across devices the moment the user opens the link somewhere new.

## Testing

### Principles

- **Store tests** use PGlite — test SQL logic, transactions, error returns
- **Route tests** use mocked stores — test auth guards, input validation, error mapping. No DB needed.
- **Pure function tests** — no mocks, no DB (crypto, journal, build-screens, stoken)
- Test contracts, not internals. If it's hard to test, fix the design.

### Test tiers

| Tier | Infra | What it tests |
|-|-|-|
| **store** `store/*.test.ts` | PGlite | SQL queries, transactions, data integrity |
| **route** `trpc/routes/*.test.ts` | Mocked stores | Auth, validation, error mapping, business rules |
| **pure** `lib/*.test.ts`, `stoken.test.ts` | None | Crypto, journal replay, screen building, match classification |
| **integration** `.integration.test.ts` | Postgres (testcontainers) | Full round-trips, seed data |
| **e2e** `e2e/*.spec.ts` | Playwright + Docker image (CI) or tsx (local) | Full user flows against the shipped artifact |
| **visual** `e2e/visual/*.spec.ts` | Playwright (desktop 1280×800 + mobile 390×664, 2x DPR) | Screenshot baselines for every screen and conditional rendering path |

Commands: `pnpm test` (unit + integration), `pnpm test:e2e` (local: builds web + runs tsx; CI: runs against Docker image via `E2E_IMAGE`), `pnpm test:visual` (screenshot comparison). Visual baselines stored via Git LFS. **Visual tests run inside the official Playwright Docker image** (`mcr.microsoft.com/playwright:v1.59.1-noble`) for deterministic rendering across dev machines and CI. Always use `pnpm test:visual:docker` locally and `pnpm test:visual:docker:update` to regenerate baselines — never use the bare `pnpm test:visual:update` or screenshots will differ on CI.

### Test helpers

- `packages/server/src/test/factories.ts` — `anonCtx`, `authedCtx`, `createAndSetup`, `createGroupDirect`, `createCaller`
- `packages/server/src/test/pglite.ts` — `createTestDatabase()`, `truncateAll()`
- Route tests define `mockCtx()` locally with `vi.fn()` stubs for all stores
- **Subscription integration tests** use `createCaller(ctx, { signal })` with a real `AbortController`, and an `openSubscription(factory)` helper (see `e2e/groups.subscription.integration.test.ts` and `sync.journal-subscription.integration.test.ts`) that wraps the async iterable with timeout + cancel. For `tracked()` subscriptions the caller receives the raw tuple `[id, data, symbol]` — destructure via `unwrap()` helpers; the HTTP/WS adapter unwraps to `{id, data}` on the wire but `createCaller` passes the tuple through.
- Integration tests have `fileParallelism: false` in `vitest.config.ts` because they share a single Postgres container — running multiple `.integration.test.ts` files in parallel deadlocks on TRUNCATE.
- `e2e/fixtures.ts` — custom Playwright fixture with dynamic `baseURL` (random port via `.e2e-port` file)
- `e2e/helpers.ts` — `createGroupAndSetup`, `answerAllQuestions`, `answerQuestionsCycling`, `personBase`, `scopedGet`, `scopedSet`

### E2E patterns

- Tests parameterized with `for (const encrypted of [false, true])` where encryption matters
- Single category via `narrowToCategory(page, "Group & External")` — exercises the real Summary UI
- `answerAllQuestions` handles welcome screens automatically; `answerQuestionsCycling` rotates through all 5 ratings
- Sync-conflict test polls scoped `pendingOps` via `scopedGet` instead of clicking hidden UI
- Multi-tab tests use `context.newPage()` (shared localStorage) to verify scoped storage isolation

## Verification

After making changes, run:

```bash
pnpm -r typecheck && pnpm test
# For E2E (local — builds web + runs tsx):
pnpm test:e2e
# For E2E against Docker image:
docker build -t spreadsheet:ci . && E2E_IMAGE=spreadsheet:ci pnpm test:e2e
# Visual regression (must use Docker for deterministic rendering):
pnpm build && pnpm test:visual:docker
# Update visual baselines:
pnpm build && pnpm test:visual:docker:update
```

## Working with Tools

- **Research first.** Before implementing anything involving a library or integration, read the official docs. The documented approach is always better than a workaround.
- **Check versions.** Before adding a dependency, check the latest version on npm and read the setup guide. Don't assume versions from memory.
- **Review existing tools.** Before writing bespoke code, check if a maintained library covers the use case.

## Autonomy

- Adding/updating dev dependencies, editing existing files, running tests — go ahead.
- Adding a new **runtime dependency** — discuss first.
- Changing architecture, data model, or API shape — discuss first.
