import type { QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { buildChildrenOf, GATE_CHILDREN_THRESHOLD, isGate } from "./dependency-graph.js";

function q(id: string, requires: string[] = []): QuestionData {
  return {
    id,
    categoryId: "cat",
    text: id,
    giveText: null,
    receiveText: null,
    description: null,
    notePrompt: null,
    targetGive: "all",
    targetReceive: "all",
    tier: 1,
    requires,
  };
}

describe("buildChildrenOf", () => {
  it("returns an empty map when no question declares requires", () => {
    expect(buildChildrenOf([q("a"), q("b")]).size).toBe(0);
  });

  it("inverts a single-parent dependency", () => {
    const map = buildChildrenOf([q("p"), q("c", ["p"])]);
    expect(map.get("p")).toEqual(["c"]);
    expect(map.get("c")).toBeUndefined();
  });

  it("collects multiple children under one parent", () => {
    const map = buildChildrenOf([q("p"), q("a", ["p"]), q("b", ["p"]), q("c", ["p"])]);
    expect(map.get("p")?.length).toBe(3);
    expect(map.get("p")).toEqual(["a", "b", "c"]);
  });

  it("handles AND-multi-parent (one child appears under each parent)", () => {
    const map = buildChildrenOf([q("p1"), q("p2"), q("c", ["p1", "p2"])]);
    expect(map.get("p1")).toEqual(["c"]);
    expect(map.get("p2")).toEqual(["c"]);
  });
});

describe("isGate", () => {
  it("flags a parent with >= threshold children as a gate", () => {
    const children = new Map<string, string[]>([["p", ["a", "b", "c"]]]);
    expect(isGate("p", children)).toBe(true);
    expect(GATE_CHILDREN_THRESHOLD).toBe(3); // keep the constant pinned
  });

  it("treats a parent with fewer than threshold children as not-a-gate", () => {
    const children = new Map<string, string[]>([["p", ["a", "b"]]]);
    expect(isGate("p", children)).toBe(false);
  });

  it("treats unknown ids as not-a-gate", () => {
    expect(isGate("nope", new Map())).toBe(false);
  });
});
