import type { QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { matchesQuery } from "./QuestionsBrowser.js";

function q(overrides: Partial<QuestionData> & { id: string }): QuestionData {
  return {
    categoryId: "affection",
    text: "Eye contact during intimate moments",
    giveText: null,
    receiveText: null,
    description: null,
    notePrompt: null,
    targetGive: "all",
    targetReceive: "all",
    tier: 1,
    requires: [],
    ...overrides,
  };
}

describe("matchesQuery", () => {
  it("matches on the question id", () => {
    expect(matchesQuery(q({ id: "eye-contact" }), "contact")).toBe(true);
    expect(matchesQuery(q({ id: "eye-contact" }), "blindfold")).toBe(false);
  });

  it("matches on the primary text", () => {
    expect(matchesQuery(q({ id: "x", text: "Sandalwood massage" }), "sandalwood")).toBe(true);
  });

  it("matches on giveText / receiveText for role-based questions", () => {
    const role = q({
      id: "x",
      text: "Going down",
      giveText: "Going down on your partner",
      receiveText: "Receiving oral",
    });
    expect(matchesQuery(role, "your partner")).toBe(true);
    expect(matchesQuery(role, "receiving")).toBe(true);
  });

  it("matches on the description", () => {
    expect(
      matchesQuery(q({ id: "x", description: "Looking at each other while we're being intimate" }), "looking"),
    ).toBe(true);
  });

  it("matches on categoryId for browsing-by-category", () => {
    expect(matchesQuery(q({ id: "x", categoryId: "aftercare" }), "after")).toBe(true);
  });

  it("is case-insensitive (caller lowercases the needle once)", () => {
    expect(matchesQuery(q({ id: "x", text: "EYE CONTACT" }), "eye")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesQuery(q({ id: "x", text: "hello world" }), "xyz")).toBe(false);
  });
});
