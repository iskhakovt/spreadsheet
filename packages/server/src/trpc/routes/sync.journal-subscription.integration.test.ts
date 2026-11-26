import { fakeEncrypted, type OperationPayload, plainOp, plainSealed } from "@spreadsheet/shared";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Transaction } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { journalEventName, journalEvents } from "../../events.js";
import { QuestionStore } from "../../store/questions.js";
import { SyncStore } from "../../store/sync.js";
import { anonCtx, authedCtx, createCaller, defaultCreate, tokenCtx } from "../../test/factories.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  ({ db } = createDatabase(url));
  await seed(new QuestionStore(db));
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE journal_entries, persons, groups CASCADE`);
});

afterEach(() => {
  journalEvents.removeAllListeners();
});

/**
 * Opens a subscription with a real AbortController. Returns a cancellable
 * handle: `next(timeoutMs)` waits for the next yield (or undefined on
 * timeout), `cancel()` aborts the underlying signal.
 */
async function openSubscription<T>(
  factory: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
): Promise<{ next: (timeoutMs: number) => Promise<T | undefined>; cancel: () => void }> {
  const ac = new AbortController();
  const iterable = await factory(ac.signal);
  const it = iterable[Symbol.asyncIterator]();
  return {
    next(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout>;
      return Promise.race<T | undefined>([
        it.next().then((r) => {
          clearTimeout(timer);
          return r.done ? undefined : r.value;
        }),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
        }),
      ]);
    },
    cancel() {
      ac.abort();
    },
  };
}

async function setupCompletedPair() {
  const caller = createCaller(anonCtx(db));
  const { adminToken } = await caller.groups.create(defaultCreate());
  const { partnerTokens } = await caller.groups.setupAdmin({
    adminToken,
    name: plainSealed("Alice"),
    anatomy: null,
    partners: [{ name: plainSealed("Bob"), anatomy: null }],
  });
  const bobToken = partnerTokens[0];

  const aliceStatus0 = await createCaller(tokenCtx(db, adminToken)).groups.status();
  const aliceCaller0 = createCaller(authedCtx(db, aliceStatus0!, adminToken));
  const bobStatus0 = await createCaller(tokenCtx(db, bobToken)).groups.status();
  const bobCaller0 = createCaller(authedCtx(db, bobStatus0!, bobToken));

  // Each pushes one journal entry, then both mark complete.
  const alicePush = await aliceCaller0.sync.push({
    stoken: null,
    operations: [plainOp("oral:give", { rating: "yes", note: null })],
    progress: undefined,
  });
  const bobPush = await bobCaller0.sync.push({
    stoken: null,
    operations: [plainOp("oral:receive", { rating: "yes", note: null })],
    progress: undefined,
  });

  await aliceCaller0.sync.markComplete();
  await bobCaller0.sync.markComplete();

  // Re-read status so `isCompleted` is reflected in the contexts used for
  // opening the journal subscription (whose precondition checks allComplete).
  const aliceStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
  const bobStatus = await createCaller(tokenCtx(db, bobToken)).groups.status();

  return {
    alice: {
      token: adminToken,
      status: aliceStatus!,
      ctx: authedCtx(db, aliceStatus!, adminToken),
      caller: createCaller(authedCtx(db, aliceStatus!, adminToken)),
      stoken: alicePush.stoken,
    },
    bob: {
      token: bobToken,
      status: bobStatus!,
      ctx: authedCtx(db, bobStatus!, bobToken),
      caller: createCaller(authedCtx(db, bobStatus!, bobToken)),
      stoken: bobPush.stoken,
    },
  };
}

/**
 * A `Database` whose transactions run every statement, then hold before
 * COMMIT until `release()`. `reached` resolves once one is held.
 */
function holdCommit(inner: Database) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const held = {
    transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
      inner.transaction(async (tx) => {
        const result = await fn(tx);
        markReached();
        await released;
        return result;
      }),
  } as unknown as Database;
  return { db: held, reached, release };
}

/** Resolves once some backend in this database waits on a lock; stops on `signal`. */
async function lockWaiter(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const rows = await db.execute(
      sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function journalSub(ctx: ReturnType<typeof authedCtx>, lastEventId?: string | null) {
  return (signal: AbortSignal) =>
    createCaller(ctx, { signal }).sync.onJournalChange({ lastEventId: lastEventId ?? null });
}

/**
 * tRPC's `tracked(id, data)` returns a branded tuple `[id, data, symbol]`.
 * When yielded from an async generator and iterated by `createCaller`, the
 * consumer sees this tuple directly — it's the SSE adapter that unwraps
 * to `{ id, data }` for the wire format. These helpers destructure the tuple
 * back into a usable shape for the integration tests.
 */
type JournalEntry = { id: string; personId: string; operation: string };
type TrackedMessage = { entries: JournalEntry[] };

function unwrap(yielded: unknown): TrackedMessage {
  if (!Array.isArray(yielded)) {
    throw new Error(`Expected tracked tuple, got ${typeof yielded}: ${JSON.stringify(yielded)}`);
  }
  return yielded[1] as TrackedMessage;
}

function trackedId(yielded: unknown): string {
  if (!Array.isArray(yielded)) throw new Error("Expected tracked tuple");
  return yielded[0] as string;
}

describe("sync.onJournalChange subscription (real Postgres)", () => {
  it("yields all existing entries as a single tracked event on fresh subscribe", async () => {
    const { alice } = await setupCompletedPair();

    const sub = await openSubscription(journalSub(alice.ctx));
    const first = await sub.next(1000);
    sub.cancel();

    expect(first).toBeDefined();
    const msg = unwrap(first);
    expect(msg.entries).toHaveLength(2);
    // tracked event id is the last entry's (opaque) id
    expect(trackedId(first)).toBe(msg.entries[msg.entries.length - 1].id);
  });

  it("yields an append tracked event after sync.push commits a new entry", async () => {
    const { alice } = await setupCompletedPair();

    const sub = await openSubscription(journalSub(alice.ctx));
    await sub.next(1000); // initial backfill

    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [plainOp("oral:give", { rating: "no", note: null })],
      progress: undefined,
    });

    const append = await sub.next(2000);
    sub.cancel();

    expect(append).toBeDefined();
    const msg = unwrap(append);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].personId).toBe(alice.status.person?.id);
  });

  it("resume with lastEventId returns only entries with id > cursor", async () => {
    const { alice } = await setupCompletedPair();

    // Initial subscribe and capture the backfill cursor
    const sub1 = await openSubscription(journalSub(alice.ctx));
    const firstYield = await sub1.next(1000);
    sub1.cancel();
    const initialMsg = unwrap(firstYield);
    const initialCursor = initialMsg.entries[initialMsg.entries.length - 1].id;

    // Alice pushes another entry while nobody's subscribed
    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [plainOp("oral:give", { rating: "no", note: null })],
      progress: undefined,
    });

    // Fresh subscribe WITH the cursor — should only see the new entry
    const sub2 = await openSubscription(journalSub(alice.ctx, initialCursor));
    const delta = await sub2.next(1000);
    sub2.cancel();

    expect(delta).toBeDefined();
    const deltaMsg = unwrap(delta);
    expect(deltaMsg.entries).toHaveLength(1);
    expect(deltaMsg.entries[0].id).not.toBe(initialCursor);
    // Ids are opaque, so prove "only newer" by content: the delta is
    // exactly the entry pushed after the cursor.
    expect(deltaMsg.entries[0].operation).toBe(plainOp("oral:give", { rating: "no", note: null }));
  });

  it("resume with lastEventId past the last id yields only fresh entries when they arrive", async () => {
    const { alice } = await setupCompletedPair();

    // Initial subscribe to learn the current cursor
    const sub1 = await openSubscription(journalSub(alice.ctx));
    const firstYield = await sub1.next(1000);
    sub1.cancel();
    const currentMsg = unwrap(firstYield);
    const currentCursor = currentMsg.entries[currentMsg.entries.length - 1].id;

    // Push BEFORE opening sub2 — the new entry's id will be > currentCursor,
    // so the resume backfill from sub2 should include exactly that one.
    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [plainOp("oral:give", { rating: "maybe", note: null })],
      progress: undefined,
    });

    // Fresh subscribe with the old cursor — backfill should include the new entry
    const sub2 = await openSubscription(journalSub(alice.ctx, currentCursor));
    const delta = await sub2.next(1000);
    sub2.cancel();

    expect(delta).toBeDefined();
    const msg = unwrap(delta);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].id).not.toBe(currentCursor);
    expect(msg.entries[0].operation).toBe(plainOp("oral:give", { rating: "maybe", note: null }));
  });

  it("two concurrent subscribers both receive the same push", async () => {
    const { alice, bob } = await setupCompletedPair();

    const aSub = await openSubscription(journalSub(alice.ctx));
    const bSub = await openSubscription(journalSub(bob.ctx));

    await aSub.next(1000); // drain initial
    await bSub.next(1000);

    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [plainOp("oral:give", { rating: "no", note: null })],
      progress: undefined,
    });

    const aAppend = await aSub.next(1000);
    const bAppend = await bSub.next(1000);
    aSub.cancel();
    bSub.cancel();

    expect(aAppend).toBeDefined();
    expect(bAppend).toBeDefined();
    expect(unwrap(aAppend).entries).toHaveLength(1);
    expect(unwrap(bAppend).entries).toHaveLength(1);
  });

  it("subscribe-before-query invariant: emit during backfill is delivered", async () => {
    const { alice } = await setupCompletedPair();

    // Start a subscribe and INTERLEAVE a push with the backfill window.
    // We can't directly instrument the resolver's internal ordering, so we
    // exercise it via the contract: if a new entry is committed between
    // subscribe and first yield, the subscriber must still see it.
    const sub = await openSubscription(journalSub(alice.ctx));

    // Commit a new entry immediately — this simulates a race where the push
    // lands before the subscriber has received the initial backfill. Use a
    // uniquely-identifiable operation payload so we can find it in the
    // collected stream even amongst the 2 initial entries from setup.
    const racingOp = plainOp("oral:give", { rating: "maybe", note: null });
    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [racingOp],
      progress: undefined,
    });

    // Drain at most 3 yields within 1s. The racing entry MUST appear
    // somewhere in the collected stream — either as part of the backfill
    // (if the server's query saw it) or as a live append (if the iterable
    // buffered it). Losing it would indicate the invariant was violated.
    const collected: JournalEntry[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await sub.next(500);
      if (!next) break;
      collected.push(...unwrap(next).entries);
    }
    sub.cancel();

    // Strict: the specific racing entry must be present, not just "enough"
    // entries. Otherwise a bug that dropped the racing event while keeping
    // the 2 initial entries + some other 3rd entry would slip by.
    const found = collected.find((e) => e.operation === racingOp);
    expect(found, `racing entry not delivered (collected ${collected.length} entries)`).toBeDefined();
  });

  it("delivers both members' concurrent pushes, even when the lower id would commit last", async () => {
    // Postgres takes a journal id at INSERT but shows the row at COMMIT. If
    // Bob's push (higher id) could commit while Alice's (lower id) is still
    // open, the stream's cursor would pass Alice's id before her entry exists.
    const { alice, bob } = await setupCompletedPair();
    const sub = await openSubscription(journalSub(alice.ctx));
    await sub.next(1000); // drain the backfill

    const aliceOp = plainOp("oral:give", { rating: "no", note: null });
    const bobOp = plainOp("oral:receive", { rating: "no", note: null });

    // Alice's real push, held after its last statement: her entry has its id but isn't committed.
    const held = holdCommit(db);
    const alicePush = createCaller({ ...alice.ctx, sync: new SyncStore(held.db) }).sync.push({
      stoken: alice.stoken,
      operations: [aliceOp],
    });
    alicePush.catch(() => {}); // settled in `finally`; this only keeps it from going unhandled
    let bobPush: Promise<unknown> | undefined;
    let bobFirst: string | undefined;
    const stopPolling = new AbortController();
    try {
      // Surfaces the push's own error if it fails before it's held.
      await Promise.race([held.reached, alicePush]);
      bobPush = bob.caller.sync.push({ stoken: bob.stoken, operations: [bobOp] });
      bobPush.catch(() => {});
      bobFirst = await Promise.race([
        bobPush.then(() => "committed"),
        lockWaiter(stopPolling.signal).then(() => "waiting"),
      ]);
    } finally {
      // Never leave the transaction open: it would block the next test's TRUNCATE.
      stopPolling.abort();
      held.release();
      await Promise.allSettled([alicePush, bobPush]);
    }
    await alicePush;
    await bobPush;

    const delivered: string[] = [];
    while (delivered.length < 2) {
      const next = await sub.next(1000);
      if (!next) break;
      delivered.push(...unwrap(next).entries.map((e) => e.operation));
    }
    sub.cancel();

    expect(delivered).toEqual([aliceOp, bobOp]);
    // Why: Bob's push waited for Alice's to commit instead of committing first.
    expect(bobFirst).toBe("waiting");
  });

  it("throws PRECONDITION_FAILED when not all members are complete", async () => {
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create(defaultCreate());
    await caller.groups.setupAdmin({
      adminToken,
      name: plainSealed("Alice"),
      anatomy: null,
      partners: [{ name: plainSealed("Bob"), anatomy: null }],
    });

    const aliceStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
    const aliceCtx = authedCtx(db, aliceStatus!, adminToken);

    await expect(async () => {
      const iter = await createCaller(aliceCtx).sync.onJournalChange({ lastEventId: null });
      const it = iter[Symbol.asyncIterator]();
      await it.next();
    }).rejects.toThrow(/All group members must mark complete/);
  });

  it("rejects subscribers without an auth token", async () => {
    const caller = createCaller(anonCtx(db));
    await expect(async () => {
      const iter = await caller.sync.onJournalChange({ lastEventId: null });
      const it = iter[Symbol.asyncIterator]();
      await it.next();
    }).rejects.toThrow(/Invalid or missing person token/);
  });

  it("registers a journal listener while active and removes it on cancel", async () => {
    const { alice } = await setupCompletedPair();
    const eventKey = journalEventName(alice.status.group.id);

    const before = journalEvents.listenerCount(eventKey);

    const sub = await openSubscription(journalSub(alice.ctx));
    await sub.next(1000); // drain initial — the `on()` listener is now attached

    const during = journalEvents.listenerCount(eventKey);
    expect(during).toBeGreaterThan(before);

    sub.cancel();

    // Poll via `expect.poll` instead of a fixed `setTimeout(50)`. Vitest's
    // primitive retries the assertion, short-circuits on first match
    // (zero overhead if cleanup already ran), and surfaces the actual
    // observed values in the failure message — strictly better than both
    // a fixed sleep (which guesses at CI timing) and a hand-rolled while
    // loop (which reinvents the primitive with worse error reporting).
    await expect.poll(() => journalEvents.listenerCount(eventKey)).toBe(before);
  });

  it("delivers encrypted entries as-is (server does not decrypt)", async () => {
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create(defaultCreate({ encrypted: true }));
    await caller.groups.setupAdmin({
      adminToken,
      name: fakeEncrypted("encryptedAlice"),
      anatomy: null,
      partners: [],
    });

    const status = await createCaller(tokenCtx(db, adminToken)).groups.status();
    const ctx = authedCtx(db, status!, adminToken);
    const aliceCaller = createCaller(ctx);

    const opaqueBlob = fakeEncrypted<OperationPayload>("someEncryptedJournalBlob");
    await aliceCaller.sync.push({
      stoken: null,
      operations: [opaqueBlob],
      progress: undefined,
    });
    await aliceCaller.sync.markComplete();

    // Re-read status after markComplete so the subscription ctx sees completion
    const updatedStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
    const updatedCtx = authedCtx(db, updatedStatus!, adminToken);

    const sub = await openSubscription(journalSub(updatedCtx));
    const first = await sub.next(1000);
    sub.cancel();

    expect(first).toBeDefined();
    const msg = unwrap(first);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].operation).toBe(opaqueBlob);
  });
});
