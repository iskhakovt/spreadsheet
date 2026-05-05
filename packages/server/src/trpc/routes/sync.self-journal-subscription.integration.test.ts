import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { selfJournalEventName, selfJournalEvents } from "../../events.js";
import { QuestionStore } from "../../store/questions.js";
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
  selfJournalEvents.removeAllListeners();
});

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

async function setupPair() {
  const caller = createCaller(anonCtx(db));
  const { adminToken } = await caller.groups.create(defaultCreate());
  const { partnerTokens } = await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [{ name: "Bob", anatomy: null }],
  });
  const bobToken = partnerTokens[0];

  const aliceStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
  const aliceCtx = authedCtx(db, aliceStatus!, adminToken);
  const bobStatus = await createCaller(tokenCtx(db, bobToken)).groups.status();
  const bobCtx = authedCtx(db, bobStatus!, bobToken);

  return {
    alice: { token: adminToken, status: aliceStatus!, ctx: aliceCtx, caller: createCaller(aliceCtx) },
    bob: { token: bobToken, status: bobStatus!, ctx: bobCtx, caller: createCaller(bobCtx) },
  };
}

function selfSub(ctx: ReturnType<typeof authedCtx>, lastEventId?: string | null) {
  return (signal: AbortSignal) =>
    createCaller(ctx, { signal }).sync.onSelfJournalChange({ lastEventId: lastEventId ?? null });
}

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

describe("sync.onSelfJournalChange subscription (real Postgres)", () => {
  it("yields the caller's existing entries as a single tracked event on fresh subscribe", async () => {
    const { alice } = await setupPair();
    await alice.caller.sync.push({
      stoken: null,
      operations: [
        'p:1:{"key":"oral:give","data":{"rating":"yes"}}',
        'p:1:{"key":"blindfold:mutual","data":{"rating":"maybe"}}',
      ],
      progress: undefined,
    });

    const sub = await openSubscription(selfSub(alice.ctx));
    const first = await sub.next(1000);
    sub.cancel();

    expect(first).toBeDefined();
    const msg = unwrap(first);
    expect(msg.entries).toHaveLength(2);
    expect(trackedId(first)).toBe(String(msg.entries[1].id));
  });

  it("does not deliver another person's entries", async () => {
    const { alice, bob } = await setupPair();
    // Bob writes, alice subscribes — alice must NOT see bob's entry.
    await bob.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:receive","data":{"rating":"no"}}'],
      progress: undefined,
    });

    const aSub = await openSubscription(selfSub(alice.ctx));
    const aliceFirst = await aSub.next(500);
    aSub.cancel();

    // Backfill is yielded only when there are entries; alice has none, so the
    // generator stays in the live-stream loop and `next` times out.
    expect(aliceFirst).toBeUndefined();
  });

  it("delivers a live append after sync.push commits", async () => {
    const { alice } = await setupPair();

    const sub = await openSubscription(selfSub(alice.ctx));
    // Backfill is empty (no prior entries) — no initial yield, jump straight
    // to the live append.
    const pushResult = await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"yes"}}'],
      progress: undefined,
    });
    expect(pushResult.pushRejected).toBe(false);

    const append = await sub.next(2000);
    sub.cancel();

    expect(append).toBeDefined();
    const msg = unwrap(append);
    expect(msg.entries).toHaveLength(1);
    expect(msg.entries[0].personId).toBe(alice.status.person?.id);
  });

  it("delivers without an all-complete precondition", async () => {
    const { alice } = await setupPair();
    // Neither alice nor bob has marked complete — still works.
    expect(alice.status.person?.isCompleted).toBe(false);

    const sub = await openSubscription(selfSub(alice.ctx));
    await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"yes"}}'],
      progress: undefined,
    });

    const append = await sub.next(1000);
    sub.cancel();
    expect(append).toBeDefined();
    expect(unwrap(append).entries).toHaveLength(1);
  });

  it("resumes from lastEventId — only entries with id > cursor", async () => {
    const { alice } = await setupPair();
    const initialPush = await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"yes"}}'],
      progress: undefined,
    });

    // First subscribe to learn the cursor
    const sub1 = await openSubscription(selfSub(alice.ctx));
    const firstYield = await sub1.next(1000);
    sub1.cancel();
    const initialMsg = unwrap(firstYield);
    const initialCursor = initialMsg.entries[initialMsg.entries.length - 1].id;

    // Alice pushes another entry while nobody's subscribed
    await alice.caller.sync.push({
      stoken: initialPush.stoken,
      operations: ['p:1:{"key":"blindfold:mutual","data":{"rating":"no"}}'],
      progress: undefined,
    });

    // Resume with cursor — should only see the new entry
    const sub2 = await openSubscription(selfSub(alice.ctx, String(initialCursor)));
    const delta = await sub2.next(1000);
    sub2.cancel();

    expect(delta).toBeDefined();
    const deltaMsg = unwrap(delta);
    expect(deltaMsg.entries).toHaveLength(1);
    expect(deltaMsg.entries[0].id).toBeGreaterThan(initialCursor);
  });

  it("subscribe-before-query invariant: emit during backfill is delivered", async () => {
    const { alice } = await setupPair();
    // Seed one entry so the backfill query has something to do (creates a
    // larger window for a racing emit to slip through).
    const seedPush = await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"yes"}}'],
      progress: undefined,
    });

    const sub = await openSubscription(selfSub(alice.ctx));

    const racingOp = 'p:1:{"key":"blindfold:mutual","data":{"rating":"maybe"}}';
    await alice.caller.sync.push({
      stoken: seedPush.stoken,
      operations: [racingOp],
      progress: undefined,
    });

    const collected: JournalEntry[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await sub.next(500);
      if (!next) break;
      collected.push(...unwrap(next).entries);
    }
    sub.cancel();

    const found = collected.find((e) => e.operation === racingOp);
    expect(found, `racing entry not delivered (collected ${collected.length} entries)`).toBeDefined();
  });

  it("rejects subscribers without an auth token", async () => {
    const caller = createCaller(anonCtx(db));
    await expect(async () => {
      const iter = await caller.sync.onSelfJournalChange({ lastEventId: null });
      const it = iter[Symbol.asyncIterator]();
      await it.next();
    }).rejects.toThrow(/Invalid or missing person token/);
  });

  it("registers a self-journal listener while active and removes it on cancel", async () => {
    const { alice } = await setupPair();
    const eventKey = selfJournalEventName(alice.status.person!.id);
    const before = selfJournalEvents.listenerCount(eventKey);

    const sub = await openSubscription(selfSub(alice.ctx));
    // Force the generator to advance into the for-await loop — at this point
    // the listener is attached. We can't await `next()` without entries to
    // flush, so push one to flush the backfill yield.
    await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"oral:give","data":{"rating":"yes"}}'],
      progress: undefined,
    });
    await sub.next(1000);

    const during = selfJournalEvents.listenerCount(eventKey);
    expect(during).toBeGreaterThan(before);

    sub.cancel();

    await expect.poll(() => selfJournalEvents.listenerCount(eventKey)).toBe(before);
  });
});
