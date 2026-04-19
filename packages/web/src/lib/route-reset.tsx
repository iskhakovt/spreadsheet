import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Resets window scroll and moves focus on every SPA route change.
 *
 * Wouter (like react-router) doesn't manage scroll or focus across
 * navigations — the browser preserves whatever state the previous screen
 * left behind. That's fine when the user triggers the nav themselves,
 * but it leaves the next screen partially scrolled (BackLink hidden above
 * the fold) and with stale focus rings on reused controls.
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
 * `useLayoutEffect` so the reset runs before paint — the new screen
 * never renders-then-jumps.
 *
 * Initial-render case is skipped: users landing on a page don't expect
 * their focus to be forcibly moved on page load, and the browser already
 * starts them at scrollY=0.
 */
export function RouteReset() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    // Scope to `main` so we pick the route's heading, not a heading that
    // might live in a global fragment (e.g. an error banner). Landing
    // doesn't render a <main>, but it's also only reachable on initial
    // load — which we skip via isFirstRender — so the gap is harmless.
    const heading = document.querySelector<HTMLHeadingElement>("main h1, main h2");
    if (heading) {
      // Only set tabIndex if the screen didn't already express intent —
      // a heading explicitly set to tabindex="0" stays Tab-reachable.
      if (!heading.hasAttribute("tabindex")) {
        heading.tabIndex = -1;
      }
      heading.focus({ preventScroll: true });
    }
  }, [location]);

  return null;
}
