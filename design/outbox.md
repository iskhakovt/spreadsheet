# Outbox

**Status: design, not implemented.** [Current behaviour](#current-behaviour) describes `main`; everything after it describes the target. Tracked in [../todo.md](../todo.md). The sync protocol itself is in [sync.md](sync.md) and doesn't change.

The outbox is the client's queue of sealed operations that haven't been acknowledged by the server. It lives in localStorage, is shared by every tab open on the same person, and is the only place an unsent answer exists.

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
- At-least-once delivery, and never an old value over a newer one: resending the latest value of a key is harmless, replaying a value that has been superseded is not.
- Correct with any number of tabs, including tabs running the previous client version.
- Done never waits indefinitely on someone else's push.
- No change to `sync.push`, the journal, or the sealed op strings (one optional payload field, [below](#operation-identity)).

Non-goals: running autosync outside `/questions`; the `answers` snapshot, which `storage.ts:setAnswer` also updates by read-modify-write but which is derived state the next journal delta corrects.

## Invariants

1. **An entry leaves the outbox only when** a push that contained it was accepted, the server's journal shows it, or a newer local edit of the same key supersedes it.
2. **Removal is by identity.** Nothing is ever removed by position or count.
3. **No mutation rewrites shared state.** Enqueue creates one key, acknowledgement deletes specific keys. Tabs can't overwrite each other.
4. **An op is sent only if its entry exists when the request is built**, and the stoken is read before the entries, in the same synchronous step.
5. **Entries are removed before the stoken that covers them is saved.** So whenever a stoken is visible, no entry committed at or before it is still queued.
6. **Safety never depends on a lock, a timer, or one tab being the only flusher.** Overlapping pushes are safe; coordination only saves round-trips.

Invariants 4 and 5 are what keep superseded values out. The server accepts a push only if its stoken is the head (`SyncStore.push`, under the person's row lock). A push that still carries a superseded entry read its stoken before the superseding edit existed, so if that edit has committed, the head has moved and the push is rejected.

## Data model

One localStorage key per entry, scoped like everything else (`s{hash}:`):

```
s{hash}:outbox:{id}  →  {"v":1,"seq":42,"key":"oral:give","op":"e:1:…"}
```

| Field | Meaning |
|-|-|
| `id` | In the key name. 16 random bytes, base64url. Local identity only; never sent. |
| `v` | Envelope version. An entry with an unknown `v` is left in place and never sent or counted. An entry that doesn't parse is removed and logged. |
| `seq` | Lamport counter: one more than the highest `seq` in storage or issued by this tab. The queue order is `(seq, id)`. Two tabs can pick the same `seq`; `id` breaks the tie. |
| `key` | The answer key (`questionId:role`) the op targets, or `null` for an adopted legacy `e:1:` op. Local only. |
| `op` | The sealed op, stored verbatim and sent verbatim. |

`key` is cleartext beside an encrypted op. That exposes nothing new on the device: the `answers` snapshot in the same storage already holds every answer in cleartext (`storage.ts:setAnswers`). It replaces the in-memory dedup index (`storage.ts:ensureDedupIndex`), so dedup works across reloads and tabs in encrypted groups too.

Reading the queue is a prefix scan over `localStorage.key(i)`, cached per scope and invalidated by the native `storage` event (other tabs) and the same in-tab event `storage.ts:notifyChanged` dispatches today. `useOutbox()` replaces `usePendingOps` and returns the count and the id of the newest entry.

`pendingOps` stays a `string[]` and is never written in the new shape ([Migration](#migration)).

### Operation identity

Journal acknowledgement ([below](#acknowledgement)) matches op strings, so it only applies to ops that are unique:

- `e:1:` ops are unique by their random IV.
- `p:1:` ops are deterministic. A random `n` field in the payload makes them unique: `OperationPayload` gains `n: z.string().optional()` in `@spreadsheet/shared`, set when an answer op is sealed. Readers already strip unknown keys, the server never reads payloads, and the `p:1:` prefix doesn't change.

A `p:1:` op without `n` (queued by an older client, or all of them if the field is declined) is never matched against the journal. It keeps today's behaviour after a lost response: it is resent.

## Migration

`pendingOps` becomes a legacy inbox. New code never enqueues to it, reads it everywhere it reads the outbox, and empties it only when it is about to push.

- **Read.** "The pending ops" means the legacy array followed by the outbox entries, for the rejection merge, journal hydration, the pending count, and Done's target set. A reload on new code with old data loses nothing before the first push.
- **Adopt at send.** The flusher, in the synchronous step that builds a request, copies each legacy string to an entry and removes it from `pendingOps`. Adopted entries take the next `seq` values in array order, `key` parsed from a `p:1:` op's JSON (as `ensureDedupIndex` does today) or `null` for `e:1:`. Their ids are deterministic (`legacy-{index}-{length}-{fnv1a(op)}`), so two tabs adopting the same array write the same entries, not two copies.
- **Forever.** The reader stays. A device can come back with a legacy queue at any time.

The envelope is a deliberate exception to "pending ops are opaque strings, never change how they're stored": the op string is still stored and sent verbatim, and `CLAUDE.md` is amended in the implementing change.

### Mixed-version window

The service worker is registered without a reload hook (`vite.config.ts`, `registerType: "autoUpdate"`, no `virtual:pwa-register`), so an open tab keeps running the old bundle until it is reloaded. Old and new tabs on the same person can coexist for as long as a tab stays open.

| Situation | Outcome |
|-|-|
| Old tab alone | Unchanged from `main`, including its races. |
| Old tab enqueues, new tab idle | The new tab doesn't touch `pendingOps`. The old tab flushes its own queue. |
| Old tab enqueues, new tab pushes | The new tab adopts and sends the ops. To the old tab this is "another tab flushed the queue", which it already handles as it does on `main`: a push it had in flight then drains by count (race 3). No worse than two old tabs on `/questions`, which both push every enqueue. |
| Both push the same ops | One push is rejected. The new tab sees the ops in the rejection and drops its copies ([Acknowledgement](#acknowledgement)). |
| Old tab merges a journal delta | It can't see new entries, so it may write the server's value for a key the new tab has pending into the shared `answers` snapshot. The entry is still queued; the new tab's push and its echo restore the value. |
| Adoption races an old tab's enqueue | Adoption re-reads `pendingOps` and writes back whatever it didn't copy, but that write is not atomic against old code (race 4, as on `main`). |

Adopting only at send is what keeps this bounded: a tab that isn't pushing never takes ops away from a tab that would have pushed them.

## Enqueue

```
enqueue(op, key):
  1. seq = 1 + max(seq in storage, last seq this tab issued)
  2. setItem(outbox:{new id}, {v, seq, key, op})
  3. removeItem every entry with the same key that orders before the new one
```

Synchronous, as today (`Question.tsx:commitAnswer` seals, then enqueues). Write first, remove second, so a failed write leaves the older entry in place.

Dedup removes a superseded entry even if it is in a push in flight. That is safe: the in-flight push acknowledges ids that no longer exist, and the edit stays queued (race 1). Two tabs editing the same key at once each remove only entries that order before their own, so exactly one survives. Entries with a `null` key are never deduped.

## Flushing

One function builds and sends a push. Autosync, the manual sync button, the leftover flush on mount, and Done all call it.

```
attempt():
  1. progress = await getProgress()                      -- async seal, before the snapshot
  2. synchronously:
       stoken = codec.encrypted && !codec.keyProven ? null : getStoken()
       adopt the legacy queue
       batch  = outbox entries in (seq, id) order
     if batch is empty: stop
  3. result = await sync.push({stoken, operations: batch ops, progress})   -- aborted after PUSH_TIMEOUT
  4. accepted: remove the batch's ids, then setStoken(result.stoken)
  5. rejected:
       await assertKeyOpens(codec, result.entries, OperationPayload)   -- WrongKeyError: stop, nothing saved
       remove entries the rejection shows are committed
       setStoken(result.stoken)
       setAnswers(await mergeAfterRejection(getAnswers(), current pending ops, result.entries, codec))
       run steps 1 to 4 once more
       still rejected: assertKeyOpens, remove committed entries, setStoken, leave the rest queued
```

The retry builds a fresh batch, so it never sends an entry that was superseded or acknowledged in the meantime.

### In one tab

A module-level flusher per scope replaces the two `inFlightRef` guards. A flush requested while one is running joins it, and when a flush settles with entries still queued, the flusher runs again (race 2). It calls the tRPC client from `useTRPCClient()` so each request can carry an abort signal, and exposes `syncing` to the UI.

Autosync keeps its 3 s debounce and re-arms on the newest entry's id, not the count, so a same-length edit still schedules a push.

### Across tabs

A tab takes the Web Lock `spreadsheet:outbox:{scope}` with `ifAvailable` for the duration of a flush. If another tab holds it, autosync doesn't push; it re-arms its debounce, and the holder's flusher picks up the shared entries when it loops. After `LOCK_PATIENCE` of continuous unavailability the tab takes the lock with `steal`.

The lock is an optimisation. It saves the rejected round-trip two tabs would otherwise pay per enqueue. Without `navigator.locks` (Safari before 15.4, some webviews, insecure contexts) the tab flushes without it, and the stoken check plus acknowledgement by id keep that correct.

- A killed tab's locks are released by the browser.
- A frozen tab can keep its lock. Its timers are frozen too, so it never times out by itself; `LOCK_PATIENCE` and `steal` cover it.
- A tab whose lock is stolen keeps running its push. That is an overlapping push, which is safe.

No BroadcastChannel: the `storage` event already tells other tabs about every entry added or removed, and a channel would add a second signal with no extra guarantee.

### Done

```
markComplete():
  target = ids of every pending entry now (legacy queue adopted first)
  request a flush, joining one in flight
  if a joined flush hasn't settled after JOIN_GRACE: start an own attempt, stealing the lock
  own attempt fails or times out: throw, don't mark complete
  when no target id is left in the outbox: sync.markComplete
```

Done waits on a condition of the outbox, not on a particular push. Any tab's acknowledgement satisfies it. Its wait on someone else's push is bounded by `JOIN_GRACE`, and its own push by `PUSH_TIMEOUT`.

Initial values: `PUSH_TIMEOUT` 20 s, `JOIN_GRACE` 2 s, `LOCK_PATIENCE` 45 s.

## Acknowledgement

Two sources, both by identity:

- **Push response.** An accepted push removes exactly the ids it sent. Entries added or superseded during the push are untouched (races 1 to 3).
- **Journal.** An entry whose op string appears in entries received from the server is committed, and is removed. This runs wherever own entries arrive: a push rejection, hydration (`self-journal.ts`, `sync.selfJournal`), and the live stream (`sync.onSelfJournalChange`), in each case after `assertKeyOpens` and before the merge reads the pending keys. It applies only to unique ops ([Operation identity](#operation-identity)).

Journal acknowledgement is what makes a lost response safe. The stoken wasn't saved, so the resend is rejected; the rejection lists the committed ops; they are dropped, not appended again over a newer value. It also absorbs overlapping pushes: the loser's rejection contains the winner's ops, and its retry has nothing left to send.

## Rejection and key verification

The steps from [sync.md § Key verification](sync.md#key-verification) keep their order inside `attempt()`:

- An unproven key sends a null stoken, on the first attempt and the retry alike (the rule in step 2 is re-evaluated; `assertKeyOpens` proves the key before the retry).
- `assertKeyOpens` runs on a rejection's entries before anything is removed, saved, or merged. On `WrongKeyError` the outbox and stoken are untouched, the flusher stops re-arming, and the error reaches the boundary through the hook, as `useSyncQueue` and `useMarkComplete` do today.
- The merge uses the pending ops as they are at merge time, after committed entries have been dropped, so a key whose pending op turned out to be committed takes the server's later value.
- The stoken is saved after the removals it covers (invariant 5).

## Progress

Progress is sealed immediately before each attempt and again before the retry, from the `answers` snapshot. Autosync sends it; Done sends none. The server writes it only on an accepted push (`SyncStore.push`). An edit made between sealing and sending creates an entry, so a later push carries the corrected count. When journal acknowledgement empties the outbox, no push follows; the push that committed those ops carried whatever progress its sender had.

## Failure modes

| Failure | Behaviour |
|-|-|
| Push stalls | Aborted after `PUSH_TIMEOUT`. The outcome is unknown, so its entries stay. The next attempt is either accepted (it hadn't committed) or rejected and acknowledged from the journal (it had). |
| Push stalls while Done is tapped | Done starts its own push after `JOIN_GRACE`. |
| Tab killed mid-push | Entries stay in storage. Any tab, or the next load, sends them; the same accepted-or-acknowledged outcome applies. |
| Tab killed between removing entries and saving the stoken | The stoken is stale. The next push is rejected once, merges, and retries. |
| Lock holder frozen | Other tabs steal after `LOCK_PATIENCE`; Done after `JOIN_GRACE`. |
| Offline | Attempts fail and entries accumulate. Autosync re-arms on the next enqueue, as today. Done throws. |
| Storage quota on enqueue | `setItem` throws before anything is removed. The entry is held in the tab's memory, included in this tab's pushes, and written when a later acknowledgement frees space. The UI says the answer isn't saved on this device yet. Today the throw escapes `commitAnswer` after `setAnswer` has run, and the answer is silently overwritten by the next hydration. |
| `p:1:` op without `n`, response lost | Resent, as on `main`: a duplicate journal entry, and a stale value if another device wrote the key in between. |
| Rollback to the previous client | Entries under `outbox:*` are invisible to old code. See [Rollout](#rollout). |

## Rejected alternatives

| Approach | Why not |
|-|-|
| Clear by value: remove one queued copy of each sent string | The queue length doesn't change, so a length-keyed scheduler never pushes the surviving edit. A fresh `p:1:` edit with the same bytes as a sent op is cleared with it. |
| Hold the in-flight prefix, then drain by count | Fixes race 1 and makes batches longer, so a delayed cross-tab count drain (race 3) removes more unsent ops. Overlapping holds have no clear owner. |
| Serialize flushes with a promise chain | A stalled push with no timeout blocks Done indefinitely. Serialization is also per tab, so races 3 and 4 remain. |
| Clear only if the sent ops are still the queue's prefix | After another tab rewrites the queue, acknowledged ops stay queued and a later flush replays them over a newer edit from another device. |
| Keep one array, guard every mutation with a Web Lock | Enqueue becomes asynchronous and blocks behind a frozen holder. Browsers without the API need the unguarded path anyway, so the races stay reachable. |
| Match plaintext ops against the journal without a nonce | Identical bytes aren't identity. An older commit of the same value can acknowledge a newer, unsent edit while a different value is still in flight. |
| Server idempotency (client op ids stored with journal entries) | Exact, but an API and schema change. The stoken check plus journal acknowledgement give the same result from the client. Worth revisiting only if the journal should refuse duplicates on its own. |
| IndexedDB | Transactions make read-modify-write atomic, but every enqueue becomes asynchronous and the rest of the local state stays in localStorage. Per-entry keys get atomicity without it. |
| BroadcastChannel leader election | Needs heartbeats to detect a dead leader. Web Locks release on tab death, and nothing here needs a leader for safety. |

## Test plan

Unit tests run against an in-memory `localStorage`; two "tabs" are two module instances over the same store.

| Tier | Case | Covers |
|-|-|-|
| unit, store | Enqueue during a held push, then acknowledge: the edit survives and the server-bound batch didn't contain it | race 1 |
| unit, store | Same-length replacement changes the newest id | scheduler |
| unit, store | Two tabs enqueue interleaved at every step: both entries exist; same key: exactly one survives | race 4 |
| unit, store | Tab A acknowledges ids while tab B has added and removed entries: only A's ids go | race 3 |
| unit, store | Unknown `v` is kept and skipped; corrupt entry is removed; quota error keeps the older entry and holds the new one in memory | failure modes |
| unit, migration | Legacy `string[]` is read as pending before any push, adopted in order at send, `pendingOps` emptied; two tabs adopting produce one copy | migration |
| unit, migration | A port of `main`'s `addPendingOpForKey` / `drainPendingOps` runs as the "old tab" against the new flusher for each row of the mixed-version table | mixed versions |
| unit, flush | Autosync and Done requested together: one push, both resolve | race 2 |
| unit, flush | Push never settles: Done starts its own after `JOIN_GRACE`; the stalled one aborts at `PUSH_TIMEOUT` | stalled push |
| unit, flush | Stoken is read before entries and after `getProgress` resolves; the retry sends the current outbox, not the first batch | invariant 4 |
| unit, flush | Accepted: ids removed before `setStoken`. Rejected: `assertKeyOpens`, removals, `setStoken`, merge, in that order | invariant 5 |
| unit, flush | Existing key-verification cases in `sync-flush.test.ts` keep their assertions: null stoken while unproven, `WrongKeyError` saves nothing, merge sees the current outbox, no progress without an accepted push | key verification |
| unit, flush | Response lost after commit, another device then writes the key: the resend is rejected, the entry is dropped, the newer value stands. For `e:1:` and for `p:1:` with `n`; `p:1:` without `n` is resent | lost response |
| unit, flush | An older identical-value commit doesn't acknowledge a newer `p:1:` entry | operation identity |
| unit, lock | Lock unavailable: no push, re-arm; steal after `LOCK_PATIENCE`; no `navigator.locks`: push anyway | cross-tab |
| integration | Two concurrent `sync.push` calls with the same stoken: exactly one accepted, the other's rejection starts with the winner's ops | races 2, 3 |
| integration | Null stoken against a non-empty journal is rejected with the full journal; a rejected push writes no progress | key verification |
| e2e | Hold `sync.push` with a route handler, edit the same note, release: a fresh context shows the edit | race 1 |
| e2e | Hold autosync's push, tap Done: lands on `/waiting`, partner's results include every answer | race 2, stalled push |
| e2e | Two pages, one context: A's push held, B answers and syncs, release A: a fresh context has every answer from both | race 3 |
| e2e | Two pages answer different questions at the same moment: both reach the server | race 4 |
| e2e | Let the request through and drop the response, change the answer from a second context, reload: the second context's value stands | lost response |
| e2e | Seed a legacy `pendingOps` array with `scopedSet`, load: ops reach the server, `pendingOps` is empty | migration |

E2E cases run for `encrypted` in `[false, true]`. `pending-ops-dedup.spec.ts` and `sync-conflict.spec.ts` switch from `pendingOps` to the outbox helpers.

## Rollout

1. **Owner decisions** below, then amend `CLAUDE.md` (§ Storage, § Graceful local data migrations) and [sync.md](sync.md) (§ Client logic, § Client Local Storage) in the implementing change.
2. **Change 1, `fix(web)`:** the entry store, legacy reader and adoption, the flusher with push timeout, acknowledgement by id and by journal, Done. Fixes races 1 to 4 without Web Locks.
3. **Change 2, `perf(web)`:** the Web Lock. Optional; only removes duplicate pushes when several tabs are open.
4. **Watch** `syncPushCounter{result="conflict"}` (`trpc/routes/sync.ts`). Overlapping pushes now resolve as conflicts, so a small rise after change 1 is expected and should fall after change 2.
5. **Roll forward, not back.** Old code can't see `outbox:*`, so reverting strands whatever is queued at that moment, and the next hydration overwrites those answers locally. A revert build must carry a shim that moves outbox entries back into `pendingOps`.

## Open questions

1. **Storage format.** Is one key per entry, with `pendingOps` kept as a permanent legacy inbox, acceptable as the documented exception to the opaque-strings rule?
2. **Nonce in plaintext ops.** Add the optional `n` to `OperationPayload` (shared schema, additive)? Without it, plaintext groups keep today's duplicate-and-possible-stale-replay after a lost response. Recommended: yes.
3. **Cleartext answer key beside encrypted ops.** Acceptable given the `answers` snapshot is already cleartext on the device? Without it, dedup in encrypted groups stays per tab and is lost on reload.
4. **Web Locks.** Ship as change 2, or leave out and accept one rejected round-trip per enqueue when several tabs are open?
5. **Done when the push fails.** Keep today's behaviour (the tap throws and nothing is marked), or show an explicit "couldn't sync" state?
6. **Rollback.** Is roll-forward-only acceptable, or should a release that only knows how to drain `outbox:*` back into `pendingOps` ship first?
7. **Timeouts.** Are 20 s / 2 s / 45 s reasonable on the connections this is used on?
