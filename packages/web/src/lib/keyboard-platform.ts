import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/**
 * Whether the user is on macOS or an Apple device with keyboard support.
 * Used to render the correct modifier glyph in keyboard shortcut hints
 * (⌘ on Apple, Ctrl elsewhere). Wrong-guess failure mode is cosmetic — the
 * underlying handler accepts both metaKey and ctrlKey.
 *
 * Strategy: prefer User-Agent Client Hints (Chromium), fall back to the
 * deprecated-but-still-populated `navigator.platform`. iPadOS 13+ reports
 * `MacIntel` (and is keyboard-capable when paired) — the `^Mac` regex
 * already covers both real Macs and iPad-as-Mac, which is fine here:
 * both should show ⌘ either way.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (uaPlatform) return uaPlatform === "macOS";
  const p = navigator.platform || "";
  if (/^Mac/.test(p)) return true;
  return /iPhone|iPad|iPod/.test(p);
}

/**
 * Display string for the Cmd/Ctrl modifier — `⌘` on Apple devices, `Ctrl`
 * elsewhere. Returns the bare modifier so callers can compose it with any
 * key (e.g. `${modKey()}+↵`).
 */
export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}

/**
 * Module-singleton state for "does the user have a keyboard?". One vanilla
 * Zustand store + one global `keydown` listener, regardless of how many
 * components subscribe via `useHasKeyboard()` — same pattern as `session.ts`.
 *
 * Initial state: `(pointer: fine)` — true when the *primary* pointer is fine
 * (mouse/trackpad/stylus). On real / emulated mobile (Playwright `isMobile`
 * + `hasTouch`) the primary pointer is coarse, so hints are hidden by
 * default. On a hybrid whose primary pointer is coarse but who has a paired
 * keyboard (iPad + Magic Keyboard), the global `keydown` listener flips this
 * on the first trusted keystroke.
 *
 * Why not `any-pointer: fine`? It returns true if *any* fine pointer exists
 * — which mis-fires on emulated mobile in headless Chromium because the
 * host still has a mouse. Primary-pointer is the more honest signal.
 *
 * The CSS Working Group has acknowledged there is no clean way to detect a
 * physical keyboard (csswg-drafts #3871); this is the best inference today.
 */
const keyboardStore = createStore<{ hasKeyboard: boolean }>(() => ({
  hasKeyboard: typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches,
}));

if (typeof window !== "undefined" && !keyboardStore.getState().hasKeyboard) {
  function onKey(e: KeyboardEvent) {
    if (e.isTrusted) keyboardStore.setState({ hasKeyboard: true });
  }
  window.addEventListener("keydown", onKey, { once: true });
}

export function useHasKeyboard(): boolean {
  return useStore(keyboardStore, (s) => s.hasKeyboard);
}
