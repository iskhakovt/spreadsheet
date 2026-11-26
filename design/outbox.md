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
- **No ordering.** The server keeps the last write per key, and the outbox holds at most one op per key, so the order of ops within a push doesn't matter.
- **The key is cleartext** in the storage key name, beside an encrypted op. The `answers` snapshot in the same storage already holds every answer in cleartext (`storage.ts:setAnswers`), so nothing new is exposed on the device.
- **Reading** is a prefix scan of localStorage keys. `useOutbox()` replaces `usePendingOps` and exposes the entry count and a change counter, driven by the same `storage` and in-tab events as today (`storage.ts:makeLocalStorageHook`).

An entry with an unknown `v` is left alone and not sent.

## Flush

```
flush():
  1. progress = await getProgress()                   -- async seal, before the snapshot
  2. in one synchronous step:
       stoken = codec.encrypted && !codec.keyProven ? null : getStoken()
       batch  = every outbox entry as (key, id, op)
     if batch is empty: stop
  3. result = await sync.push({stoken, operations: [{id, op}, …], progress})   -- aborted after 30 s
  4. accepted: setStoken(result.stoken); for each sent (key, id):
               delete the entry only if its id is still the id that was sent
  5. rejected: await assertKeyOpens(codec, result.entries, OperationPayload)   -- WrongKeyError: stop, nothing saved
               delete entries whose id appears in the returned op ids
               setStoken(result.stoken)
               setAnswers(await mergeAfterRejection(getAnswers(), current outbox ops, result.entries, codec))
               run steps 1 to 4 once more with a fresh snapshot; if rejected again, repeat
               the first three lines of step 5 and leave the rest queued
```

- **Compare-and-delete** is the whole acknowledgement rule. A newer edit has a new id, so a push that sent the old one doesn't clear it (race 1). An overlapping flush or another tab can only clear what it sent (races 2 and 3).
- **Overlapping flushes are safe**, so autosync and Done keep separate guards and no shared flusher or lock is needed. When two pushes carry the same op, the server's head check rejects one (`SyncStore.push`), and its rejection lists the op id.
- **The retry takes a fresh snapshot**, so it never sends an op that was replaced or acknowledged meanwhile.
- **Stoken and batch are read together**, after progress is sealed. A push holding a replaced op then also holds a stoken from before the replacement existed, and is rejected if the replacement has committed.
- **Key verification is unchanged** ([sync.md § Key verification](sync.md#key-verification)): a null stoken while the key is unproven, `assertKeyOpens` before anything is deleted or saved, the merge against the current outbox, progress only on an accepted push.
- **Journal acknowledgement** also runs where own entries arrive outside a push: hydration (`sync.selfJournal`) and the live stream (`sync.onSelfJournalChange`), after `assertKeyOpens` and before the merge. An entry whose id is in the journal is deleted.
- **Autosync re-arms on the change counter**, not the count: an overwrite doesn't change the count.

Remaining window: read-compare-delete isn't atomic across tabs. It can drop an edit only if the same person edits the same question in a second tab in the microseconds between another tab's compare and its delete. Accepted.

### Done

```
markComplete():
  targets = the (key, id) pairs in the outbox at tap time
  flush()                                  -- including its one retry
  if any target pair is still in the outbox: throw, don't mark complete
  sync.markComplete
```

Done doesn't wait for autosync; it pushes on its own, bounded by the 30 s timeout per request. A target counts as gone when it was acknowledged by anyone or replaced by a newer edit, which then belongs to whichever tab made it.

## Server: idempotency keys

An API and schema change, which `CLAUDE.md` asks to discuss first. The owner has approved the direction.

- **Schema.** `journal_entries.op_id text NULL`, with a unique index on `(person_id, op_id) WHERE op_id IS NOT NULL`. Existing rows stay null.
- **`sync.push` input.** Each operation is `{ id, op }` or, from older bundles and keyless legacy entries, a bare sealed string (stored with a null `op_id`).
- **Insert.** `ON CONFLICT DO NOTHING` on the index. The stoken head check and the row lock are unchanged; if every op is a duplicate the head doesn't move.
- **Output.** Journal entries from `sync.selfJournal`, `sync.journal` and both subscriptions gain `opId` (nullable). The push response keeps `entries` as strings, because older bundles read it that way, and adds a parallel `opIds` array.
- **Privacy.** Op ids are random and carry nothing about the question or answer, so partners seeing them in the group journal learn nothing.

This makes a resend after a lost response harmless by construction, for `p:1:` and `e:1:` alike. Usually the stoken is stale, the push is rejected, and the client deletes the entry from the returned ids. If the stoken happens to be current, the insert skips the duplicate.

## Migration

On load and before each flush, new code moves any legacy `pendingOps` strings into entries, then removes the `pendingOps` key:

- **`p:1:`**: parse the key from the JSON and write that key's entry with a fresh op id. Later strings overwrite earlier ones; an entry already in the outbox for the key is kept.
- **`e:1:`**: the key can't be read synchronously, so the op becomes a keyless entry, `outbox:legacy:{fnv1a(op)}`, with no op id. It is sent as a bare string, deleted after an accepted push, and behaves as today after a lost response.
- A load that adopts anything flushes straight away, so adopted ops never sit in a tab that has no autosync running.

The legacy reader stays for about six months, logging each adoption so its use can be seen falling to zero, and is then deleted.

**Mixed versions.** The service worker doesn't reload open tabs (`vite.config.ts`: `registerType: "autoUpdate"`, no reload hook), so an old tab can keep writing `pendingOps` while new tabs run. A new tab adopts those ops on its next load or flush and pushes them. To the old tab that is another tab flushing the queue, which it already lives with on `main` (race 3), so the window is no worse than two old tabs. The server accepts both input shapes.

**Rollback.** Expand, then contract: first ship a release whose only change is a reader that drains any `outbox:*` entries back into `pendingOps`. Then ship the outbox. Reverting to the first release is safe; reverting past it strands queued ops.

**`CLAUDE.md`.** The implementing change amends § Storage and § Graceful local data migrations: the outbox is `outbox:{key}` entries, and the "pending ops are opaque strings" rule now covers the `op` field inside an entry.

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
| unit | Autosync and Done flush at once: each clears only what it sent, Done succeeds | race 2 |
| unit | A second tab overwrites and flushes during a held push: the late acknowledgement deletes nothing it didn't send | race 3 |
| unit | Two tabs enqueue different keys at once: both entries exist | race 4 |
| unit | Rejection order is `assertKeyOpens`, delete by op id, `setStoken`, merge, fresh-snapshot retry; existing key-verification cases in `sync-flush.test.ts` keep their assertions | frozen batch, key verification |
| unit | Stoken and batch are read after progress resolves | stoken timing |
| unit | Legacy `string[]` (plaintext and encrypted) is adopted, flushed and removed; an old-code port keeps writing `pendingOps` alongside | migration |
| store | Same `(person_id, op_id)` twice inserts once; bare strings store a null `op_id` | lost response |
| integration | Push commits, response dropped, another device writes the key, client resends: one journal entry, the newer value stands | lost response |
| e2e | Hold `sync.push`, edit the same note, release; and the same with Done tapped mid-push. For `encrypted` in `[false, true]` | races 1 and 2 |
| e2e | Two pages in one context answer and sync while one push is held: a fresh context has every answer | races 3 and 4 |

## Open questions

1. **Done when its push fails or times out.** Today the tap gives no feedback: `useMarkComplete` rethrows and the `onClick` in `Question.tsx` doesn't catch it. Keep that, or show an explicit "couldn't sync, tap to retry" state? Recommended: the explicit state.
2. **One change or two.** The outbox alone fixes races 1 to 4 and can ship first, sending bare strings. The server op ids add the lost-response safety and journal acknowledgement. Two changes are easier to review and revert; one avoids an interim state where a rejection can't acknowledge by id.
