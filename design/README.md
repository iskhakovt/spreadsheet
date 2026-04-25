# Spreadsheet — Design

A yes/no/maybe list for couples (and groups) to discover shared sexual interests. Each person fills out a questionnaire rating sexual activities, then the app compares answers and reveals only the overlaps — things both (or all) people are into. No means no, and no one sees what you said no to.

The name is a pun: "Have you filled out the spreadsheet?" is an impeccable text to send.

## Stack

| Layer | Choice |
|-|-|
| Language | TypeScript (full stack) |
| Runtime | Node.js (container) |
| Web framework | Hono |
| API | tRPC v11 (HTTP + WebSocket, end-to-end type safety) |
| ORM | Drizzle |
| Validation | Zod |
| Database | Postgres (prod + dev), PGlite (unit tests) |
| Frontend | React 19 + Vite 8 |
| UI | Tailwind + shadcn/ui (Base UI primitives) |
| Routing | TanStack Router v1 (file-based, type-safe) |
| Client data | TanStack Query v5 + `@trpc/tanstack-react-query` |
| Offline | Service worker (vite-plugin-pwa) + localStorage |
| Auth | Unique link per person (token in URL) |
| Package manager | pnpm |
| Linter/formatter | Biome |
| Testing | Vitest (unit/integration), Playwright (e2e + visual) |
| Logging | Pino — structured JSON (pino-pretty in dev) |
| Errors | Sentry/GlitchTip (optional, env-gated) |

## Glossary

| Term | Meaning |
|-|-|
| **Group** | A set of people who share answers with each other. Created by the first person (admin). Has no name — identified by its members' links. |
| **Person** | A member of a group. Has a name, anatomy (amab/afab), and a unique token used in their personal URL. |
| **Category** | A grouping of questions (e.g. "Oral", "Bondage", "Sensory Environment"). Opt-in per person — you pick which categories to answer. |
| **Question** | An activity to rate. Can be **mutual** (one rating, e.g. "Blindfolds") or **role-based** (give + receive ratings, e.g. "Cunnilingus"). |
| **Rating** | A person's answer to a question: yes, if-partner-wants, maybe, fantasy, no. |
| **Timing** | When you want something: now or later. Only applies to "yes" and "if-partner-wants" ratings. Configurable per group (`showTiming` toggle). When off, all answers have null timing. |
| **Comparison** | The result view — shows overlaps between group members. Only available when all members mark complete. |
| **Admin** | A person who can manage the group: add/remove members, generate invite links. The group creator is always admin. |
| **Token** | A URL-safe random string that identifies a person. The URL `/p/{token}` is the person's entry point — no login needed. |
| **Stoken** | Sync token — an opaque, HMAC-signed cursor returned by the server after each push. Clients pass it back to get only new entries. |
| **Journal** | Append-only log of operations per person. The server's source of truth for answers. |

## Sub-docs

| Doc | Contents |
|-|-|
| [schema.md](schema.md) | Database tables, entity relationships, question structure, rating scale |
| [sync.md](sync.md) | Sync protocol, journal, encryption, offline mode, conflict resolution |
| [ui.md](ui.md) | User journey, screens, routing, design system |
| [server.md](server.md) | Server patterns: stores, event buses, logging, error handling, CLI |

## Key decisions

### Auth

No usernames or passwords. Each person gets a unique link containing a token. Group creation generates an `adminToken`; the admin visits `/p/{adminToken}` and runs `setupAdmin`, which creates the admin person (with `adminToken` as its token), creates partner persons, and marks the group ready — all in one transaction. After setup, the same URL resolves via the person token.

In encrypted mode, the group key lives in the URL fragment (`#key=...`) and is cached in `sessionStorage`. The server never sees it.

### Real-time delivery

Two WebSocket subscriptions layered over two server-side event buses ([server.md](server.md#event-buses)):

- **`groups.onStatus`** delivers full status snapshots. Snapshot-based, so reconnect just re-queries current state.
- **`sync.onJournalChange`** delivers append-only journal entries using tRPC v11's `tracked()` primitive. `wsLink` stamps the latest `lastEventId` onto the pending subscription message and re-sends it on reconnect; the server's generator queries entries > cursor and replays them. Lossless by construction.

No polling fallback. Recovery relies on `wsLink` auto-reconnect + `keepAlive` ping/pong (30s ping, 5s pong) + `tracked()` resume. If the WebSocket is persistently broken the app degrades to "reload to fix".

### Client data

All server state flows through TanStack Query via `@trpc/tanstack-react-query`. Reads use `useSuspenseQuery` with a top-level `<Suspense>` boundary. Writes use `useMutation` with `onSuccess: invalidateQueries` — mutations return the invalidation promise so they stay pending until the refetch completes. WS subscriptions use `useSubscription` with `onData` callbacks that `setQueryData` into the same cache entries the HTTP queries populate.

### Client-authored state

localStorage owns client-authored state (answers, pending ops, stoken, UI prefs), scoped by an FNV-1a hash of the person token (`s{hash}:key`) so multiple persons on the same device don't collide. The TanStack cache owns server state. Clean split, no cross-contamination.

### Performance

- Question bank cached with `staleTime: Infinity` — fetched once, reused across all screens.
- Journal pre-warmed on the `allComplete` transition so `/results` renders without an HTTP round-trip on the critical path.
- Single bundle, no route-level code splits. The app is small; bundle splitting adds a round-trip on the render-critical path under contention.
- No SSR.

### Deployment

Single container, single process, single port. One Dockerfile, one image. Hono serves both the tRPC API and the Vite-built static assets. See [../deploy.md](../deploy.md).
