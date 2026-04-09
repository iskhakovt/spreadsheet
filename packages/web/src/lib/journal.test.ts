import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { encodeValue, generateGroupKey } from "./crypto.js";
import { mergeAfterRejection, replayJournal } from "./journal.js";

function plainOp(key: string, data: Answer | null): string {
  return `p:1:${JSON.stringify({ key, data })}`;
}

describe("replayJournal", () => {
  it("builds state from entries", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", timing: "now" }) },
      { operation: plainOp("blindfold:mutual", { rating: "maybe", timing: null }) },
    ];
    const state = await replayJournal(entries, null);
    expect(state["oral:give"]).toEqual({ rating: "yes", timing: "now" });
    expect(state["blindfold:mutual"]).toEqual({ rating: "maybe", timing: null });
  });

  it("last write wins", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", timing: "now" }) },
      { operation: plainOp("oral:give", { rating: "no", timing: null }) },
    ];
    const state = await replayJournal(entries, null);
    expect(state["oral:give"]).toEqual({ rating: "no", timing: null });
  });

  it("handles null data (deletion)", async () => {
    const entries = [
      { operation: plainOp("oral:give", { rating: "yes", timing: "now" }) },
      { operation: plainOp("oral:give", null) },
    ];
    const state = await replayJournal(entries, null);
    expect(state["oral:give"]).toBeUndefined();
  });

  it("skips malformed entries", async () => {
    const entries = [{ operation: "garbage" }, { operation: plainOp("oral:give", { rating: "yes", timing: "now" }) }];
    const state = await replayJournal(entries, null);
    expect(Object.keys(state)).toHaveLength(1);
  });

  it("works with encrypted entries", async () => {
    const key = await generateGroupKey();
    const payload = { key: "oral:give", data: { rating: "yes", timing: "now" } };
    const encrypted = await encodeValue(payload, key);
    const entries = [{ operation: encrypted }];
    const state = await replayJournal(entries, key);
    expect(state["oral:give"]).toEqual({ rating: "yes", timing: "now" });
  });
});

describe("mergeAfterRejection", () => {
  it("keeps local edits for conflicting keys", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "maybe", timing: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "maybe", timing: null })];
    const serverEntries = [plainOp("oral:give", { rating: "yes", timing: "now" })];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, null);
    // Local edit wins
    expect(merged["oral:give"]).toEqual({ rating: "maybe", timing: null });
  });

  it("accepts server-only keys", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", timing: "now" },
    };
    const pendingOps = [plainOp("oral:give", { rating: "yes", timing: "now" })];
    const serverEntries = [
      plainOp("oral:give", { rating: "no", timing: null }),
      plainOp("blindfold:mutual", { rating: "maybe", timing: null }),
    ];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, null);
    // Local wins for oral:give
    expect(merged["oral:give"]).toEqual({ rating: "yes", timing: "now" });
    // Server's blindfold accepted
    expect(merged["blindfold:mutual"]).toEqual({ rating: "maybe", timing: null });
  });

  it("preserves local-only answers", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", timing: "now" },
      "spanking:give": { rating: "no", timing: null },
    };
    const pendingOps = [plainOp("oral:give", { rating: "yes", timing: "now" })];
    const serverEntries: string[] = [];

    const merged = await mergeAfterRejection(localAnswers, pendingOps, serverEntries, null);
    expect(merged["oral:give"]).toEqual({ rating: "yes", timing: "now" });
    expect(merged["spanking:give"]).toEqual({ rating: "no", timing: null });
  });

  it("handles empty pending ops", async () => {
    const localAnswers: Record<string, Answer> = {
      "oral:give": { rating: "yes", timing: "now" },
    };
    const serverEntries = [plainOp("blindfold:mutual", { rating: "fantasy", timing: null })];

    const merged = await mergeAfterRejection(localAnswers, [], serverEntries, null);
    // Server entry accepted (no pending conflict)
    expect(merged["blindfold:mutual"]).toEqual({ rating: "fantasy", timing: null });
    // Local preserved
    expect(merged["oral:give"]).toEqual({ rating: "yes", timing: "now" });
  });
});
