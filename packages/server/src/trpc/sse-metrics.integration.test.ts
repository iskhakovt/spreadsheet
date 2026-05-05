import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/index.js";
import { seed } from "../db/seed.js";
import { sseConnectionsGauge } from "../metrics.js";
import { QuestionStore } from "../store/questions.js";
import { anonCtx, authedCtx, createCaller, defaultCreate, tokenCtx } from "../test/factories.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  ({ db } = createDatabase(url));
  await seed(new QuestionStore(db));
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE journal_entries, persons, groups CASCADE`);
  // Reset the gauge so other test files don't leave leftover values that
  // break exact-equality assertions here.
  sseConnectionsGauge.reset();
});

async function gaugeValue(procedure: string): Promise<number> {
  const data = await sseConnectionsGauge.get();
  return data.values.find((v) => v.labels.procedure === procedure)?.value ?? 0;
}

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

async function makeAlice() {
  const caller = createCaller(anonCtx(db));
  const { adminToken } = await caller.groups.create(defaultCreate());
  await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [{ name: "Bob", anatomy: null }],
  });
  const status = await createCaller(tokenCtx(db, adminToken)).groups.status();
  return { token: adminToken, ctx: authedCtx(db, status!, adminToken) };
}

describe("sse_connections_active gauge", () => {
  it("increments on subscription open and decrements on cancel", async () => {
    const alice = await makeAlice();
    expect(await gaugeValue("groups.onStatus")).toBe(0);

    const sub = await openSubscription((signal) =>
      Promise.resolve(createCaller(alice.ctx, { signal }).groups.onStatus()),
    );
    // Pull one yield to confirm the wrap didn't break the stream.
    await sub.next(1_000);
    expect(await gaugeValue("groups.onStatus")).toBe(1);

    sub.cancel();
    // The middleware listens on `signal.abort` directly, so dec is
    // synchronous on cancel — one microtask is enough for the event
    // dispatch to settle.
    await new Promise((r) => setImmediate(r));
    expect(await gaugeValue("groups.onStatus")).toBe(0);
  });

  it("labels are independent per procedure", async () => {
    const alice = await makeAlice();

    const statusSub = await openSubscription((signal) =>
      Promise.resolve(createCaller(alice.ctx, { signal }).groups.onStatus()),
    );
    await statusSub.next(1_000);

    const selfJournalSub = await openSubscription((signal) =>
      Promise.resolve(createCaller(alice.ctx, { signal }).sync.onSelfJournalChange()),
    );
    await selfJournalSub.next(1_000);

    expect(await gaugeValue("groups.onStatus")).toBe(1);
    expect(await gaugeValue("sync.onSelfJournalChange")).toBe(1);
    expect(await gaugeValue("sync.onJournalChange")).toBe(0);

    statusSub.cancel();
    selfJournalSub.cancel();
    await new Promise((r) => setImmediate(r));
    expect(await gaugeValue("groups.onStatus")).toBe(0);
    expect(await gaugeValue("sync.onSelfJournalChange")).toBe(0);
  });
});
