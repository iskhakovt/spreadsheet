import type { Answer, QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { gatedSides, isQuestionVisible } from "./visibility.js";

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
    tier: 1,
    requires: [],
    ...overrides,
  };
}

const ans = (rating: "yes" | "no" | "maybe"): Answer => ({ rating, timing: null });

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

describe("isQuestionVisible", () => {
  it("invisible when fully gated", () => {
    const parent = q({ id: "parent" });
    const child = q({ id: "child", requires: ["parent"] });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(isQuestionVisible(child, "amab", ["afab"], "all", { "parent:mutual": ans("no") }, map)).toBe(false);
  });

  it("visible when one side survives gating", () => {
    const parent = q({ id: "parent", giveText: "g", receiveText: "r" });
    const child = q({
      id: "child",
      requires: ["parent"],
      giveText: "cg",
      receiveText: "cr",
    });
    const map = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    // Parent give=no hides child give-side, but receive-side still visible.
    expect(isQuestionVisible(child, "amab", ["afab"], "all", { "parent:give": ans("no") }, map)).toBe(true);
  });
});
