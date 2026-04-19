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
    const heading = document.querySelector<HTMLHeadingElement>("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [location]);

  return null;
}
