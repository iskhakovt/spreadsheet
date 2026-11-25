import { type Answer, fakeEncrypted, plainOp } from "@spreadsheet/shared";
import { describe, expect, it, vi } from "vitest";
import { createGroupCodec } from "./codec.js";
import { generateGroupKey } from "./crypto.js";
import { mergeAfterRejection, replayJournal } from "./journal.js";

const plain = createGroupCodec(false, null);

async function encryptedCodec() {
  return createGroupCodec(true, await generateGroupKey());
}

describe("replayJournal", () => {
  it("builds state from entries", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", note: null }) },
      { operation: plainOp("blindfold:mutual", { rating: "maybe", note: null }) },
    ];
    const state = await replayJournal(entries, plain);
    expect(state["oral:give"]).toEqual({ rating: "yes", note: null });
    expect(state["blindfold:mutual"]).toEqual({ rating: "maybe", note: null });
  });

  it("last write wins", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", note: null }) },
      { operation: plainOp("oral:give", { rating: "no", note: null }) },
    ];
    const state = await replayJournal(entries, plain);
    expect(state["oral:give"]).toEqual({ rating: "no", note: null });
  });

  it("handles null data (deletion)", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", note: null }) },
      { operation: plainOp("oral:give", null) },
    ];
    const state = await replayJournal(entries, plain);
    expect(state["oral:give"]).toBeUndefined();
  });

  it("skips malformed entries", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const entries = [{ operation: "garbage" }, { operation: plainOp("oral:give", { rating: "yes", note: null }) }];
    const state = await replayJournal(entries, plain);
    expect(Object.keys(state)).toHaveLength(1);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("works with encrypted entries", async () => {
    const codec = await encryptedCodec();
    const payload = { key: "oral:give", data: { rating: "yes", note: null } };
    const encrypted = await codec.seal(payload);
    const entries = [{ operation: encrypted }];
    const state = await replayJournal(entries, codec);
    expect(state["oral:give"]).toEqual({ rating: "yes", note: null });
  });

  it("backfills note: null for legacy envelopes that predate the field", async () => {
    // Older journal entries serialize `{ rating, timing }` with no `note`
    // key. `Answer` has `note: string | null`, so replay must normalize
    // undefined → null to keep the schema honest.
    const legacyPayload = `p:1:${JSON.stringify({
      key: "blindfold:mutual",
      data: { rating: "yes" },
    })}`;
    const state = await replayJournal([{ operation: legacyPayload }], plain);
    expect(state["blindfold:mutual"]).toEqual({ rating: "yes", note: null });
  });

  it("round-trips a note inside the encrypted answer payload", async () => {
    const codec = await encryptedCodec();
    const noteText = "Side-lying first, never on my back.";
    const payload = {
      key: "anal-play:give",
      data: { rating: "if-partner-wants", note: noteText },
    };
    const encrypted = await codec.seal(payload);
    // The opaque op is a single envelope — note is encrypted alongside the
    // rating, no separate cipher path. Replay with the right key recovers
    // the full Answer including the note.
    const state = await replayJournal([{ operation: encrypted }], codec);
    expect(state["anal-play:give"]).toEqual({
      rating: "if-partner-wants",
      note: noteText,
    });
  });

  it("strips the legacy `timing` field from old encoded envelopes", async () => {
    // Pre-timing-removal entries carry `{ rating, timing, note }`. The
    // shared Answer schema strips unknown keys on parse, so replay yields
    // a clean { rating, note } record.
    const legacyPayload = `p:1:${JSON.stringify({
      key: "kissing:mutual",
      data: { rating: "yes", timing: "now", note: "before bed" },
    })}`;
    const state = await replayJournal([{ operation: legacyPayload }], plain);
    expect(state["kissing:mutual"]).toEqual({ rating: "yes", note: "before bed" });
  });

  it("strips the legacy `timing` field from old encrypted envelopes", async () => {
    // Encrypted variant of the legacy-strip test — most groups in production
    // are encrypted, so the contract that old `{ rating, timing, note }`
    // payloads round-trip cleanly through the cipher path is what users
    // actually depend on.
    const codec = await encryptedCodec();
    const encrypted = await codec.seal({
      key: "kissing:mutual",
      data: { rating: "yes", timing: "later", note: "weekend?" },
    });
    const state = await replayJournal([{ operation: encrypted }], codec);
    expect(state["kissing:mutual"]).toEqual({ rating: "yes", note: "weekend?" });
  });

  it("skips plaintext entries in an encrypted group (forged without the key)", async () => {
    // GCM authenticates ciphertext, but a `p:` op needs no key: the server,
    // or anyone with database access, could append one to forge an answer.
    // Neither the overwrite of a real answer nor a new answer may land.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const codec = await encryptedCodec();
    const entries = [
      { operation: await codec.seal({ key: "oral:give", data: { rating: "no", note: null } }) },
      { operation: plainOp("oral:give", { rating: "yes", note: null }) },
      { operation: plainOp("anal-play:give", { rating: "yes", note: null }) },
    ];
    const state = await replayJournal(entries, codec);
    expect(state).toEqual({ "oral:give": { rating: "no", note: null } });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("skips encrypted entries in a plaintext group", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const otherGroup = await encryptedCodec();
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", note: null }) },
      { operation: await otherGroup.seal({ key: "kissing:mutual", data: { rating: "yes", note: null } }) },
      { operation: fakeEncrypted("not-a-ciphertext") },
    ];
    const state = await replayJournal(entries, plain);
    expect(state).toEqual({ "oral:give": { rating: "yes", note: null } });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("mergeAfterRejection", () => {
  it("keeps local edits for conflicting keys", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "maybe", note: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "maybe", note: null })];
    const serverEntries = [plainOp("oral:give", { rating: "yes", note: null })];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, plain);
    // Local edit wins
    expect(merged["oral:give"]).toEqual({ rating: "maybe", note: null });
  });

  it("accepts server-only keys", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", note: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "yes", note: null })];
    const serverEntries = [
      plainOp("oral:give", { rating: "no", note: null }),
      plainOp("blindfold:mutual", { rating: "maybe", note: null }),
    ];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, plain);
    // Local wins for oral:give
    expect(merged["oral:give"]).toEqual({ rating: "yes", note: null });
    // Server's blindfold accepted
    expect(merged["blindfold:mutual"]).toEqual({ rating: "maybe", note: null });
  });

  it("preserves local-only answers", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", note: null },
      "spanking:give": { rating: "no", note: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "yes", note: null })];
    const serverEntries: string[] = [];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, plain);
    expect(merged["oral:give"]).toEqual({ rating: "yes", note: null });
    expect(merged["spanking:give"]).toEqual({ rating: "no", note: null });
  });

  it("handles empty pending ops", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", note: null },
    };
    const serverEntries = [plainOp("blindfold:mutual", { rating: "fantasy", note: null })];

    const merged = await mergeAfterRejection(localAnswers, [], serverEntries, plain);
    // Server entry accepted (no pending conflict)
    expect(merged["blindfold:mutual"]).toEqual({ rating: "fantasy", note: null });
    // Local preserved
    expect(merged["oral:give"]).toEqual({ rating: "yes", note: null });
  });

  it("server-side delete (null op) removes the key from merged when no pending op", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", note: null },
      "blindfold:mutual": { rating: "maybe", note: null },
    };
    const serverEntries = [plainOp("oral:give", null)];

    const merged = await mergeAfterRejection(localAnswers, [], serverEntries, plain);
    expect(merged).not.toHaveProperty("oral:give");
    expect(merged["blindfold:mutual"]).toEqual({ rating: "maybe", note: null });
  });

  it("pending op wins over a server-side delete", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", note: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "maybe", note: null })];
    const serverEntries = [plainOp("oral:give", null)];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, plain);
    // User's pending edit wins; the server's delete is ignored for keys
    // with an in-flight local op.
    expect(merged["oral:give"]).toEqual({ rating: "yes", note: null });
  });
});
