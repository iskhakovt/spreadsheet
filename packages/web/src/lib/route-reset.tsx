import { useLocation, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Scrolls the window to the top whenever `dep` changes, skipping the
 * initial render. Use for within-route state transitions (question index,
 * pair tab) where the URL doesn't change and RouteReset can't fire.
 */
export function useScrollReset(dep: unknown) {
  const isFirstRender = useRef(true);
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [dep]);
}

/**
 * Resets window scroll and moves focus on every SPA route change.
 *
 * On each location change we:
 *   1. Scroll the window to the top. `scrollTo(0, 0)` is a no-op if
 *      already there, so this is cheap.
 *   2. Move focus to the route's main heading (`h1` or, fallback, `h2`)
 *      so keyboard users land somewhere meaningful — WCAG 2.4.3 / 2.4.6.
 *      `tabIndex` is set programmatically so each screen doesn't need to
 *      remember to opt in. `preventScroll: true` keeps the `scrollTo(0,0)`
 *      above from being undone by focus's implicit scroll-into-view.
 *
 * Scroll uses `useLayoutEffect([pathname])` so it fires before paint.
 * Focus uses `useEffect([status])` gated on router "idle" — TanStack
 * Router sets the location store (which `useLocation` reads) at the START
 * of navigation, before route loaders run and new components render, so a
 * `[pathname]` dep would fire too early and find no H1. The `pendingNav`
 * ref bridges the two: set on pathname change, cleared on idle+focus.
 *
 * Initial-render case is skipped: users landing on a page don't expect
 * their focus to be forcibly moved on page load, and the browser already
 * starts them at scrollY=0.
 */
export function RouteReset() {
  const { pathname } = useLocation();
  const status = useRouterState({ select: (s) => s.status });
  const isFirstRender = useRef(true);
  // Bridges the two effects: set on pathname change (layout), cleared after focus (effect).
  // Needed because TanStack Router updates stores.location at nav START — before components
  // render — so we can't focus H1 in the layout effect; we defer to status→idle instead.
  const pendingNav = useRef(false);

  // Scroll reset: fires early (before paint) when the URL changes.
  useLayoutEffect(() => {
    if (isFirstRender.current) return;
    pendingNav.current = true;
    window.scrollTo(0, 0);
  }, [pathname]);

  // Focus: fires after route content is rendered (router status → idle).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (status !== "idle" || !pendingNav.current) return;
    pendingNav.current = false;
    // Scope to `main` so we pick the route's heading, not a heading that
    // might live in a global fragment (e.g. an error banner).
    const heading = document.querySelector<HTMLHeadingElement>("main h1, main h2");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) {
        heading.tabIndex = -1;
      }
      heading.focus({ preventScroll: true });
    }
  }, [status]);

  return null;
}
