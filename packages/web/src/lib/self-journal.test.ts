/** @vitest-environment happy-dom */
import type { Answer } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeValue } from "./crypto.js";
import { applySelfJournalDelta } from "./self-journal.js";
import { adoptSession } from "./session.js";
import { addPendingOpForKey, clearPendingOps, getSelfJournalCursor, setSelfJournalCursor } from "./storage.js";

const token = "test-token-" + Math.random().toString(36).slice(2);
const yes: Answer = { rating: "yes", note: null };
const no: Answer = { rating: "no", note: null };
const maybe: Answer = { rating: "maybe", note: null };

async function plainOp(key: string, data: Answer | null): Promise<string> {
  return encodeValue({ key, data }, null);
}

beforeEach(() => {
  adoptSession(token);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("getSelfJournalCursor / setSelfJournalCursor", () => {
  it("returns null on a fresh device", () => {
    expect(getSelfJournalCursor()).toBe(null);
  });

  it("round-trips a numeric cursor", () => {
    setSelfJournalCursor(42);
    expect(getSelfJournalCursor()).toBe(42);
  });

  it("clears the cursor when set to null", () => {
    setSelfJournalCursor(42);
    setSelfJournalCursor(null);
    expect(getSelfJournalCursor()).toBe(null);
  });

  it("treats malformed cursor values as absent", () => {
    localStorage.setItem(`s${"x".repeat(8)}:selfJournalCursor`, "not-a-number");
    expect(getSelfJournalCursor()).toBe(null);
  });
});

describe("applySelfJournalDelta", () => {
  it("returns prev unchanged on empty delta", async () => {
    const prev = { "a:mutual": yes };
    const next = await applySelfJournalDelta(prev, []);
    expect(next).toBe(prev);
  });

  it("bootstrap: empty prev + entries → server state", async () => {
    const entries = [
      { id: 1, personId: "p", operation: await plainOp("a:mutual", yes) },
      { id: 2, personId: "p", operation: await plainOp("b:give", no) },
    ];
    const next = await applySelfJournalDelta({}, entries);
    expect(next).toEqual({ "a:mutual": yes, "b:give": no });
  });

  it("server values overwrite prev for keys not in the outbox", async () => {
    const prev = { "a:mutual": no };
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", yes) }];
    clearPendingOps();
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
  });

  it("outbox wins for keys with a pending op", async () => {
    const prev = { "a:mutual": maybe };
    addPendingOpForKey(await plainOp("a:mutual", maybe), "a:mutual");
    // Server says "yes", but pending op says "maybe" — pending wins because
    // the user's local edit hasn't reached the server yet.
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", yes) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(maybe);
  });

  it("server-side null deletes do NOT propagate via the delta merge", async () => {
    // Documenting a known limitation of mergeAfterRejection: it iterates
    // server-state keys, so a "deleted" key (replayJournal removed it) is
    // simply absent from the server-state map and the merge leaves prev
    // alone. Acceptable today because the UI has no "unset" affordance —
    // null operations only appear in legacy journals. The bootstrap path
    // (prev empty) is unaffected.
    const prev = { "a:mutual": yes };
    clearPendingOps();
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", null) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
  });

  it("preserves prev values for keys not touched by the delta", async () => {
    const prev = { "a:mutual": yes, "c:give": no };
    const entries = [{ id: 1, personId: "p", operation: await plainOp("b:mutual", maybe) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
    expect(next["c:give"]).toEqual(no);
    expect(next["b:mutual"]).toEqual(maybe);
  });
});
