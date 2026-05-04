import type { Answer, QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { anatomySides, gatedSides, visibleSides } from "./visibility.js";

function q(overrides: Partial<QuestionData> & { id: string }): QuestionData {
  return {
    categoryId: "cat",
    text: overrides.id,
    giveText: null,
    receiveText: null,
    description: null,
    notePrompt: null,
    targetGive: "all",
    targetReceive: "all",
    requiresGroupAnatomy: [],
    tier: 1,
    requires: [],
    ...overrides,
  };
}

const ans = (rating: "yes" | "no" | "maybe"): Answer => ({ rating, note: null });

describe("gatedSides", () => {
  it("returns empty when no parents", () => {
    const child = q({ id: "child" });
    const map = new Map([[child.id, child]]);
    expect(gatedSides("child", {}, map)).toEqual(new Set());
  });

  it("ungated when parent answered yes", () => {
    const parent = q({ id: "parent" });
    const child = q({ id: "child", requires: ["parent"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("child", { "parent:mutual": ans("yes") }, map)).toEqual(new Set());
  });

  it("gates mutual child when mutual parent is no", () => {
    const parent = q({ id: "parent" });
    const child = q({ id: "child", requires: ["parent"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("child", { "parent:mutual": ans("no") }, map)).toEqual(new Set(["mutual"]));
  });

  it("ungated when parent answered maybe", () => {
    const parent = q({ id: "parent" });
    const child = q({ id: "child", requires: ["parent"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("child", { "parent:mutual": ans("maybe") }, map)).toEqual(new Set());
  });

  it("per-side: g/r child gates only the side whose g/r parent side is no", () => {
    const parent = q({ id: "p", giveText: "p give", receiveText: "p receive" });
    const child = q({
      id: "c",
      requires: ["p"],
      giveText: "c give",
      receiveText: "c receive",
    });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:give": ans("no") }, map)).toEqual(new Set(["give"]));
    expect(gatedSides("c", { "p:receive": ans("no") }, map)).toEqual(new Set(["receive"]));
    expect(gatedSides("c", { "p:give": ans("no"), "p:receive": ans("no") }, map)).toEqual(new Set(["give", "receive"]));
  });

  it("g/r child fully gated when mutual parent is no", () => {
    const parent = q({ id: "p" });
    const child = q({
      id: "c",
      requires: ["p"],
      giveText: "c give",
      receiveText: "c receive",
    });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:mutual": ans("no") }, map)).toEqual(new Set(["give", "receive"]));
  });

  it("mutual child gated when any side of g/r parent is no", () => {
    const parent = q({ id: "p", giveText: "p give", receiveText: "p receive" });
    const child = q({ id: "c", requires: ["p"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:give": ans("no") }, map)).toEqual(new Set(["mutual"]));
    expect(gatedSides("c", { "p:receive": ans("no") }, map)).toEqual(new Set(["mutual"]));
  });

  it("transitive: grandchild hidden when grandparent is no", () => {
    const gp = q({ id: "gp" });
    const p = q({ id: "p", requires: ["gp"] });
    const c = q({ id: "c", requires: ["p"] });
    const map = new Map([
      [gp.id, gp],
      [p.id, p],
      [c.id, c],
    ]);
    expect(gatedSides("c", { "gp:mutual": ans("no") }, map)).toEqual(new Set(["mutual"]));
  });

  it("transitive per-side via g/r chain", () => {
    const gp = q({ id: "gp", giveText: "gp give", receiveText: "gp receive" });
    const p = q({
      id: "p",
      requires: ["gp"],
      giveText: "p give",
      receiveText: "p receive",
    });
    const c = q({
      id: "c",
      requires: ["p"],
      giveText: "c give",
      receiveText: "c receive",
    });
    const map = new Map([
      [gp.id, gp],
      [p.id, p],
      [c.id, c],
    ]);
    // grandparent give-no → parent give gated → child give gated.
    expect(gatedSides("c", { "gp:give": ans("no") }, map)).toEqual(new Set(["give"]));
    expect(gatedSides("c", { "gp:receive": ans("no") }, map)).toEqual(new Set(["receive"]));
  });
});

describe("requiresGroupAnatomy gate", () => {
  it("hides every side when a required anatomy is missing from the group", () => {
    const question = q({
      id: "pull-out",
      giveText: "Withdrawing",
      receiveText: "Trusting partner to withdraw",
      targetGive: "amab",
      targetReceive: "afab",
      requiresGroupAnatomy: ["amab", "afab"],
    });
    expect(anatomySides(question, "amab", ["amab"], "filtered")).toEqual({
      canGive: false,
      canReceive: false,
      canMutual: false,
    });
  });

  it("renders normally when every required anatomy is present in the group", () => {
    const question = q({
      id: "pull-out",
      giveText: "Withdrawing",
      receiveText: "Trusting partner to withdraw",
      targetGive: "amab",
      targetReceive: "afab",
      requiresGroupAnatomy: ["amab", "afab"],
    });
    expect(anatomySides(question, "amab", ["afab"], "filtered")).toEqual({
      canGive: true,
      canReceive: false,
      canMutual: false,
    });
    expect(anatomySides(question, "afab", ["amab"], "filtered")).toEqual({
      canGive: false,
      canReceive: true,
      canMutual: false,
    });
  });

  it("treats a 'both'-anatomy member as satisfying any required anatomy", () => {
    // A 'both' body covers both amab and afab requirements. Two 'both'
    // members satisfy the gate AND give/receive each have a valid
    // counterpart, which exercises the gate's reliance on anatomyMatches.
    const question = q({
      id: "pull-out",
      giveText: "Withdrawing",
      receiveText: "Trusting partner to withdraw",
      targetGive: "amab",
      targetReceive: "afab",
      requiresGroupAnatomy: ["amab", "afab"],
    });
    expect(anatomySides(question, "both", ["both"], "filtered")).toEqual({
      canGive: true,
      canReceive: true,
      canMutual: false,
    });
  });

  it("bypasses the gate when questionMode is 'all'", () => {
    const question = q({
      id: "pull-out",
      giveText: "Withdrawing",
      receiveText: "Trusting partner to withdraw",
      targetGive: "amab",
      targetReceive: "afab",
      requiresGroupAnatomy: ["amab", "afab"],
    });
    expect(anatomySides(question, "amab", ["amab"], "all")).toEqual({
      canGive: true,
      canReceive: true,
      canMutual: false,
    });
  });

  it("does not affect questions with no group-anatomy gate", () => {
    const question = q({ id: "kissing" });
    expect(anatomySides(question, "amab", ["amab"], "filtered")).toEqual({
      canGive: false,
      canReceive: false,
      canMutual: true,
    });
  });

  it("flows through visibleSides — gate failure hides the question entirely", () => {
    const question = q({
      id: "condoms-always",
      requiresGroupAnatomy: ["amab"],
    });
    const map = new Map([[question.id, question]]);
    expect(visibleSides(question, "afab", ["afab"], "filtered", {}, map)).toEqual({
      canGive: false,
      canReceive: false,
      canMutual: false,
    });
    expect(visibleSides(question, "amab", ["afab"], "filtered", {}, map)).toEqual({
      canGive: false,
      canReceive: false,
      canMutual: true,
    });
  });
});

describe("gatedSides + anatomy interaction", () => {
  it("treats anatomy='both' user the same as any other for gating purposes", () => {
    // gatedSides reads only answers, not anatomy — a 'both' user with a
    // parent answered "no" still has the same gated sides as anyone else.
    const parent = q({ id: "p" });
    const child = q({ id: "c", requires: ["p"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:mutual": ans("no") }, map)).toEqual(new Set(["mutual"]));
  });

  it("dependency reordering: re-answering a 'no' parent to 'yes' un-gates the child", () => {
    // Drives the Back-and-forward integrity invariant at the visibility
    // layer: gatedSides is a pure function of `answers`, so swapping an
    // answer from "no" to "yes" must produce a clean (un-gated) result.
    // This is the property the live UI relies on when the user goes Back,
    // changes a parent rating, and the child becomes visible again.
    const parent = q({ id: "p" });
    const child = q({ id: "c", requires: ["p"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:mutual": ans("no") }, map)).toEqual(new Set(["mutual"]));
    expect(gatedSides("c", { "p:mutual": ans("yes") }, map)).toEqual(new Set());
    // Removing the answer entirely (the user erased it) un-gates too.
    expect(gatedSides("c", {}, map)).toEqual(new Set());
  });

  it("does not gate a child when the parent's anatomy-hidden side is unanswered", () => {
    // Parent's give-side is afab-only; for an amab user, that side never
    // renders, so it stays unanswered. The child must NOT be treated as
    // gated because of the absent give answer — gating only triggers on
    // explicit "no" replies, not on anatomy-suppressed silence.
    const parent = q({
      id: "p",
      giveText: "p give",
      receiveText: "p receive",
      targetGive: "afab",
      targetReceive: "all",
    });
    const child = q({ id: "c", requires: ["p"], giveText: "c give", receiveText: "c receive" });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(gatedSides("c", { "p:receive": ans("yes") }, map)).toEqual(new Set());
  });
});
