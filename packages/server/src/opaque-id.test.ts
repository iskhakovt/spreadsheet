import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeJournalId,
  encodeJournalCursor,
  encodeJournalId,
  openId,
  sealId,
  sealIds,
  toWireEntries,
} from "./opaque-id.js";

beforeAll(() => {
  process.env.STOKEN_SECRET = "test-secret-for-opaque-id";
});

describe("opaque journal ids", () => {
  it("round-trips encode + decode", () => {
    for (const id of [1, 2, 42, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(decodeJournalId(encodeJournalId(id))).toBe(id);
    }
  });

  it("is a fixed-length base64url token that doesn't contain the id", () => {
    const token = encodeJournalId(123456);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(token).not.toContain("123456");
  });

  it("is deterministic (clients dedup by id)", () => {
    expect(encodeJournalId(7)).toBe(encodeJournalId(7));
  });

  it("doesn't preserve order between consecutive ids", () => {
    // A PRP over 128-bit blocks: consecutive ids shouldn't encode to
    // lexically consecutive tokens. Check a run rather than one pair.
    const tokens = Array.from({ length: 20 }, (_, i) => encodeJournalId(i + 1));
    const sorted = [...tokens].sort();
    expect(sorted).not.toEqual(tokens);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("decodes absent, legacy numeric, malformed and tampered input to null", () => {
    expect(decodeJournalId(null)).toBe(null);
    expect(decodeJournalId(undefined)).toBe(null);
    expect(decodeJournalId("")).toBe(null);
    expect(decodeJournalId("42")).toBe(null);
    expect(decodeJournalId("not a token")).toBe(null);
    const token = encodeJournalId(10);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(decodeJournalId(tampered)).toBe(null);
  });

  it("has exactly one valid spelling per id (no non-canonical base64url aliases)", () => {
    const token = encodeJournalId(42);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (const c of alphabet) {
      const variant = token.slice(0, 21) + c;
      expect(decodeJournalId(variant)).toBe(variant === token ? 42 : null);
    }
  });

  it("decodes numbers (pre-opaque clients) to null", () => {
    expect(decodeJournalId(42)).toBe(null);
  });

  it("sealIds matches sealing each id on its own", () => {
    const ids = [1, 2, 3, 99, 123456];
    expect(sealIds(ids, "journal1")).toEqual(ids.map((id) => sealId(id, "journal1")));
    expect(sealIds([], "journal1")).toEqual([]);
  });

  it("rejects tokens sealed under a different tag", () => {
    const stokenLike = sealId(10, "stoken02");
    expect(decodeJournalId(stokenLike)).toBe(null);
    expect(openId(stokenLike, "stoken02")).toBe(10);
  });

  it("rejects tokens sealed under a different secret", () => {
    const token = encodeJournalId(10);
    const previous = process.env.STOKEN_SECRET;
    process.env.STOKEN_SECRET = "rotated-secret";
    try {
      expect(decodeJournalId(token)).toBe(null);
    } finally {
      process.env.STOKEN_SECRET = previous;
    }
  });

  it("encodeJournalCursor maps null / 0 to null", () => {
    expect(encodeJournalCursor(null)).toBe(null);
    expect(encodeJournalCursor(0)).toBe(null);
    expect(encodeJournalCursor(5)).toBe(encodeJournalId(5));
  });

  it("toWireEntries seals every id and keeps the other fields", () => {
    expect(toWireEntries([{ id: 3, personId: "p", operation: "op" }])).toEqual([
      { id: encodeJournalId(3), personId: "p", operation: "op" },
    ]);
  });
});
