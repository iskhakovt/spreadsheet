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
| Offline | Service worker (vite-plugin-pwa) + localStorage + Background Sync |
| Auth | Unique link per person (token in URL) |
| Dev | Testcontainers (Postgres), pnpm scripts |
| Package manager | pnpm |
| Linter/formatter | Biome |
| Testing | Vitest |
| Logging | Hono built-in (v1), Pino available |

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

- Prefetch questions immediately on auth (ready before UI needs them)
- Lazy-load comparison view (dynamic import, loaded only when needed)
- No SSR — app is small, loads in <100ms
- Single code split: main app + comparison chunk

## Deployment

- **Single container** — one Dockerfile, one image, one process, one port
- Hono serves both the tRPC API and Vite-built static frontend assets
- Container runs `node dist/index.js` — no separate web server (nginx, caddy) needed
