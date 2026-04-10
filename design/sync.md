# Sync Protocol

Inspired by [Etebase](https://docs.etebase.com) (append-only encrypted journal with sync tokens) and [Linear's sync engine](https://github.com/wzhudev/reverse-linear-sync-engine) (server-assigned monotonic sequences, reject stale pushes).

## Overview

The server stores an append-only journal of operations per person. Each operation sets a single answer (key = `questionId:role`). The server never reads the operation payload — it's opaque (plaintext JSON or encrypted blob, depending on group mode).

Current answer state is derived by replaying journal entries: last operation for each key wins.

## Data Model

```
journal_entries
  id            bigserial PK    -- server-assigned, monotonic, internal only
  person_id     UUID FK          -- who
  operation     text             -- opaque payload
  created_at    timestamptz      -- server receipt time
```

The `id` is internal — clients never see it. Clients receive an **stoken** (signed opaque cursor) instead.

## Stoken Format

The stoken is an HMAC-signed, versioned, base64url-encoded cursor:

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

## Operation Payload

Inside the `operation` field (after decryption in encrypted mode, or directly in plaintext mode):

```json
{ "key": "cunnilingus:give", "data": { "rating": "yes", "timing": "now" } }
```

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
p:1:{"key":"oral-give:give","data":{"rating":"yes","timing":"now"}}
e:1:dGhpcyBpcyBlbmNyeXB0ZWQ...
```

The client splits on `:` (limit 3) to get `[mode, version, payload]`. Old format versions remain supported — a `p:1:` entry still works after `p:2:` is introduced.

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

## Reading the journal — `sync.journal` and `sync.onJournalChange`

The read side of the sync protocol has two parallel surfaces, both gated on the "all members complete" precondition:

### HTTP query: `sync.journal({ sinceId })`

Cursor-based pull of journal entries. The input is a nullable `sinceId`:
- `sinceId: null` → return all entries for the group
- `sinceId: N` → return entries with `id > N`

Response shape:
```ts
{
  members: [{ id, name, anatomy }, ...],
  entries: [{ id, personId, operation }, ...],
  cursor: number | null  // highest id in the response, or the input sinceId if empty
}
```

Used by the client on initial `/results` mount. On an empty delta (nothing new since the cursor), `cursor` echoes the input rather than going to `null`, so repeated callers don't regress their cursor.

### WS subscription: `sync.onJournalChange({ lastEventId })`

Real-time delivery of journal appends using tRPC v11's `tracked()` primitive. The resolver follows the canonical tRPC pattern:

1. **Precondition check** — throw `PRECONDITION_FAILED` if not all members complete
2. **Subscribe-before-query** — attach `on(journalEvents, ...)` BEFORE the backfill query so events emitted during the query window are buffered in the iterable
3. **Backfill** — query entries > `lastEventId` (or all entries if `null`), yield as a single `tracked(lastId, { entries })` event
4. **Live stream** — consume the iterable, dedup entries already in the backfill, yield each new batch as a `tracked(lastId, { entries })` event

Client side (`wsLink` in tRPC v11):
- Auto-stamps the latest `lastEventId` onto the pending subscription message after every yield
- Auto-reconnects with exponential backoff on disconnect
- Re-sends the stored subscription message on reconnect, so the server resumes from the cursor

**Lossless reconnect recovery.** Events lost during a disconnect window are replayed by the server's backfill query on the next reconnect. No polling needed, no out-of-order delivery possible.

### Why two buses on the server

`packages/server/src/events.ts` exports two EventEmitters:

- `groupEvents` — emitted by all broadcasting mutations (markComplete, setProfile, markReady, etc.). Consumed by `groups.onStatus`.
- `journalEvents` — emitted by `sync.push` after a successful non-rejected commit, with the committed entries payload. Consumed by `sync.onJournalChange`.

Two buses, not one: status broadcasts and journal appends happen at very different rates and are consumed by different subscriptions. Sharing a single bus would mean each subscription filters out ~half the events it receives.

### Edit after completion

When a marked-complete user edits an answer (via "Edit my answers" on `/waiting` or "Change my answers" on `/results`), the flow is:

1. User navigates to `/questions` — NO mutation, no unmark. `/questions` is in the free-routes list so the guard doesn't kick them away.
2. User changes an answer — `useSyncQueue` debounces for 3s, then `sync.push` commits
3. Server emits on `journalEvents` (unconditional — if no subscriber is listening, emit is a no-op)
4. Partners viewing `/results` have `sync.onJournalChange` active → receive a `tracked` append → `setQueryData` merges into the `sync.journal` cache → `Comparison` re-renders with updated pair matches
5. **No one is kicked from `/results`** — `isCompleted` was never mutated, `allComplete` stays true

This is the "propagate live, never mutate status implicitly" pattern: navigation to edit is not a server-state change.

### Client logic

```
On each answer tap:
  1. Update local answer state (localStorage)
  2. Add operation to pending queue (localStorage)

On sync button press:
  1. POST /api/sync { stoken, operations: pendingQueue }
  2. If success:
     - Apply returned entries to local state (replay)
     - Clear pending queue
     - Store new stoken
  3. If pushRejected:
     - Apply returned entries to local state
     - Keep pending queue (these ops weren't applied)
     - Retry push with new stoken
```

## Service Worker & Offline

### What it does

A service worker (generated by `vite-plugin-pwa`) caches the app shell on first visit. After that, the app loads fully offline — browser refresh, closing and reopening the tab, even rebooting the device. The service worker intercepts all network requests and serves cached assets.

| Cached by service worker | Stored in localStorage |
|-|-|
| HTML, JS, CSS (app shell) | Questions + categories (fetched once) |
| | Answers (current state) |
| | Pending ops (unsynced) |
| | Stoken (last sync cursor) |

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

### Background Sync

If the user taps "Sync" while offline, the sync request is queued via the Background Sync API. When connectivity returns, the browser fires the sync event and the service worker executes the push.

**iOS limitation:** Safari does not support the Background Sync API. Fallback: detect `online` event and show a banner prompting manual sync.

### Cache updates

Auto-update strategy (`registerType: "autoUpdate"` in vite-plugin-pwa). When a new version is deployed, the service worker detects the change on next online visit, downloads new assets, and activates automatically on next navigation. No user prompt.

This means new code can load against old localStorage data at any time. All local data formats must be backwards-compatible — see CLAUDE.md migration rules.

## Conflict Resolution

Conflicts happen when two sessions edit offline and sync at different times.

### Example

```
Phone (offline): set oral-give = "yes/now"
Laptop (offline): set oral-give = "maybe", set blindfold = "yes/now"

Phone syncs first → server appends → new stoken
Laptop syncs → stoken is stale → push rejected
Laptop pulls new entries (phone's oral-give = "yes/now")
Laptop merges:
  oral-give: laptop has pending local edit → keep laptop's "maybe"
  blindfold: only laptop has this → keep it
Laptop retries push with new stoken → server appends → new stoken
```

### Merge rule

When the client receives entries from the server during a rejected push:

- For each key in the server entries: if the client has a **pending local edit** for the same key, the local edit wins (user's most recent intention on this device).
- For keys only in server entries: accept them.
- For keys only in the pending queue: keep them, push on retry.

This is deterministic, clock-independent, and requires no server-side knowledge of the payload.

## Client Local Storage

```typescript
interface LocalState {
  answers: Record<string, { rating: string; timing: string | null }>  // current state
  pendingOps: string[]    // operations not yet synced (opaque strings)
  stoken: string | null   // last sync cursor (signed, from server)
  questions: Question[]   // cached from server
  categories: Category[]  // cached from server
}
```

In encrypted mode, `pendingOps` contains encrypted strings. In plaintext mode, JSON strings. The client code that manages the queue doesn't care — it's all strings.

## Snapshots

Not needed initially. With max ~150 answers and ~3 edits each = ~450 journal entries per person. Replay is trivial.

If the journal grows large, a snapshot is just a special journal entry containing the full answer state at that point. Clients can start replay from the latest snapshot instead of the beginning.

## Polling for Partner Status

Separate from sync — a lightweight endpoint:

```
GET /api/group/status
Response: { members: [{ name, completedAt }] }
```

Polled every 30s while the app is open. When a partner's `completed_at` is set, show a banner.
