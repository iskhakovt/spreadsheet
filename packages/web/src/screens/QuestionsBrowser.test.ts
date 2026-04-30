/** @vitest-environment happy-dom */
import type { QuestionData, Tier } from "@spreadsheet/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesQuery, QuestionRow, TierPicker } from "./QuestionsBrowser.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    requiresGroupAnatomy: [],
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

describe("TierPicker — keyboard nav (roving tabindex + arrows)", () => {
  it("only the selected radio is in tab order; others get tabIndex=-1", () => {
    const onChange = vi.fn();
    render(createElement(TierPicker, { tier: 2 as Tier, onChange }));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios[0].tabIndex).toBe(-1); // Essentials
    expect(radios[1].tabIndex).toBe(0); // Common (selected)
    expect(radios[2].tabIndex).toBe(-1);
    expect(radios[3].tabIndex).toBe(-1);
  });

  it("ArrowRight commits the next tier and wraps at the end", () => {
    const onChange = vi.fn();
    const { rerender } = render(createElement(TierPicker, { tier: 1 as Tier, onChange }));
    const group = screen.getByRole("radiogroup", { name: "Question depth" });
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowRight" });
    });
    expect(onChange).toHaveBeenLastCalledWith(2);

    rerender(createElement(TierPicker, { tier: 4 as Tier, onChange }));
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowRight" });
    });
    // Wraps to first.
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ArrowLeft commits the previous tier and wraps at the start", () => {
    const onChange = vi.fn();
    const { rerender } = render(createElement(TierPicker, { tier: 3 as Tier, onChange }));
    const group = screen.getByRole("radiogroup", { name: "Question depth" });
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowLeft" });
    });
    expect(onChange).toHaveBeenLastCalledWith(2);

    rerender(createElement(TierPicker, { tier: 1 as Tier, onChange }));
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowLeft" });
    });
    // Wraps to last.
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("ArrowDown / ArrowUp behave like ArrowRight / ArrowLeft (vertical tier list nav)", () => {
    const onChange = vi.fn();
    render(createElement(TierPicker, { tier: 2 as Tier, onChange }));
    const group = screen.getByRole("radiogroup", { name: "Question depth" });
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowDown" });
    });
    expect(onChange).toHaveBeenLastCalledWith(3);
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowUp" });
    });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("Home / End jump to the first / last tier", () => {
    const onChange = vi.fn();
    render(createElement(TierPicker, { tier: 2 as Tier, onChange }));
    const group = screen.getByRole("radiogroup", { name: "Question depth" });
    act(() => {
      fireEvent.keyDown(group, { key: "End" });
    });
    expect(onChange).toHaveBeenLastCalledWith(4);
    act(() => {
      fireEvent.keyDown(group, { key: "Home" });
    });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ignores unrelated keys without committing", () => {
    const onChange = vi.fn();
    render(createElement(TierPicker, { tier: 2 as Tier, onChange }));
    const group = screen.getByRole("radiogroup", { name: "Question depth" });
    act(() => {
      fireEvent.keyDown(group, { key: "a" });
      fireEvent.keyDown(group, { key: " " });
      fireEvent.keyDown(group, { key: "Tab" });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mouse click commits but doesn't move keyboard focus to the chosen button", () => {
    // The shouldFocusSelected guard suppresses programmatic focus on
    // mouse clicks — only keyboard arrow commits should steal focus.
    const onChange = vi.fn();
    render(createElement(TierPicker, { tier: 2 as Tier, onChange }));
    const radios = screen.getAllByRole("radio");
    act(() => {
      fireEvent.click(radios[3]); // Edge
    });
    expect(onChange).toHaveBeenCalledWith(4);
    // Focus stays where the click landed (on the clicked button itself,
    // via the browser's native focus-on-click) — and definitely doesn't
    // re-target after the synthetic re-render. activeElement should NOT
    // be a different button than what was clicked.
    expect(document.activeElement).not.toBe(radios[1]); // not the previously selected
  });
});

describe("QuestionRow — chip disabled when parent filtered out", () => {
  const parent = q({ id: "sex-generally", text: "Sex generally" });
  const child = q({ id: "slow-sex", text: "Slow, deliberate sex", requires: ["sex-generally"] });
  const questionMap = new Map<string, QuestionData>([
    [parent.id, parent],
    [child.id, child],
  ]);
  const childrenOf = new Map<string, string[]>([["sex-generally", ["slow-sex"]]]);

  it("renders an enabled chip when the parent is in `visibleIds`", () => {
    render(
      createElement(QuestionRow, {
        question: child,
        questionMap,
        childrenOf,
        visibleIds: new Set(["sex-generally", "slow-sex"]),
        onParentClick: vi.fn(),
        registerCard: vi.fn(),
      }),
    );
    const chip = screen.getByRole("button", { name: /requires sex-generally/i }) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("title")).toMatch(/Jump to: Sex generally/);
  });

  it("renders a disabled chip with the hidden-by-search tooltip when parent is filtered out", () => {
    const onParentClick = vi.fn();
    render(
      createElement(QuestionRow, {
        question: child,
        questionMap,
        childrenOf,
        visibleIds: new Set(["slow-sex"]), // parent missing
        onParentClick,
        registerCard: vi.fn(),
      }),
    );
    const chip = screen.getByRole("button", { name: /requires sex-generally/i }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("title")).toMatch(/hidden by your search/);
    // Click on a disabled button is a no-op in the DOM, but assert that
    // the handler doesn't fire just in case future styling re-enables it.
    act(() => {
      fireEvent.click(chip);
    });
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("throws on an unknown parent id (invariant violation surfaces loudly)", () => {
    // Suppress the React console.error noise from the throw — vitest still
    // catches the actual exception via toThrow().
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const orphanChild = q({ id: "orphan", text: "Orphan", requires: ["does-not-exist"] });
    expect(() =>
      render(
        createElement(QuestionRow, {
          question: orphanChild,
          questionMap, // doesn't contain "does-not-exist"
          childrenOf,
          visibleIds: new Set(["orphan"]),
          onParentClick: vi.fn(),
          registerCard: vi.fn(),
        }),
      ),
    ).toThrow(/Unknown parent in requires: does-not-exist/);
    spy.mockRestore();
  });
});
