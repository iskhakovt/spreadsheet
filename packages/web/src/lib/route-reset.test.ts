/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RouteReset } from "./route-reset.js";

afterEach(() => {
  cleanup();
  // Restore the window.scrollTo spy so it doesn't leak between tests.
  vi.restoreAllMocks();
});

function tree(hook: ReturnType<typeof memoryLocation>["hook"], body: React.ReactNode) {
  // RouteReset scopes heading lookup to `main h1, main h2`, so wrap the
  // test body in <main> to mirror what PersonApp renders in production.
  const children = [createElement(RouteReset, { key: "rr" }), createElement("main", { key: "main" }, body)];
  // Router's generated TS types require `children` as a prop — createElement
  // positional args don't satisfy the signature, so we pass via prop.
  // biome-ignore lint/correctness/noChildrenProp: Router's TS types require children as a prop
  return createElement(Router, { hook, children });
}

describe("RouteReset", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  it("does nothing on the initial render — the browser already starts at scrollY=0 and the user's own focus shouldn't jump on page load", () => {
    const { hook } = memoryLocation();
    render(tree(hook, createElement("h1", null, "Page")));

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("on navigation, scrolls to top and moves focus to the route's h1", () => {
    const { hook, navigate } = memoryLocation();
    render(
      tree(
        hook,
        createElement(
          "div",
          { key: "body" },
          createElement("input", { "data-testid": "prior-focus", type: "text", key: "in" }),
          createElement("h1", { key: "h1" }, "Review your answers"),
        ),
      ),
    );

    const input = screen.getByTestId("prior-focus") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => {
      navigate("/review");
    });

    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
    const h1 = screen.getByText("Review your answers");
    expect(document.activeElement).toBe(h1);
  });

  it("falls back to h2 when the route has no h1 (QuestionCard pattern)", () => {
    const { hook, navigate } = memoryLocation();
    render(tree(hook, createElement("h2", null, "Question text")));

    act(() => {
      navigate("/questions");
    });

    const h2 = screen.getByText("Question text");
    expect(document.activeElement).toBe(h2);
  });

  it("sets tabIndex=-1 on the heading so .focus() actually lands — h1 isn't focusable by default", () => {
    const { hook, navigate } = memoryLocation();
    render(tree(hook, createElement("h1", null, "Page")));

    const h1 = screen.getByText("Page") as HTMLHeadingElement;

    act(() => {
      navigate("/foo");
    });

    expect(h1.tabIndex).toBe(-1);
  });

  it("scrolls even when no heading is present — the scroll reset must always run", () => {
    const { hook, navigate } = memoryLocation();
    render(tree(hook, createElement("p", null, "No heading")));

    act(() => {
      navigate("/bare");
    });

    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls on every subsequent route change, not just the first", () => {
    const { hook, navigate } = memoryLocation();
    render(tree(hook, createElement("h1", null, "Page")));

    const callsBefore = scrollSpy.mock.calls.length;
    act(() => {
      navigate("/a");
    });
    const callsAfterFirst = scrollSpy.mock.calls.length;
    act(() => {
      navigate("/b");
    });
    const callsAfterSecond = scrollSpy.mock.calls.length;

    // Each navigation should produce at least one scrollTo call. Exact
    // count depends on wouter's internal subscriber behavior, so we
    // assert "strictly more" after each nav rather than a fixed count.
    expect(callsAfterFirst).toBeGreaterThan(callsBefore);
    expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
  });
});
