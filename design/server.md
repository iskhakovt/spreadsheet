# Server Architecture

```
packages/server/src/
  main.ts     ← CLI dispatcher (serve|migrate|seed|setup). Docker entrypoint.
  index.ts    ← Hono app setup (serve-only). Used directly by `tsx watch` in dev.
  events.ts   ← Two EventEmitter instances: groupEvents, journalEvents
  logger.ts   ← Pino instance + redact paths + error serializer
  request-logger.ts ← Per-request child logger with reqId
  sentry.ts   ← Optional Sentry/GlitchTip init (env-gated)
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

`packages/server/src/events.ts` exports two `EventEmitter` instances, keyed by group id:

- **`groupEvents`** — emitted by broadcasting mutations (`markComplete`, `unmarkComplete`, `setProfile`, `markReady`, `addPerson`, `removePerson`, `setupAdmin`). Consumed by the `groups.onStatus` subscription, which re-reads `getStatus(token)` on each event and yields the fresh snapshot to each subscriber.
- **`journalEvents`** — emitted by `sync.push` after a successful non-rejected commit, carrying the newly-inserted entries. Consumed by `sync.onJournalChange`, which yields them as `tracked(lastId, { entries })` for resume-safe delivery.

Why two buses rather than one: status broadcasts and journal appends happen at very different rates (low-volume coarse events vs. high-volume append stream) and are consumed by different subscriptions. A single bus would force every subscriber to filter out roughly half the events it receives.

Event names are scoped per group (`group:{id}`, `journal:{id}`) so broadcasting one group's change wakes only that group's subscribers. `setMaxListeners(0)` on both emitters avoids Node's 10-listener warning in sessions with many concurrent WS clients.

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

Unexpected exceptions propagate to Sentry (when configured) with the sanitized error serializer applied.

## CLI dispatcher

`main.ts` is the Docker entrypoint and dispatches to one of four subcommands based on `argv[2]`:

| Command | What |
|-|-|
| `serve` (default) | Start the HTTP + WS server (`index.ts`) |
| `migrate` | Apply pending database migrations |
| `seed` | Upsert question bank data |
| `setup` | migrate + seed (convenience) |

Operations runs `setup` once before `serve` — see [../deploy.md](../deploy.md). Migrations are not run on server start so multi-replica deploys don't race.

`index.ts` (the serve path) is imported directly by `tsx watch` in dev, bypassing the CLI dispatcher — dev never touches migrate/seed.

## Runtime config injection

The frontend reads optional runtime values (e.g. `SENTRY_DSN`) from `window.__ENV`, which is injected into the served `index.html` at serve time:

```ts
const envScript = `<script>window.__ENV=${JSON.stringify(runtimeEnv)}</script>`;
indexHtml = readFileSync(...).replace("</head>", `${envScript}</head>`);
```

This keeps the built static bundle free of environment-specific values and lets the same image target multiple environments. `SENTRY_DSN_FRONTEND` overrides `SENTRY_DSN` for the browser bundle, so client and server can report to different projects if desired.

## Graceful shutdown

On `SIGTERM`, the server broadcasts a `reconnectNotification` over the WebSocket (tRPC `wsLink` handles this by reconnecting after a short delay to a replacement instance), closes the WS server, and then closes the HTTP server. Containers rolling during a deploy therefore don't drop live subscriptions.
