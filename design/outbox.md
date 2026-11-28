# Outbox

**Status: design, not implemented.** [Current behaviour](#current-behaviour) describes `main`; everything after it describes the target. Tracked in [../todo.md](../todo.md). The sync protocol is in [sync.md](sync.md); this changes only the shape of a pushed operation and adds an op id to journal entries.

The outbox holds the client's sealed operations that the server hasn't acknowledged. It lives in localStorage, is shared by every tab open on the same person, and is the only place an unsent answer exists.

## Current behaviour

The queue is one localStorage key, `pendingOps`, holding a `string[]` of sealed ops. Four races follow from that shape:

| # | Race | Where |
|-|-|-|
| 1 | A push clears its batch by count. Keyed dedup splices the queued op out and appends the edit, so an edit to a key in the in-flight batch shifts into the cleared prefix and is dropped; the server keeps the older value. | `sync-flush.ts:flushPendingOps` takes `sentCount`, `drainSent` → `storage.ts:drainPendingOps(count)`; splice in `storage.ts:addPendingOpForKey` |
| 2 | Autosync and Done each have their own `inFlightRef`, so both can run `flushPendingOps` at once, and each count-drain removes ops the other queued after its snapshot. | `use-sync-queue.ts:useSyncQueue` (`handleSync`), `use-mark-complete.ts:useMarkComplete` |
| 3 | Another tab flushes or rewrites the shared queue mid-push; the delayed success then drains by position ops that were never sent. Two tabs on `/questions` both schedule a push for the same enqueue, because `usePendingOps` also fires on the native `storage` event. | `storage.ts:drainPendingOps`, `storage.ts:setPendingOps`, `Question.tsx` (effect on `pendingOps.length`) |
| 4 | Every mutation is read-parse-modify-write of the whole array, which isn't atomic across tabs: two tabs enqueueing at once can overwrite each other. | `storage.ts:addPendingOp`, `addPendingOpForKey`, `drainPendingOps` |

Three more hazards sit next to them:

- **A lost response replays an acknowledged op.** If a push commits but its response never arrives (tab killed, connection dropped), the ops stay queued and the saved stoken stays stale. The next push is rejected, and the retry re-sends the same ops under the fresh stoken (`flushPendingOps`, second `push`). They append again, over anything another device wrote to those keys in between.
- **A retry sends a frozen batch.** The retry re-sends the `ops` array captured before the first attempt, not the current queue, so an op superseded while the push was in flight is still sent.
- **The batch and the stoken are read at different times.** `flushPendingOps` reads the queue, awaits `getProgress()`, then reads the stoken. A stoken another tab saved during that await can carry an older batch past the server's head check (`SyncStore.push`).

Autosync also schedules on `pendingOps.length` (`Question.tsx`), so an edit that replaces a queued op without changing the length schedules nothing.

## Goals

- Never lose an unsent edit.
- Resending is harmless; an old value never lands over a newer one.
- Correct with any number of tabs, including tabs still on the previous bundle.
- Done never waits indefinitely on someone else's push.

## Outbox: one entry per answer

```
s{hash}:outbox:{questionKey}  →  {"v":1,"id":"<opId>","op":"e:1:…"}
```

The outbox is a map from answer key (`questionId:role`) to the latest unsent op for it, not a log. `id` is the op id: 16 random bytes, base64url, fresh on every enqueue. `op` is the sealed op, stored and sent verbatim.

- **Enqueue** overwrites the key's entry: one `setItem`, synchronous. Dedup is inherent and works across reloads and tabs, so the in-memory index (`storage.ts:ensureDedupIndex`) goes away. No shared array is rewritten (race 4).
- **A late seal can't overwrite a newer edit.** `Question.tsx:commitAnswer` writes the optimistic answer, then awaits `codec.seal`, and `QuestionCard.tsx` can start a debounced note commit without awaiting the previous one, so on `main` an older seal that finishes last replaces the newer op. `commitAnswer` takes an in-memory per-key edit counter before sealing and enqueues only if no newer edit for that key has started. A seal in progress counts as pending work: the tab tracks the keys being sealed, and Done waits for them.
- **No ordering.** The server keeps the last write per key, and the outbox holds at most one op per key, so the order of entries within a push doesn't matter.
- **The key is cleartext** in the storage key name, beside an encrypted op. The `answers` snapshot in the same storage already holds every answer in cleartext (`storage.ts:setAnswers`), so nothing new is exposed on the device.
- **Reading** is a prefix scan of localStorage keys. `useOutbox()` replaces `usePendingOps` and exposes the entry count and a change counter, driven by the same `storage` and in-tab events as today (`storage.ts:makeLocalStorageHook`). An entry with an unknown `v` is left alone and not sent.

## Flush

```
flush():
  1. progress = await getProgress()                   -- async seal, before the snapshot
  2. in one synchronous step:
       stoken = codec.encrypted && !codec.keyProven ? null : getStoken()
       adopt legacy pendingOps (see Migration)
       batch  = the legacy block's ops in order as (id, op), then every entry as (key, id, op)
     if batch is empty: stop
  3. result = await sync.push({stoken, operations, progress})   -- aborted after 30 s
  4. accepted: setStoken(result.stoken); remove the sent ops from the legacy block, by id;
               delete each sent entry only if its id is still the id that was sent
  5. rejected: await assertKeyOpens(codec, result.entries, OperationPayload)   -- WrongKeyError: stop, nothing saved
               delete entries and legacy-block ops whose id appears in result.opIds
               setStoken(result.stoken)
               decode result.entries, then merge and setAnswers (see below)
               run steps 1 to 4 once more with a fresh snapshot; if rejected again, repeat
               the first three lines of step 5 and leave the rest queued
```

- **Compare-and-delete** is the whole acknowledgement rule. A newer edit has a new id, so a push that sent the old one doesn't clear it (race 1). An overlapping flush or another tab can only clear what it sent (races 2 and 3).
- **Overlapping flushes are safe**, so autosync and Done keep separate guards and no shared flusher or lock is needed. When two pushes carry the same op, the server's head check rejects one (`SyncStore.push`), and its rejection lists the op id.
- **The retry takes a fresh snapshot**, so it never sends an op that was replaced or acknowledged meanwhile.
- **Stoken and batch are read together**, after progress is sealed. A push holding a replaced op then also holds a stoken from before the replacement existed, and is rejected if the replacement has committed.
- **Key verification is unchanged** ([sync.md § Key verification](sync.md#key-verification)): a null stoken while the key is unproven, `assertKeyOpens` before anything is deleted or saved, the merge against the current outbox, progress only on an accepted push.
- **The merge reads local state when it writes.** On `main`, `mergeAfterRejection` is handed `getAnswers()` and the queue before it decrypts, so an edit made during decryption is overwritten by the `setAnswers` that follows. Here the delta (and the legacy block's keys) are decoded first; then, in one synchronous step, the latest answers and the pending set are read, the delta is applied and the result written. The pending set is the keys with an entry, the legacy block's keys, and the keys with a seal in progress, because `commitAnswer` writes the optimistic answer before its seal resolves. The same holds for hydration and the live stream (`self-journal.ts:applySelfJournalDelta`).
- **Journal acknowledgement** also runs where own entries arrive outside a push: hydration (`sync.selfJournal`) and the live stream (`sync.onSelfJournalChange`), after `assertKeyOpens` and before the merge. An entry whose id is in the journal is deleted.
- **Autosync re-arms on the change counter**, not the count: an overwrite doesn't change the count. If the debounce fires while a push is in flight, `handleSync`'s guard returns without pushing; it records the skipped wakeup and reschedules when the guard clears, so an edit that push left in place isn't stranded.

Remaining window: read-compare-delete isn't atomic across tabs. It can drop an edit only if the same person edits the same question in a second tab in the microseconds between another tab's compare and its delete. Accepted.

### Done

```
markComplete():
  disable the questionnaire, so no new edit can start until Done ends
  wait for seals in progress, then adopt legacy pendingOps
  targets = the keys with an entry at tap time, plus the legacy block
  flush(); if a target key still has an entry or a seal in progress, or the legacy block
  isn't empty: wait for those seals and flush() once more
  still not clear, or a flush failed or timed out: "couldn't sync" state, don't mark complete
  final check and sync.markComplete, with edits still disabled
```

Done doesn't wait for autosync; it pushes on its own, bounded by the 30 s timeout per request. Seals come first because `commitAnswer` writes the optimistic answer before its seal resolves, so without the wait Done could see an empty outbox and mark complete before the entry exists. Edits are blocked because otherwise a target edited while Done's push is held is cleared by that push before the replacement's seal finishes; Done would see an empty target and mark complete, and the replacement would enqueue after autosync is gone. Targets are keys, not ids: an entry replaced by a newer edit still holds its key, so Done has to deliver the replacement too. Done must not go on early, because `sync.markComplete` doesn't look at the outbox and navigating away from `/questions` tears down the autosync timer (`useSyncQueue` cleanup).

The failure state reads "Couldn't sync — your answers are saved on this device. Tap to retry", and Done retries by itself on the browser's `online` event. Today a failed Done gives no feedback (`useMarkComplete` rethrows and the `onClick` in `Question.tsx` doesn't catch it), so someone who closes the tab is never marked complete and their last answers stay only on that device.

## Server: idempotency keys

An API and schema change, which `CLAUDE.md` asks to discuss first. The owner has approved the direction.

- **Schema.** `journal_entries.op_id text NULL`, with a unique index on `(person_id, op_id) WHERE op_id IS NOT NULL`. Existing rows stay null.
- **`sync.push` input.** Each operation is `{ id, op }` or a bare sealed string (older bundles), stored with a null `op_id`.
- **Insert.** `ON CONFLICT (person_id, op_id) WHERE op_id IS NOT NULL DO NOTHING`, so the partial index is inferred. The head check and the locks are unchanged.
- **Duplicates.** `RETURNING` yields only the rows actually inserted. Only those are emitted on the two buses, and the new head is the last of them or, if there are none, the prior head: a duplicate-only push at the current head is accepted, returns the same stoken and emits nothing. (`SyncStore.push` today indexes the last returned row whenever the input is non-empty, which would throw.)
- **Output.** `op_id` is carried through the store projections, `opaque-id.ts:toWireEntries` and the output schemas, so entries from `sync.selfJournal`, `sync.journal` and both subscriptions gain `opId` (nullable). The push response keeps `entries` as strings, because older bundles read it that way, and adds `opIds`, aligned by position, with `null` for rows without an id.
- **Privacy.** Op ids are random and carry nothing about the question or answer, so partners seeing them in the group journal learn nothing.

This makes a resend after a lost response harmless by construction, for `p:1:` and `e:1:` alike. Usually the stoken is stale, the push is rejected, and the client deletes the entry from the returned ids. If the stoken happens to be current, the insert skips the duplicate.

## Migration

Legacy `pendingOps` strings move, as one ordered block, into a single entry:

```
s{hash}:outbox:legacy  →  {"v":1,"ops":[{"id":"<opId>","op":"p:1:…"},{"id":"<opId>","op":"e:1:…"}]}
```

- **Adopt** before each flush, before Done captures its targets, and on load: give each `pendingOps` string a deterministic op id, append to the block, in order, those whose id it doesn't already hold, then remove the `pendingOps` key. The id is `legacy-{hash64(op + ":" + occurrence)}`, base64url, where `occurrence` counts earlier copies of that exact string in the array and the hash is synchronous and at least 64 bits (the shared 32-bit `fnv1a` isn't enough). Encrypted ops are already unique through their IV; identical plaintext strings carry the same value, and the occurrence keeps genuine repeats apart. Any adopter reading the same array therefore writes the same ids, and a second adoption appends without duplicates. Adoption is one synchronous step with no await (the strings are copied verbatim), from reading `pendingOps` and the block to removing `pendingOps`.
- **Send first.** The block's ops go at the front of the push in their original order, ahead of the per-answer entries: as bare strings in release 1, as `{ id, op }` once the server accepts ids (release 2). An older legacy op therefore never lands after a newer keyed edit in the same push, and two legacy ops for one key keep their order. No key is parsed out of legacy ops.
- **Clear** on an accepted push by removing the ops that were sent. From release 2 they are also acknowledged from the journal by id, like keyed entries; otherwise a lost response could clear a keyed op and leave an older legacy op for the same answer to be sent alone. In release 1 a lost response resends the block, as on `main`.
- **Flush on load, after the key checks.** A load that finds `outbox:legacy` non-empty, freshly adopted or left by an earlier load, flushes without waiting for an edit, so the block never sits in a tab with no autosync. That flush runs only once the layout's key checks have passed (`routes/p/$token/route.tsx`, `assertKeyNotRefuted` after journal hydration): in a group without a key check, a null-stoken push into an empty journal is accepted and returns nothing to verify.

**Mixed versions.** The service worker doesn't reload open tabs (`vite.config.ts`: `registerType: "autoUpdate"`, no reload hook), so an old tab can keep writing `pendingOps` while new tabs run. A new tab adopts those ops on its next load or flush and pushes them. To the old tab that is another tab flushing the queue, which it already lives with on `main` (race 3). What the mixed window adds is listed under [Known corner cases](#known-corner-cases). The server accepts both input shapes. The legacy reader stays for about six months, logging each adoption so its use can be seen falling to zero, and is then deleted.

**`CLAUDE.md`.** The implementing change amends § Storage and § Graceful local data migrations: the outbox is `outbox:{key}` entries, and the "pending ops are opaque strings" rule now covers the `op` field inside an entry.

## Rollout

Two releases, roll-forward only:

1. **The per-answer outbox.** Fixes races 1 to 4, the late seal, the stranded autosync, the merge timing, the frozen-batch retry and the stoken timing. It sends bare strings and has no journal acknowledgement yet, so a lost response still resends as on `main`.
2. **Server idempotency keys.** The server change deploys with the client that sends `{ id, op }` and acknowledges from the journal. Adds the lost-response safety.

There is no drain-back release: its reader would stay live in cached tabs during the forward rollout and move new entries back into `pendingOps` mid-push. If release 1 misbehaves, it is fixed forward. Reverting the client would strand whatever is queued under `outbox:*`; that is the accepted cost.

## Known corner cases

Accepted, with no extra machinery:

- **Adoption against an old tab's write.** Old code rewrites the whole `pendingOps` array from its own read, and adoption removes the whole key. If an old tab's enqueue lands between adoption's read and its remove, that op is deleted unsent, whichever question it is for. If the old tab read the array before the remove and writes after it, the adopted ops reappear and are adopted again: a duplicate send if they had already been cleared. Both need the two writes to interleave within one synchronous step.
- **Two new tabs adopting at once.** Adoption has no await, so the only overlap is another process's write inside that step. One tab's block write can then replace the other's. Both derive the same ids from the same array, so an op one tab already delivered is skipped by the server's dedup if the other resends it: the outcome is a lost or duplicated edit at worst (an old tab adding an op in between), never an older value over a newer one.
- **One question edited in an old tab and a new tab before either syncs.** The legacy block is sent first, so the new tab's value lands last even when the old tab's edit was the later one. And an old-tab op written after a push's snapshot is adopted by a later push, after a keyed edit that the first push committed. `main` orders these correctly through its single array; this is specific to the mixed-version window.
- **A rejection's merge against the live stream.** A rejection whose decode finishes after the stream has applied a newer value for the same key, with nothing pending for it, writes the older value locally. This is on `main` today and the outbox doesn't make it worse; the server is unaffected and the local view corrects on the next full replay. The fix is a single ordered reconciliation path for all journal deltas, recorded here as a follow-up, not part of this design.
- **Seal ordering across tabs.** Tab A starts sealing an edit; tab B makes a newer edit to the same question, seals it and commits it; A's seal then finishes, passes its own tab's counter, and the older value can commit over B's. Needs the same question edited in two tabs within one seal's duration (milliseconds).
- **A lost response at the switch to op ids.** Release 1 commits a bare string and loses the response; release 2 resends the op with an id the row never recorded. One duplicate append, as on `main`. The same applies if the client is rolled back to bare strings.

## Interactions

- **The per-group push lock (#248).** `SyncStore.push` locks the person's row (`FOR UPDATE`), then takes `pg_advisory_xact_lock(hashtextextended('journal-push:' || groupId, 0))`, so a group's journal ids commit in id order. The idempotent insert stays in that transaction, after both locks. An all-duplicate push still takes the locks and inserts nothing. Rows skipped by `ON CONFLICT` consume sequence values; the gaps are harmless because cursors compare with `id >`.
- **The journal gate fixes in [../todo.md](../todo.md)** (`journalSince` in one REPEATABLE READ transaction; the live-batch gate recheck in `sync.onJournalChange`) touch the same read and emit paths as `opId`. They compose: `opId` is projection-only, and an all-duplicate push emits nothing, so there is no batch to gate. Whichever lands second merges.
- **Rotating the person token** (todo, Later). localStorage is scoped by `fnv1a(token)`, so rotating a token on a device that already used it strands its `outbox:*` entries, stoken and `answers` snapshot under the old scope. Rotation has to move the scoped keys to the new scope before anything else runs, and has to work with the one-page-one-person reload (`session.ts:isPersonSwitch`). A genuine first land has nothing to move.
- **Background Sync** (todo, Later). A service worker can send already-sealed ops but can't handle a rejection: `assertKeyOpens` and the merge need the group key, which lives only in each tab's sessionStorage (`crypto.ts`). It could wake a tab to flush, not flush by itself.

## Rejected alternatives

| Approach | Why not |
|-|-|
| Hold the in-flight prefix, then drain by count (#244) | Longer batches, so a delayed cross-tab drain removes more unsent ops. |
| Serialize flushes with a promise chain (#244) | A stalled push blocks Done indefinitely. |
| Clear by value (#244) | Length-keyed autosync never pushes the surviving edit; identical `p:1:` bytes clear a fresh edit. |
| Clear only an intact prefix (#244) | Acknowledged ops stay queued after another tab rewrites the queue, and are replayed over newer edits. |
| Zero, PowerSync, Electric | The server must read the data, and each needs extra infrastructure. |
| Evolu | A blind relay can't enforce the reveal-after-everyone-completes gate; a rewrite. |
| CRDT libraries | Multi-writer machinery this doesn't need; encrypted documents can't be compacted server-side. |

Web Locks aren't needed for correctness. They could later skip the duplicate push when several tabs are open.

## Possible future: TanStack DB + offline-transactions

TanStack DB collections with a durable outbox owned by a leader tab, which requires idempotency keys on the server.

Why not now:

- Answers would move into a TanStack DB collection, which is pre-1.0, and that is a rewrite of the client data layer.
- It sends one request per write, with no per-key coalescing, where this design sends one batched push.
- Tabs other than the leader run online-only.
- Its payload codec is synchronous; sealing here is asynchronous WebCrypto.

Revisit if the client grows into a real local-first data layer, or once it reaches 1.0. The op ids above carry over directly, which is part of why they are worth adding.

## Test plan

| Tier | Case | Covers |
|-|-|-|
| unit | Edit a key while its push is held, then acknowledge: the edit stays queued and autosync re-arms | race 1, scheduler |
| unit | Hold a push past the debounce deadline of a later edit: the edit is pushed once the first settles | stranded autosync |
| unit | Two edits to one key whose seals complete in reverse order: the newer op is queued | late seal |
| unit | An encrypted note seal held across a merge and the Done tap: the optimistic answer survives the merge; Done waits, then delivers it before marking complete. No edit can start while Done runs | sealing edit |
| unit | Autosync and Done flush at once: each clears only what it sent, Done succeeds | race 2 |
| unit | Done with a target replaced mid-flush delivers the replacement; two rejections, a failure or a timeout end in the retry state without `sync.markComplete`; legacy ops are adopted before targets are taken | Done |
| unit | A second tab overwrites and flushes during a held push: the late acknowledgement deletes nothing it didn't send | race 3 |
| unit | Two tabs enqueue different keys at once: both entries exist | race 4 |
| unit | Rejection order is `assertKeyOpens`, delete by op id, `setStoken`, merge, fresh-snapshot retry; existing key-verification cases in `sync-flush.test.ts` keep their assertions | frozen batch, key verification |
| unit | An edit made while a rejection, hydration or live delta is decrypting survives the merge | merge timing |
| unit | Stoken and batch are read after progress resolves | stoken timing |
| unit | Legacy `string[]` is adopted in order and sent ahead of keyed entries; a second adoption appends without duplicates or drops; two tabs adopting the same array produce the same ids; an old-code port keeps writing `pendingOps` alongside | migration |
| unit | Wrong key fragment, refuting profile, empty journal, legacy ops queued: no push before the key-mismatch screen. A reload with only `outbox:legacy` populated flushes it | eager flush |
| integration | A legacy op and a keyed op for one answer commit and the response is lost: both are acknowledged by id and neither is resent | lost response |
| integration | Stale-head push of an already-committed op id: rejected, `entries` and `opIds` aligned, nothing inserted | lost response |
| integration | Duplicate-only push at the current head: accepted, same stoken, nothing emitted | lost response |
| integration | Mixed duplicate, new and bare-string ops: only the new rows are inserted and emitted, bare strings get a null `op_id` | idempotency |
| e2e | Hold `sync.push`, edit the same note, release; and the same with Done tapped mid-push. For `encrypted` in `[false, true]` | races 1 and 2 |
| e2e | `sync.push` fails with Done tapped: the retry state shows, nothing is marked complete; tapping it, or an `online` event, completes | Done failure |
| e2e | Two pages in one context answer and sync while one push is held; then drop a response, write the key from a second context and reload: a fresh context has every answer and the newer value stands | races 3 and 4, lost response |
