import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { groupEvents } from "../../events.js";
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
  groupEvents.removeAllListeners();
});

/**
 * Opens a subscription with a real AbortController. Returns a cancellable
 * handle: `next(timeoutMs)` waits for the next yield (or undefined on
 * timeout), `cancel()` aborts the underlying signal which terminates the
 * generator's `on(emitter, evt, { signal })` cleanly.
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

async function setupAliceAndBob() {
  const caller = createCaller(anonCtx(db));
  const { adminToken } = await caller.groups.create(defaultCreate());
  const { partnerTokens } = await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [{ name: "Bob", anatomy: null }],
  });
  const bobToken = partnerTokens[0];

  const aliceStatus = await caller.groups.status({ token: adminToken });
  const bobStatus = await caller.groups.status({ token: bobToken });

  return {
    alice: {
      token: adminToken,
      status: aliceStatus!,
      ctx: authedCtx(db, aliceStatus!, adminToken),
      caller: createCaller(authedCtx(db, aliceStatus!, adminToken)),
    },
    bob: {
      token: bobToken,
      status: bobStatus!,
      ctx: authedCtx(db, bobStatus!, bobToken),
      caller: createCaller(authedCtx(db, bobStatus!, bobToken)),
    },
  };
}

// Builds a fresh caller with the supplied signal and opens a subscription.
function aliceSub(ctx: ReturnType<typeof authedCtx>) {
  return (signal: AbortSignal) => createCaller(ctx, { signal }).groups.onStatus();
}

describe("groups.onStatus subscription (real Postgres)", () => {
  it("yields the current status immediately on subscribe", async () => {
    const { alice } = await setupAliceAndBob();

    const sub = await openSubscription(aliceSub(alice.ctx));
    const first = await sub.next(1000);
    sub.cancel();

    expect(first).toBeDefined();
    expect(first?.person?.name).toBe("Alice");
    expect(first?.members).toHaveLength(2);
  });

  it("yields again after caller.sync.markComplete fires the broadcast", async () => {
    const { alice, bob } = await setupAliceAndBob();

    const sub = await openSubscription(aliceSub(alice.ctx));
    const initial = await sub.next(1000);
    expect(initial?.members.find((m) => m.name === "Bob")?.isCompleted).toBe(false);

    await bob.caller.sync.markComplete();
    const after = await sub.next(1000);
    sub.cancel();

    expect(after).toBeDefined();
    expect(after?.members.find((m) => m.name === "Bob")?.isCompleted).toBe(true);
  });

  it("yields again after groups.setProfile fires the broadcast", async () => {
    const { alice, bob } = await setupAliceAndBob();

    const sub = await openSubscription(aliceSub(alice.ctx));
    await sub.next(1000); // initial

    await bob.caller.groups.setProfile({ name: "Robert", anatomy: null });
    const after = await sub.next(1000);
    sub.cancel();

    expect(after?.members.find((m) => m.id === bob.status.person?.id)?.name).toBe("Robert");
  });

  it("yields different personalised status to each subscriber", async () => {
    const { alice, bob } = await setupAliceAndBob();

    const aSub = await openSubscription(aliceSub(alice.ctx));
    const bSub = await openSubscription(aliceSub(bob.ctx));

    const aliceFirst = await aSub.next(1000);
    const bobFirst = await bSub.next(1000);
    aSub.cancel();
    bSub.cancel();

    expect(aliceFirst?.person?.name).toBe("Alice");
    expect(bobFirst?.person?.name).toBe("Bob");
  });

  it("delivers a single broadcast to multiple group subscribers", async () => {
    const { alice, bob } = await setupAliceAndBob();

    const aSub = await openSubscription(aliceSub(alice.ctx));
    const bSub = await openSubscription(aliceSub(bob.ctx));

    // Drain initial yields
    await aSub.next(1000);
    await bSub.next(1000);

    // Alice marks complete — both should observe via the same broadcast
    await alice.caller.sync.markComplete();

    const aliceUpdate = await aSub.next(1000);
    const bobUpdate = await bSub.next(1000);
    aSub.cancel();
    bSub.cancel();

    expect(aliceUpdate?.members.find((m) => m.name === "Alice")?.isCompleted).toBe(true);
    expect(bobUpdate?.members.find((m) => m.name === "Alice")?.isCompleted).toBe(true);
  });

  it("does NOT yield when sync.push is called (push doesn't broadcast)", async () => {
    const { alice } = await setupAliceAndBob();

    const sub = await openSubscription(aliceSub(alice.ctx));
    await sub.next(1000); // initial

    await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: 'p:1:{"answered":1,"total":10}',
    });

    // Should NOT yield within 500ms
    const update = await sub.next(500);
    sub.cancel();
    expect(update).toBeUndefined();
  });

  it("delivers encrypted blobs unchanged for encrypted groups", async () => {
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create(defaultCreate({ encrypted: true }));
    await caller.groups.setupAdmin({
      adminToken,
      name: "e:1:encryptedAlice",
      anatomy: "e:1:encryptedAfab",
      partners: [],
    });

    const status = await caller.groups.status({ token: adminToken });
    const ctx = authedCtx(db, status!, adminToken);

    const sub = await openSubscription((signal) => createCaller(ctx, { signal }).groups.onStatus());
    const first = await sub.next(1000);
    sub.cancel();

    expect(first?.group.encrypted).toBe(true);
    expect(first?.person?.name).toBe("e:1:encryptedAlice");
    expect(first?.person?.anatomy).toBe("e:1:encryptedAfab");
  });

  it("rejects subscribers with no token (authed procedure)", async () => {
    const caller = createCaller(anonCtx(db));
    await expect(async () => {
      const iter = await caller.groups.onStatus();
      const it = iter[Symbol.asyncIterator]();
      await it.next();
    }).rejects.toThrow(/Invalid or missing person token/);
  });

  it("rejects subscribers with a token that doesn't resolve to a person", async () => {
    // This covers two cases:
    //   1. An admin token before `setupAdmin` has created the person row
    //      — the client must gate the subscription on `status.person` and
    //        not open it during the /setup window.
    //   2. A truly bogus token.
    const ctx = { ...anonCtx(db), personToken: "not-a-real-token" } as ReturnType<typeof anonCtx>;
    const caller = createCaller(ctx);
    await expect(async () => {
      const iter = await caller.groups.onStatus();
      const it = iter[Symbol.asyncIterator]();
      await it.next();
    }).rejects.toThrow(/Invalid or missing person token/);
  });

  it("registers a listener while the subscription is active and removes it on cancel", async () => {
    const { alice } = await setupAliceAndBob();
    const eventName = `group:${alice.status.group.id}`;

    const before = groupEvents.listenerCount(eventName);

    const sub = await openSubscription(aliceSub(alice.ctx));
    await sub.next(1000); // drain initial — by now `on()` has been called inside the generator

    const during = groupEvents.listenerCount(eventName);
    expect(during).toBeGreaterThan(before);

    sub.cancel();
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 50));

    const after = groupEvents.listenerCount(eventName);
    expect(after).toBe(before);
  });
});
