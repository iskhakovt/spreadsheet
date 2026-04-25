/** @vitest-environment happy-dom */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteReset, useScrollReset } from "./route-reset.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeRouter(body: React.ReactNode) {
  // Root route renders RouteReset + test body; child routes are navigable
  // stubs so we can trigger pathname changes.
  const rootRoute = createRootRoute({
    component: () => createElement(Fragment, null, createElement(RouteReset), createElement("main", null, body)),
  });
  const aRoute = createRoute({ getParentRoute: () => rootRoute, path: "/a", component: () => null });
  const bRoute = createRoute({ getParentRoute: () => rootRoute, path: "/b", component: () => null });
  const routeTree = rootRoute.addChildren([aRoute, bRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("RouteReset", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  it("does nothing on the initial render — the browser already starts at scrollY=0 and the user's own focus shouldn't jump on page load", async () => {
    const router = makeRouter(createElement("h1", null, "Page"));
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("on navigation, scrolls to top and moves focus to the route's h1", async () => {
    const router = makeRouter(
      createElement(
        "div",
        null,
        createElement("input", { "data-testid": "prior-focus", type: "text" }),
        createElement("h1", null, "Review your answers"),
      ),
    );
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    const input = screen.getByTestId("prior-focus") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub routes local to this test, not in the registered app router
      await router.navigate({ to: "/a" } as any);
    });

    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
    const h1 = screen.getByText("Review your answers");
    expect(document.activeElement).toBe(h1);
  });

  it("falls back to h2 when the route has no h1 (QuestionCard pattern)", async () => {
    const router = makeRouter(createElement("h2", null, "Question text"));
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub routes local to this test, not in the registered app router
      await router.navigate({ to: "/a" } as any);
    });

    const h2 = screen.getByText("Question text");
    expect(document.activeElement).toBe(h2);
  });

  it("sets tabIndex=-1 on the heading so .focus() actually lands — h1 isn't focusable by default", async () => {
    const router = makeRouter(createElement("h1", null, "Page"));
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    const h1 = screen.getByText("Page") as HTMLHeadingElement;

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub routes local to this test, not in the registered app router
      await router.navigate({ to: "/a" } as any);
    });

    expect(h1.tabIndex).toBe(-1);
  });

  it("scrolls even when no heading is present — the scroll reset must always run", async () => {
    const router = makeRouter(createElement("p", null, "No heading"));
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub routes local to this test, not in the registered app router
      await router.navigate({ to: "/a" } as any);
    });

    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls on every subsequent route change, not just the first", async () => {
    const router = makeRouter(createElement("h1", null, "Page"));
    await act(async () => {
      render(createElement(RouterProvider, { router }));
    });

    const callsBefore = scrollSpy.mock.calls.length;

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub routes local to this test, not in the registered app router
      await router.navigate({ to: "/a" } as any);
    });
    const callsAfterFirst = scrollSpy.mock.calls.length;

    await act(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: stub route, see above
      await router.navigate({ to: "/b" } as any);
    });
    const callsAfterSecond = scrollSpy.mock.calls.length;

    expect(callsAfterFirst).toBeGreaterThan(callsBefore);
    expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
  });
});

describe("useScrollReset", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  it("does not scroll on the initial render", () => {
    renderHook(() => useScrollReset(0));
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("scrolls to top when the dep changes", () => {
    const { rerender } = renderHook(({ dep }) => useScrollReset(dep), { initialProps: { dep: 0 } });
    expect(scrollSpy).not.toHaveBeenCalled();
    rerender({ dep: 1 });
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls on every subsequent change, not just the first", () => {
    const { rerender } = renderHook(({ dep }) => useScrollReset(dep), { initialProps: { dep: 0 } });
    rerender({ dep: 1 });
    rerender({ dep: 2 });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when rerendered with the same dep", () => {
    const { rerender } = renderHook(({ dep }) => useScrollReset(dep), { initialProps: { dep: 0 } });
    rerender({ dep: 0 });
    rerender({ dep: 0 });
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
