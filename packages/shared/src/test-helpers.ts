import { encodeOpaque } from "./crypto.js";
import type { Answer } from "./types.js";

/**
 * Build a `p:1:` plaintext journal op for tests. Typing `data` against
 * Answer makes field drops fail compile instead of silently leaving stale
 * keys (Zod strips unknowns on read). Tests exercising the strip-on-read
 * path build the raw string by hand.
 */
export function plainOp(key: string, data: Answer | null): string {
  return encodeOpaque(false, JSON.stringify({ key, data }));
}

/** Progress envelope counterpart to {@link plainOp}. */
export function plainProgress(payload: { answered: number; total: number }): string {
  return encodeOpaque(false, JSON.stringify(payload));
}
