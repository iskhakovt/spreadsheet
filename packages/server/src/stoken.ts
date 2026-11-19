import { openId, sealId } from "./opaque-id.js";

const STOKEN_TAG = "stoken02";

/**
 * Encode the push cursor (the caller's journal head id). Sealed with the
 * same opaque-id cipher as journal cursors, under its own tag, so it no
 * longer reveals the global journal row count.
 */
export function encodeStoken(id: number): string {
  return sealId(id, STOKEN_TAG);
}

/**
 * Inverse of {@link encodeStoken}, or `null` for anything not sealed with
 * the current key under the stoken tag: a rotated `STOKEN_SECRET`, a
 * pre-opaque `v1` token, corrupted storage, tampering. `SyncStore.push`
 * treats `null` as maximally stale rather than an error.
 */
export function decodeStoken(stoken: string): number | null {
  return openId(stoken, STOKEN_TAG);
}
