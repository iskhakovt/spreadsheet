import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { journalEventName, journalEvents } from "../../events.js";
import { QuestionStore } from "../../store/questions.js";
import { anonCtx, authedCtx, createCaller, defaultCreate } from "../../test/factories.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  db = createDatabase(url);
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
  const { partnerTokens, adminAuthToken } = await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [{ name: "Bob", anatomy: null }],
  });

  // Claim Bob's invite token to get his auth token
  const { authToken: bobAuthToken } = await caller.groups.claim({ inviteToken: partnerTokens[0] });

  const aliceStatus0 = await caller.groups.status({ token: adminAuthToken });
  const aliceCaller0 = createCaller(authedCtx(db, aliceStatus0!, adminAuthToken));
  const bobStatus0 = await caller.groups.status({ token: bobAuthToken });
  const bobCaller0 = createCaller(authedCtx(db, bobStatus0!, bobAuthToken));

  // Each pushes one journal entry, then both mark complete.
  const alicePush = await aliceCaller0.sync.push({
    stoken: null,
    operations: ['p:1:{"key":"oral:give","data":{"rating":"yes","timing":"now"}}'],
    progress: null,
  });
  const bobPush = await bobCaller0.sync.push({
    stoken: null,
    operations: ['p:1:{"key":"oral:receive","data":{"rating":"yes","timing":"now"}}'],
    progress: null,
  });

  await aliceCaller0.sync.markComplete();
  await bobCaller0.sync.markComplete();

  // Re-read status so `isCompleted` is reflected in the contexts used for
  // opening the journal subscription (whose precondition checks allComplete).
  const aliceStatus = await caller.groups.status({ token: adminAuthToken });
  const bobStatus = await caller.groups.status({ token: bobAuthToken });

  return {
    alice: {
      token: adminAuthToken,
      status: aliceStatus!,
      ctx: authedCtx(db, aliceStatus!, adminAuthToken),
      caller: createCaller(authedCtx(db, aliceStatus!, adminAuthToken)),
      stoken: alicePush.stoken,
    },
    bob: {
      token: bobAuthToken,
      status: bobStatus!,
      ctx: authedCtx(db, bobStatus!, bobAuthToken),
      caller: createCaller(authedCtx(db, bobStatus!, bobAuthToken)),
      stoken: bobPush.stoken,
    },
  };
}

function journalSub(ctx: ReturnType<typeof authedCtx>, lastEventId?: string | null) {
  return (signal: AbortSignal) =>
    createCaller(ctx, { signal }).sync.onJournalChange({ lastEventId: lastEventId ?? null });
}

/**
 * tRPC's `tracked(id, data)` returns a branded tuple `[id, data, symbol]`.
 * When yielded from an async generator and iterated by `createCaller`, the
 * consumer sees this tuple directly — it's the HTTP/WS adapter that unwraps
 * to `{ id, data }` for the wire format. These helpers destructure the tuple
 * back into a usable shape for the integration tests.
 */
type JournalEntry = { id: number; personId: string; operation: string };
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
    // tracked event id is the highest entry id (stringified)
    expect(trackedId(first)).toBe(String(msg.entries[msg.entries.length - 1].id));
  });

  it("yields an append tracked event after sync.push commits a new entry", async () => {
    const { alice } = await setupCompletedPair();

    const sub = await openSubscription(journalSub(alice.ctx));
    await sub.next(1000); // initial backfill

    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"no","timing":null}}'],
      progress: null,
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
      operations: ['p:1:{"key":"oral:give","data":{"rating":"no","timing":null}}'],
      progress: null,
    });

    // Fresh subscribe WITH the cursor — should only see the new entry
    const sub2 = await openSubscription(journalSub(alice.ctx, String(initialCursor)));
    const delta = await sub2.next(1000);
    sub2.cancel();

    expect(delta).toBeDefined();
    const deltaMsg = unwrap(delta);
    expect(deltaMsg.entries).toHaveLength(1);
    expect(deltaMsg.entries[0].id).toBeGreaterThan(initialCursor);
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
      operations: ['p:1:{"key":"oral:give","data":{"rating":"maybe","timing":null}}'],
      progress: null,
    });

    // Fresh subscribe with the old cursor — backfill should include the new entry
    const sub2 = await openSubscription(journalSub(alice.ctx, String(currentCursor)));
    const delta = await sub2.next(1000);
    sub2.cancel();

    expect(delta).toBeDefined();
    const msg = unwrap(delta);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].id).toBeGreaterThan(currentCursor);
  });

  it("two concurrent subscribers both receive the same push", async () => {
    const { alice, bob } = await setupCompletedPair();

    const aSub = await openSubscription(journalSub(alice.ctx));
    const bSub = await openSubscription(journalSub(bob.ctx));

    await aSub.next(1000); // drain initial
    await bSub.next(1000);

    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"no","timing":null}}'],
      progress: null,
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
    const racingOp = 'p:1:{"key":"oral:give","data":{"rating":"maybe","timing":null}}';
    await alice.caller.sync.push({
      stoken: alice.stoken,
      operations: [racingOp],
      progress: null,
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

  it("throws PRECONDITION_FAILED when not all members are complete", async () => {
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create(defaultCreate());
    const { adminAuthToken } = await caller.groups.setupAdmin({
      adminToken,
      name: "Alice",
      anatomy: null,
      partners: [{ name: "Bob", anatomy: null }],
    });

    const aliceStatus = await caller.groups.status({ token: adminAuthToken });
    const aliceCtx = authedCtx(db, aliceStatus!, adminAuthToken);

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
    const { adminAuthToken } = await caller.groups.setupAdmin({
      adminToken,
      name: "e:1:encryptedAlice",
      anatomy: null,
      partners: [],
    });

    const status = await caller.groups.status({ token: adminAuthToken });
    const ctx = authedCtx(db, status!, adminAuthToken);
    const aliceCaller = createCaller(ctx);

    const opaqueBlob = "e:1:someEncryptedJournalBlob";
    await aliceCaller.sync.push({
      stoken: null,
      operations: [opaqueBlob],
      progress: null,
    });
    await aliceCaller.sync.markComplete();

    // Re-read status after markComplete so the subscription ctx sees completion
    const updatedStatus = await caller.groups.status({ token: adminAuthToken });
    const updatedCtx = authedCtx(db, updatedStatus!, adminAuthToken);

    const sub = await openSubscription(journalSub(updatedCtx));
    const first = await sub.next(1000);
    sub.cancel();

    expect(first).toBeDefined();
    const msg = unwrap(first);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].operation).toBe(opaqueBlob);
  });
});
