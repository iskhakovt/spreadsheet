# Server Architecture

```
packages/server/src/
  main.ts     ← CLI dispatcher (serve|migrate|seed|setup). Docker entrypoint.
  index.ts    ← Hono app setup (serve-only). Used directly by `tsx watch` in dev.
  events.ts   ← Three EventEmitter instances: groupEvents, journalEvents, selfJournalEvents
  logger.ts   ← Pino instance + redact paths + error serializer
  request-logger.ts ← Per-request child logger with reqId + HTTP duration histogram
  metrics.ts  ← prom-client registry, counters, gauges, histogram exports
  db/         ← schema, helpers, seed (data layer)
  store/      ← GroupStore, SyncStore, QuestionStore (business logic + DB)
  trpc/       ← routes, context, middleware (transport layer)
  test/       ← shared test helpers
```

Dependencies flow one way: `trpc/ → store/ → db/`. Routes are thin — validation, auth guards, error mapping. Stores own all DB access.

## Store pattern

Every store holds a private `#tx` function and exposes no raw `db` field, so routes and other stores can't bypass transactions:

```typescript
class GroupStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  constructor(db: Database) { this.#tx = (fn) => db.transaction(fn); }

  async setProfile(id: string, input: ...) {
    await this.#tx((tx) =>
      tx.update(persons).set(input).where(eq(persons.id, id)),
    );
  }
}
```

The `#private` ES2022 field is runtime-enforced (not just a TypeScript annotation), so the invariant survives even if someone casts away the store's declared type.

Stores return result objects with `{ error: "..." }` for expected failures (stale stoken, missing member, etc.). Routes map these to the appropriate `TRPCError` code. Unexpected failures throw.

## Event buses

`packages/server/src/events.ts` exports three `EventEmitter` instances, each keyed by a different identifier and consumed by a different subscription:

- **`groupEvents`** (key: group id, name `group:{id}`) — emitted by broadcasting mutations (`markComplete`, `unmarkComplete`, `setProfile`, `markReady`, `addPerson`, `removePerson`, `setupAdmin`). Consumed by `groups.onStatus`, which re-reads `getStatus(token)` on each event and yields the fresh snapshot to each subscriber.
- **`journalEvents`** (key: group id, name `journal:{id}`) — emitted by `sync.push` after a successful non-rejected commit, carrying the newly-inserted entries. Consumed by `sync.onJournalChange` for the gated group-wide feed driving `Comparison`.
- **`selfJournalEvents`** (key: person id, name `self-journal:{id}`) — emitted by `sync.push` on the same successful commit, carrying the same entries. Consumed by `sync.onSelfJournalChange` for the ungated per-person feed driving `useSelfJournal`. Person-keyed so a write fans out only to the writer's own subscribers (typically one or two — the editing tab plus any other device the same person has open).

`sync.push` emits to **both** journal buses on a successful commit. The two consumers are independent: a `Comparison` viewer in the same group hears about the entry via `journalEvents`; the editor's own answers cache hears about it via `selfJournalEvents`; they don't share state.

Why three buses rather than one: status broadcasts, group-wide journal appends, and per-person journal appends happen at very different rates and have very different audiences. Status is low-volume coarse events; group journal is high-volume append stream gated on completion; self journal is a near-private firehose for the writing person's own devices. A single bus would force every subscriber to filter out events that aren't theirs.

Event names are scoped per emitter (`group:{groupId}`, `journal:{groupId}`, `self-journal:{personId}`) so an emit wakes only the relevant subscribers. `setMaxListeners(0)` on all emitters avoids Node's 10-listener warning in sessions with many concurrent SSE clients.

Mutating procedures emit via the `broadcastingProcedure` / `broadcastingAdminProcedure` middleware (`packages/server/src/trpc/init.ts`) so every route that changes group state fans out consistently.

## Logging

Pino, structured JSON in prod, `pino-pretty` in dev (dev-only dependency, guarded by `NODE_ENV`).

Each HTTP request gets a child logger with a UUID `reqId`, attached to the Hono context and emitted on every log line in that request's scope. Request/response lines include method, path, status, and duration.

### Secret redaction

Two layers of defense against tokens and credentials leaking into logs:

1. **Redact list** — `logger.ts` defines `redactPaths` covering request headers (`x-person-token`, `authorization`, `cookie`) and sensitive keys (`adminToken`, `partnerTokens`, `token`, `password`). Pino's `*` wildcard is **single-level only** — `*.token` matches `{ x: { token } }` but not the root `{ token }` and not `{ a: { b: { token } } }`. The list therefore includes both the root form and the one-level-deep form for each key. Anything nested deeper is by convention not logged; `logger.test.ts` pins the exact cases this list covers.

2. **Allowlist error serializer** — pino's `stdSerializers.err` copies every enumerable property of an Error verbatim, which slips past the single-level redact list when a custom error carries nested `params` or tokens. `sanitizeError` replaces it with an allowlist that extracts only `name`, `message`, `stack`, `code`, `status` — all primitive, flat, nothing nested can escape.

Call sites still shouldn't pass tokens to the logger — the above are defense in depth.

## Error handling

Routes throw `TRPCError` with standard codes (`UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED`, `BAD_REQUEST`). The tRPC error formatter serializes them for the client; the frontend maps each code to user-facing behavior via the TanStack Query error boundary.

Unexpected exceptions surface as 5xx responses, logged at `error` level by the request logger and counted by the HTTP duration histogram (`http_request_duration_seconds{status="5xx"}`).

## CLI dispatcher

`main.ts` is the Docker entrypoint and dispatches to one of four subcommands based on `argv[2]`:

| Command | What |
|-|-|
| `serve` (default) | Start the HTTP server (`index.ts`) — handles queries, mutations, and SSE subscriptions through one fetch pipeline |
| `migrate` | Apply pending database migrations |
| `seed` | Sync question bank data — deletes categories / questions / dependencies that disappeared from `questions.yml`, then upserts current rows. Stale-removal runs in FK-safe order (deps → questions → categories), with the category delete deferred until after the question upsert so a kept question can move between categories without a transient FK violation. |
| `setup` | migrate + seed (convenience) |

Operations runs `setup` once before `serve` — see [../deploy.md](../deploy.md). Migrations are not run on server start so multi-replica deploys don't race.

`index.ts` (the serve path) is imported directly by `tsx watch` in dev, bypassing the CLI dispatcher — dev never touches migrate/seed.

## Metrics

`packages/server/src/metrics.ts` exports a single prom-client `Registry` and all metric instances. A dedicated metrics-only Hono app serves `GET /metrics` on a separate port (default `9090`, configurable via `METRICS_PORT`), so it can be firewalled off from public traffic independently of the main app.

### Infrastructure metrics

`collectDefaultMetrics()` provides event loop lag, memory, CPU, and GC stats out of the box.

- **`sse_connections_active{procedure}`** (gauge) — active SSE subscription streams, labeled by tRPC procedure path. Incremented when each subscription resolver runs; decremented when the request's `AbortSignal` fires (client disconnect, page close, server shutdown). Driven by the `trackSseConnection` helper in `metrics.ts`, called once per resolver.
- **`http_request_duration_seconds`** (histogram) — recorded by `request-logger.ts` for every request except `/health` and `/metrics`; path label uses `sanitizePath` to normalise `/p/:token/*` → `/p/[REDACTED]/*`

### Product funnel counters

| Metric | Incremented in |
|-|-|
| `groups_created_total` | `groups.create` |
| `groups_setup_completed_total` | `groups.setupAdmin` (success only) |
| `sync_push_total` | `sync.push` |
| `mark_complete_total` | `sync.markComplete` |
| `results_viewed_total` | `analytics.track` tRPC mutation, called from the results screen on mount |

## Runtime config injection

The frontend reads runtime values from `window.__ENV`, which is injected into the served `index.html` at serve time:

```ts
const envScript = `<script>window.__ENV=${JSON.stringify(runtimeEnv)}</script>`;
indexHtml = readFileSync(...).replace("</head>", `${envScript}</head>`);
```

This keeps the built static bundle free of environment-specific values and lets the same image target multiple environments without rebuilding.

## Graceful shutdown

On `SIGTERM`, the server fires `close()` on both the metrics listener and the main HTTP listener (no awaited ordering — they drain in parallel) and then closes the DB pool once the main HTTP `close` callback fires. Open SSE streams close naturally as the server socket drains; clients reconnect to the new instance with their last `tracked()` cursor in `Last-Event-ID`, and the procedure's backfill replays anything they missed during the changeover. Container roll = transient interruption, no data loss.
