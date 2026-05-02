import { useEffect, useState } from "react";

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
 * Whether the user almost certainly has a physical keyboard, with progressive
 * confirmation. Initial state from `(any-pointer: fine)` — covers desktops,
 * laptops, and hybrids whose primary pointer is touch but who have a fine
 * pointer available (iPad + Magic Keyboard, Surface). If the initial guess
 * says no, listens for one trusted keydown and flips on — the user has just
 * proven a keyboard exists.
 *
 * The CSS Working Group has acknowledged there is no clean way to detect a
 * physical keyboard (csswg-drafts #3871); this is the best inference today.
 */
export function useHasKeyboard(): boolean {
  const [hasKeyboard, setHasKeyboard] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(any-pointer: fine)").matches;
  });

  useEffect(() => {
    if (hasKeyboard) return;
    function onKey(e: KeyboardEvent) {
      if (e.isTrusted) setHasKeyboard(true);
    }
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [hasKeyboard]);

  return hasKeyboard;
}

/**
 * Display string for the Cmd/Ctrl modifier — `⌘` on Apple devices, `Ctrl`
 * elsewhere. Returns the bare modifier so callers can compose it with any
 * key (e.g. `${modKey()}+↵`).
 */
export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}
