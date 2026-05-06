import { encodeOpaque } from "./crypto.js";
import type { Answer } from "./types.js";

/**
 * Build a `p:1:` plaintext journal op for tests. Typing `data` against
 * Answer means dropping a field from the schema fails compile at fixture
 * sites instead of silently leaving stale keys — Zod would strip unknown
 * keys on read, masking the change (this is how `timing` survived #131).
 * Used by both server and web tests; tests that need legacy/extra keys to
 * exercise the strip-on-read path build the raw string by hand.
 */
export function plainOp(key: string, data: Answer | null): string {
  return encodeOpaque(false, JSON.stringify({ key, data }));
}

/** Progress envelope counterpart to {@link plainOp}. */
export function plainProgress(payload: { answered: number; total: number }): string {
  return encodeOpaque(false, JSON.stringify(payload));
}
