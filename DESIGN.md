# Spreadsheet — Design

A yes/no/maybe list for couples (and groups) to discover shared sexual interests. Each person fills out a questionnaire rating sexual activities, then the app compares answers and reveals only the overlaps — things both (or all) people are into. No means no, and no one sees what you said no to.

The name is a pun: "Have you filled out the spreadsheet?" is an impeccable text to send.

## Stack

| Layer | Choice |
|-|-|
| Language | TypeScript (full stack) |
| Runtime | Node.js (container) |
| Web framework | Hono |
| API | tRPC (end-to-end type safety) |
| ORM | Drizzle |
| Validation | Zod (used by tRPC for input validation) |
| Database | Postgres (prod + dev), PGlite (unit tests) |
| Frontend | React + Vite 8 |
| UI | Tailwind + shadcn/ui (Base UI primitives) |
| Client data | TanStack Query v5 + `@trpc/tanstack-react-query` |
| Offline | Service worker (vite-plugin-pwa) + localStorage + Background Sync |
| Auth | Unique link per person (token in URL) |
| Dev | Testcontainers (Postgres), pnpm scripts |
| Package manager | pnpm |
| Linter/formatter | Biome |
| Testing | Vitest |
| Logging | Pino — structured JSON (pino-pretty in dev) |

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
| **Stoken** | Sync token — an opaque cursor returned by the server after each sync. Client passes it back to get only new entries. |
| **Journal** | Append-only log of operations per person. The server's source of truth for answers. |

## Design Docs

| Doc | Contents |
|-|-|
| [schema.md](design/schema.md) | Database tables, entity relationships, question structure, rating scale |
| [sync.md](design/sync.md) | Sync protocol, journal, encryption, offline mode, conflict resolution |
| [ui.md](design/ui.md) | User journey, screens, comparison view, category picker |

## Auth & Access

- No usernames or passwords. Each person gets a unique link containing a token.
- The link identifies the person and their group. No login screen.
- Group creation generates an `adminToken`. No person exists yet.
- The admin visits `/p/{adminToken}`, enters their name + partner names via the combined setup screen (`setupAdmin`).
- `setupAdmin` creates the admin person (reusing `adminToken` as their person token), creates partner persons, and marks the group ready — all in one transaction.
- After setup, the same URL resolves via the person token. No redirect needed.
- In encrypted mode, the group encryption key is in the URL fragment (`#key=...`) — never sent to the server. Cached in `sessionStorage` to survive page reloads.

## Performance

- **Question bank cached** in TanStack Query with `staleTime: Infinity` — fetched once per session, reused across PersonApp / Question / Comparison
- **Journal pre-warmed** on the `allComplete` transition so `/results` renders without waiting for the HTTP fetch on the critical path
- No SSR — app is small, loads in <100ms
- Single bundle (~140KB gzipped main chunk); no dynamic code splits — the `/results` Comparison view was previously lazy-loaded but is now inlined to eliminate one HTTP round-trip from the render-critical path under contention

## Real-time delivery

The `/results` screen needs to show edits that happen after a partner marks complete (user clicks "Change my answers", edits a question, their partner's view should reflect the change live). We implement this with tRPC v11's `tracked()` primitive for lossless reconnect recovery:

- **Two server event buses**: `groupEvents` (status broadcasts from all mutating procedures) and `journalEvents` (append-only journal events from `sync.push`). Separated by concern so neither stream processes events the other generated.
- **Two WS subscriptions**: `groups.onStatus` yields full status snapshots (no `tracked()` — snapshot replace semantics, reconnect just yields current state) and `sync.onJournalChange` yields journal entries via `tracked(id, data)` for resume-safe incremental delivery.
- **Subscribe-before-query invariant**: the subscription resolver attaches the `on(journalEvents, ...)` iterable BEFORE querying the backfill, so any event emitted during the query window is buffered in the iterable and delivered after the backfill without loss.
- **Reconnect recovery**: `wsLink` automatically stamps the latest `lastEventId` onto the pending subscription message and re-sends it on reconnect. The server's generator queries entries > cursor and replays missed events. "Lost event → stale results forever" is structurally prevented by the protocol.
- **Client-side state** — all server state flows through TanStack Query v5 via `@trpc/tanstack-react-query`. Reads use `useSuspenseQuery` (top-level `<Suspense>` handles loading), writes use `useMutation` with `onSuccess: () => invalidateQueries(...)` to self-invalidate. WS subscriptions use `useSubscription` with `onData` callbacks that feed updates into the query cache via `setQueryData`, so HTTP-fetched and WS-pushed data share a single cache entry.
- **No polling fallback** — the previous `groups.status` polling has been removed. Recovery relies on `wsLink` auto-reconnect + `keepAlive` ping/pong (30s ping, 5s pong) + `tracked()` resume. If WS is persistently broken, the app degrades to "reload to fix".

## Deployment

- **Single container** — one Dockerfile, one image, one process, one port
- Hono serves both the tRPC API and Vite-built static frontend assets
- Container runs `node dist/index.js` — no separate web server (nginx, caddy) needed
