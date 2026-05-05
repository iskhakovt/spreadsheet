# Sync Protocol

Inspired by [Etebase](https://docs.etebase.com) (append-only encrypted journal with sync tokens) and [Linear's sync engine](https://github.com/wzhudev/reverse-linear-sync-engine) (server-assigned monotonic sequences, reject stale pushes).

## Overview

The server stores an append-only journal of operations per person. Each operation sets a single answer (key = `questionId:role`). The server never reads the operation payload — it's opaque (plaintext JSON or encrypted blob, depending on group mode).

Current answer state is derived by replaying journal entries: last operation for each key wins.

The journal is the source of truth for answers. Clients hold a TanStack-Query-backed cache of the materialized answer map for the authed person, hydrated from the server on every play-page mount and kept live via SSE subscription (`httpSubscriptionLink`). localStorage is a write-through persister for instant first paint on subsequent reloads, plus the outbox of operations that haven't reached the server yet. There is no "device-local answers" model — the journal is canonical and any device with the person's token + group key reaches the same state.

## Data Model

```
journal_entries
  id            bigserial PK    -- server-assigned, monotonic, internal only
  person_id     UUID FK          -- who
  operation     text             -- opaque payload
  created_at    timestamptz      -- server receipt time
```

The `id` is used by two distinct cursors with different threat models:

- **Push cursor (`stoken`)** — used by `sync.push` for optimistic-concurrency-control. Must be tamper-proof because forging a stoken would let a client bypass the conflict-detection round-trip and insert out-of-sequence entries into someone's journal. Signed + opaque.
- **Read cursor (raw `id`)** — used by every read path: `sync.journal` and `sync.onJournalChange` for the group-wide gated feed; `sync.selfJournal` and `sync.onSelfJournalChange` for the per-person ungated feed (`sinceId` on the query, `lastEventId` on the subscription). No forgery risk: every read path is gated by `authedProcedure`, scoping the cursor to entries the caller is already authorised to read. The cursor is just "where did I last read to?", and a numeric id is what tRPC v11's `tracked()` consumes natively, so no translation layer.

## Stoken Format

The stoken is an HMAC-signed, versioned, base64url-encoded cursor used by the push path:

```
stoken = base64url("v1:" + id + ":" + hmac_sha256("v1:" + id, serverSecret))
```

Example: internal id `49` → stoken `djE6NDk6YTNmOGIy...`

| Property | How |
|-|-|
| Opaque | Client can't interpret the cursor |
| Tamper-proof | HMAC prevents forging a different id |
| Versioned | `v1:` prefix allows changing format later |
| Non-enumerable | Can't guess valid stokens for other ids |

Server decodes and verifies the HMAC before using the id in queries. Invalid or forged stokens are rejected.

`null` stoken on first sync = "give me everything."

The read path is separately keyed by the raw numeric `id` as a cursor (`sinceId` on `sync.journal`, `lastEventId` on the subscription). See the "Reading the journal" section below for the details.

## Operation Payload

Inside the `operation` field (after decryption in encrypted mode, or directly in plaintext mode):

```json
{ "key": "cunnilingus:give", "data": { "rating": "yes", "note": null } }
```

Legacy entries from before the now/later feature was removed may still carry a `timing` field; the `Answer` Zod schema strips unknown keys on read.

To clear an answer (un-answer / skip), set `data` to `null`:

```json
{ "key": "cunnilingus:give", "data": null }
```

During replay, `null` removes the key from the answer map — the question returns to "unanswered."

The server stores all operations as-is. It never parses, validates, or inspects the payload.

## Encryption

### Algorithm

**AES-256-GCM** via the Web Crypto API. Native in all browsers and Node.js — zero dependencies.

| Parameter | Value |
|-|-|
| Algorithm | AES-GCM |
| Key size | 256 bits |
| IV (nonce) | 12 bytes (96 bits), random per operation |
| Authentication | Built-in (GCM provides authenticated encryption) |
| Storage format | `base64url(iv ∥ ciphertext)` — IV prepended to ciphertext, single string |

### IV safety

**A random 12-byte IV must be generated for every encryption operation.** Never reuse an IV with the same key — reuse breaks GCM's confidentiality and authentication guarantees catastrophically (leaks plaintext XOR and auth key).

At our scale (~150 operations per person per session), random IV collision probability is negligible (~2^-48 after 2^24 operations with a 96-bit IV).

The IV is not secret — it's stored alongside the ciphertext (prepended). The server sees the IV but can't use it without the key.

The random IV also acts as a salt — encrypting the same value (e.g. `"amab"`) twice with different IVs produces completely different ciphertext. No pattern leakage from repeated values. This is inherent to GCM mode, no extra salting step needed.

### Key lifecycle

| Step | How |
|-|-|
| Generate | `crypto.subtle.generateKey("AES-GCM", 256, true, ["encrypt", "decrypt"])` |
| Export for URL | `crypto.subtle.exportKey("raw", key)` → base64url encode |
| Import from URL | `crypto.subtle.importKey("raw", decoded, "AES-GCM", false, ["encrypt", "decrypt"])` |
| Encrypt | `crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)` |
| Decrypt | `crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)` |

The key is generated once at group creation, exported to the URL fragment, and never sent to the server.

### Operation format

Every operation string is prefixed with a versioned mode tag:

| Prefix | Meaning | Rest of string |
|-|-|-|
| `p:1:` | Plaintext, format v1 | JSON payload |
| `e:1:` | Encrypted, format v1 (AES-256-GCM) | `base64url(iv ∥ ciphertext)` |

Examples:

```
p:1:{"key":"oral-give:give","data":{"rating":"yes","note":null}}
e:1:dGhpcyBpcyBlbmNyeXB0ZWQ...
```

The client parses by locating the first two colons — the payload after the second colon is preserved verbatim (it may itself contain `:`). Old format versions remain supported — a `p:1:` entry still works after `p:2:` is introduced.

The server stores and returns the full prefixed string as-is. It may optionally validate that the prefix matches the group's `encrypted` flag.

| Mode | `group.encrypted` | Prefix | Key management |
|-|-|-|-|
| Plaintext | false | `p:1:` | None |
| Encrypted | true | `e:1:` | Group key in URL fragment `#key=...` |

### Encrypted mode URL

```
https://example.com/p/abc123#key=base64urlEncodedGroupKey
```

- `abc123` — person token (sent to server for auth)
- `#key=...` — AES-256-GCM key (URL fragment, never sent to server by browsers)

### What's encrypted per field

| Field | Plaintext mode | Encrypted mode |
|-|-|-|
| `person.token` | Plaintext | Plaintext (server needs for auth) |
| `person.name` | Plaintext | Encrypted with group key |
| `person.anatomy` | Plaintext | Encrypted with group key |
| `person.is_admin` | Plaintext | Plaintext (server needs for authorization) |
| `person.is_completed` | Plaintext | Plaintext (server needs to gate compare endpoint) |
| `person.progress` | `p:1:{"answered":47,"total":120}` | `e:1:...` (encrypted with group key) |
| `journal_entries.operation` | `p:1:{...}` | `e:1:...` (encrypted with group key) |

All opaque fields use the same `p:1:` / `e:1:` prefixed format.

### Progress tracking

The client reports its own progress on each sync by updating `person.progress`. The value is a prefixed string containing `{"answered": N, "total": M}` — answered is unique questions rated, total is questions in selected categories.

Other group members' progress is returned via the group status endpoint. In encrypted mode, the client decrypts each member's progress to display it. The server never interprets progress values.

Partner's journal entries are **not** returned until all members mark complete (blind matching — see below).

### Blind matching

Partner answers are never revealed until all members are complete. The compare endpoint gates on `is_completed = true` for all group members. This is a trust guarantee, not a UI choice — the server enforces it.

This ensures:
- No peeking at partner's answers mid-fill
- No changing your answers to match theirs
- Honest, independent responses from both sides

### What the server sees in encrypted mode

- Person tokens, admin flags, completion status
- How many journal entries each person has (it stores them), when they synced
- **NOT**: names, anatomy, progress details, which questions were answered, what the ratings are

## Sync Protocol

### Combined push + pull (single round-trip)

```
POST /api/sync
Request:
{
  "stoken": "djE6NDk6...",     // last known cursor (null on first sync)
  "operations": ["op1", "op2"] // new operations to push (may be empty for pull-only)
}

Response (success):
{
  "stoken": "djE6NTI6...",     // new cursor after all operations
  "entries": [                 // entries since client's stoken
    { "operation": "op_from_other_session" },
    { "operation": "op_from_other_session" },
    { "operation": "op1" },
    { "operation": "op2" }
  ]
}

Response (conflict — stoken is stale):
{
  "stoken": "djE6NDk6...",     // current head
  "entries": [                 // entries since client's stoken
    { "operation": "..." },
    { "operation": "..." }
  ],
  "pushRejected": true         // client must merge and retry
}
```

Note: entries in the response don't contain internal ids — just the opaque operation payloads in order.

### Server logic

```
1. Receive (stoken, operations)
2. Decode and verify stoken HMAC (reject if forged)
3. Resolve stoken to internal id
4. Check: is id == current head for this person?
   YES → append operations, assign sequential ids, return new entries + signed stoken
   NO  → reject push, return entries since client's id + signed stoken of current head
```

The server is the **sequencer**. It assigns order. Clients never see or guess internal ids.

## Reading the journal

The read side has two parallel feeds: a **per-person** feed for the caller's own answers (ungated) and a **group-wide** feed for the comparison view (gated on all-complete). Each feed has an HTTP query and a WS subscription. All four surfaces share the subscribe-before-query / `tracked()`-resume pattern; they differ only in scope and gating.

### Per-person feed — `sync.selfJournal` and `sync.onSelfJournalChange`

Used by `useSelfJournal` to materialise the caller's own answer map into the TanStack cache slot `["sync", "self-journal"]`. No precondition: a person can always read their own entries. Authed by person token; the resolver scopes both queries to `personId = ctx.person.id`.

`sync.selfJournal({ sinceId })`:
- `sinceId: null` → all of the caller's own entries
- `sinceId: N` → entries with `id > N`
- Response: `{ entries: [{ id, personId, operation }, ...], cursor, stoken }`. The `cursor` is the highest id (or echoes `sinceId` on empty delta). The `stoken` is the latest signed push cursor for the caller, returned as a courtesy so a follow-up `sync.push` doesn't need a separate handshake.

`sync.onSelfJournalChange({ lastEventId })`:
- tRPC v11 `tracked()` subscription. Same generator shape as `sync.onJournalChange` but consumes the per-person bus (`selfJournalEvents`) and skips the all-complete check.
- Includes the caller's own pushes — same-device echo. The client merge step is keyed on entry `id`, so the echo is idempotent (the entry is already in the local raw-entry set after the optimistic write; the WS delivery sets the same id to the same value).

Both surfaces back the same boot path. On every play-page mount the client reads `selfJournalCursor` from localStorage, calls `sync.selfJournal({ sinceId: cursor })`, decrypts via `replayJournal`, and merges with the local `pendingOps` outbox via `mergeAfterRejection` (pending ops win for keys with a local edit not yet pushed). The subscription stays open for the life of the layout component and feeds incremental `setQueryData` updates so the cache slot is always live.

### Group-wide feed — `sync.journal` and `sync.onJournalChange`

Used by `Comparison` on `/results` to compute pairwise matches. Gated on the "all members complete" precondition: throws `PRECONDITION_FAILED` until every member of the group has `is_completed = true`. The gate is a server-enforced privacy boundary — see [Blind matching](#blind-matching).

`sync.journal({ sinceId })`:
- Same cursor semantics as the self feed, but returns entries for **all members** of the group (and an extra `members: [{ id, name, anatomy }, ...]` array so the comparison view can render names without a second round-trip).

`sync.onJournalChange({ lastEventId })`:
- Same `tracked()` resume semantics as the self subscription, against the per-group bus (`journalEvents`). Resolver runs the precondition check, attaches the listener, runs the backfill, then streams.

### Subscribe-before-query

In every subscription resolver, the listener attaches BEFORE the backfill query so events emitted during the round-trip are buffered in the iterable, not lost. This applies symmetrically to both `journalEvents` and `selfJournalEvents`. Covered by integration tests that race a `push` against a freshly-opened subscription.

### `httpSubscriptionLink` reconnect

- Each `tracked(id, data)` yield becomes the SSE event id on the wire.
- The browser's EventSource auto-reconnects after a fixed delay (default ~3 s, configurable per-message via the SSE `retry:` field if the server chooses) and sends the most recent id back as the `Last-Event-ID` header on the new request.
- tRPC surfaces it as `input.lastEventId`, so the server's generator resumes from the cursor and replays entries > id via the backfill query.

**Lossless reconnect recovery.** Events lost during a disconnect window are replayed by the server's backfill query on the next reconnect. No polling needed, no out-of-order delivery possible.

### Edit after completion

When a marked-complete user edits an answer (via "Edit my answers" on `/waiting` or "Change my answers" on `/results`), the flow is:

1. User navigates to `/questions` — NO mutation, no unmark. `/questions` is in the free-routes list so the guard permits the navigation.
2. User changes an answer — `useSyncQueue` debounces for 3s, then `sync.push` commits
3. Server emits on **both** `journalEvents` (group bus) and `selfJournalEvents` (person bus) — emits are no-ops if nobody is listening
4. Partners viewing `/results` have `sync.onJournalChange` active → receive a `tracked` append → `setQueryData` merges into the `["sync", "journal", "derived"]` cache → `Comparison` re-renders with updated pair matches
5. The editor's own subscription `sync.onSelfJournalChange` also delivers the entry → `setQueryData` merges into `["sync", "self-journal"]` → if they have a second device open with the same token, that device's answer cache updates without a reload
6. **Everyone stays on `/results`** — `isCompleted` was never mutated, `allComplete` stays true, so the route guard has nothing to trigger on

Principle: propagate live, never mutate status implicitly. Navigation to edit is not a server-state change.

### Client logic

Sync is driven by `useSyncQueue` (`lib/use-sync-queue.ts`), which wraps `useMutation(trpc.sync.push)` with a 3-second debounce after the last answer change and automatic conflict-merge retry on `pushRejected`.

```
On each answer tap:
  1. Update local answer state (localStorage)
  2. Add operation to pending queue (localStorage)
  3. Reset the 3s debounce timer

When the debounce fires (or user taps sync manually):
  1. useMutation calls sync.push { stoken, operations: pendingQueue }
  2. If success:
     - Apply returned entries to local state (replay)
     - Clear pending queue
     - Store new stoken
  3. If pushRejected:
     - Apply returned entries to local state
     - Keep pending queue (these ops weren't applied)
     - Retry push with new stoken (automatic via conflict-merge retry)
```

## Service Worker & Offline

### What it does

A service worker (generated by `vite-plugin-pwa`) caches the app shell on first visit. After that, the app loads fully offline — browser refresh, closing and reopening the tab, even rebooting the device. The service worker intercepts all network requests and serves cached assets.

| Cached by service worker | Stored in localStorage |
|-|-|
| HTML, JS, CSS (app shell) | Pending ops (unsynced — outbox) |
| | Stoken (last push cursor) |
| | Answers + cursor (write-through snapshot of the self-journal cache) |
| | Questions + categories (fetched once) |
| | UI prefs |

### What works offline

- Opening / refreshing the app
- Browsing questions
- Rating answers (saved to localStorage)
- Navigating between screens

### What requires online

- First visit (must load the app once)
- Syncing answers to server
- Checking partner status
- Viewing comparison (needs all members' synced data)

### Offline behavior

When offline, answers accumulate in localStorage (`pendingOps`). They flush to the server on the next successful `sync.push`, which happens automatically 3s after the user's next answer change when connectivity returns, or immediately if they tap "Sync". No Background Sync API integration — see [../todo.md](../todo.md) for that as a future enhancement.

### Cache updates

Auto-update strategy (`registerType: "autoUpdate"` in vite-plugin-pwa). When a new version is deployed, the service worker detects the change on next online visit, downloads new assets, and activates automatically on next navigation. No user prompt.

This means new code can load against old localStorage data at any time. All local data formats must be backwards-compatible — see CLAUDE.md migration rules.

## Conflict Resolution

Conflicts happen when two sessions write to the journal from different devices at different times. Because the journal is the source of truth and every device hydrates from it on mount, "two sessions" is the normal case for the same person across two devices, not an edge case — the merge rule below is also what runs on every fresh boot, not only on rejected pushes.

### Example

```
Phone (offline): set oral-give = "yes"
Laptop (offline): set oral-give = "maybe", set blindfold = "yes"

Phone syncs first → server appends → new stoken
Laptop syncs → stoken is stale → push rejected
Laptop pulls new entries (phone's oral-give = "yes")
Laptop merges:
  oral-give: laptop has pending local edit → keep laptop's "maybe"
  blindfold: only laptop has this → keep it
Laptop retries push with new stoken → server appends → new stoken
```

### Merge rule

The same merge runs in two places: when `sync.push` returns `pushRejected: true` (server has entries the client hadn't seen yet), and on every play-page mount when `useSelfJournal` reconciles the freshly-fetched server delta with whatever sat in the local outbox before the page loaded.

For each key in the server entries:
- If the client has a **pending local edit** (`pendingOps`) for the same key, the local edit wins — user's most recent intention on this device.
- Otherwise, accept the server's value.

Keys only in the pending queue stay queued for the next push.

This is deterministic, clock-independent, and requires no server-side knowledge of the payload. Implemented by `mergeAfterRejection` in `packages/web/src/lib/journal.ts`; same function services both call sites.

## Client Local Storage

The journal is the source of truth for answers; localStorage holds (a) the outbox of operations not yet pushed and (b) write-through snapshots of server-derived state for instant first paint. State is scoped by FNV-1a hash of person token (`s{hash}:key`) so multiple persons on the same device coexist.

```
localStorage (scoped per person):
  pendingOps          — operations not yet synced (opaque strings, write-side authoritative)
  stoken              — last push cursor (signed, from server)
  UI prefs            — hasSeenIntro, selectedTier, selectedCategories, currentScreen

  answers             — write-through snapshot of the self-journal cache slot,
                        for instant first paint while the delta fetch runs
  selfJournalCursor   — numeric id, the last self-journal entry the client has integrated.
                        Absent → bootstrap path (full replay on next mount)

TanStack Query cache (in-memory + persisted via the write-through above):
  groups.status                — group membership, completion state, progress
  questions.list               — question bank (staleTime: Infinity, fetched once)
  ["sync", "self-journal"]     — { answers, cursor } — the caller's own answers,
                                  fed by sync.selfJournal (HTTP) + sync.onSelfJournalChange (WS)
  ["sync", "journal", "derived"] — group-wide journal for Comparison, fed by sync.journal +
                                    sync.onJournalChange. Only populated post-allComplete.
```

In encrypted mode, `pendingOps` contains encrypted strings. In plaintext mode, JSON strings. The client code that manages the queue doesn't care — it's all strings.

The localStorage `answers` key is **derived** state. It's a TanStack persister output, not a source of truth. Direct callers of `getAnswers` / `setAnswers` outside the self-journal hook should not exist; the cache slot is the only legitimate writer.

## Snapshots

Not needed initially. With max ~150 answers and ~3 edits each = ~450 journal entries per person. Replay is trivial.

If the journal grows large, a snapshot is just a special journal entry containing the full answer state at that point. Clients can start replay from the latest snapshot instead of the beginning.

## Partner Status Delivery

The tRPC `groups.onStatus` subscription yields full status snapshots whenever any broadcasting mutation runs (see [server.md](server.md#event-buses) for the list). The resolver re-reads `getStatus(token)` on each event so each subscriber gets their token-scoped view.

Snapshot semantics mean no cursor is needed — on reconnect the generator runs fresh and yields current state. The `useSubscription(trpc.groups.onStatus)` hook feeds each snapshot into the TanStack Query cache via `setQueryData`, sharing the cache entry the initial HTTP fetch (`useSuspenseQuery(trpc.groups.status)`) populated. The same pattern applies to `sync.onJournalChange`.

For the journal read paths (per-person and group-wide), see the "Reading the journal" section above.
