import { createCipheriv, createDecipheriv, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Opaque wire encoding for `journal_entries.id`.
 *
 * The journal PK is a global bigserial, so exposing it verbatim leaks the
 * total number of answers recorded across every group (and the write rate
 * between two of a caller's own entries). Every id that crosses the wire —
 * entry ids, cursors, SSE event ids, the stoken — goes through `sealId`
 * instead.
 *
 * Encoding: one AES-256 block over `[u64 id BE][8-byte domain tag]`,
 * base64url without padding (always 22 chars). A single-block AES
 * encryption is a keyed pseudorandom permutation, so the output reveals
 * nothing about the id or its ordering. It is deterministic on purpose:
 * the client dedups entries by id, so the same id must always encode to
 * the same string. The domain tag doubles as an integrity check — a
 * tampered or foreign token decrypts to a block whose tag doesn't match
 * (2^-64 forgery odds), and different tags keep cursors and stokens from
 * being swapped for each other.
 *
 * The key is derived from `STOKEN_SECRET` via HKDF, so no new deploy
 * secret is needed. Rotating the secret invalidates every outstanding
 * cursor; callers treat an undecodable cursor as absent (full replay).
 */

const TAG_LENGTH = 8;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const keyCache = new Map<string, Buffer>();

function getSecret(): string {
  const secret = process.env.STOKEN_SECRET;
  if (!secret) {
    throw new Error("STOKEN_SECRET environment variable is required");
  }
  return secret;
}

function getKey(): Buffer {
  const secret = getSecret();
  let key = keyCache.get(secret);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "", "spreadsheet/opaque-id/v1", 32));
    keyCache.set(secret, key);
  }
  return key;
}

function tagBytes(tag: string): Buffer {
  const bytes = Buffer.from(tag, "ascii");
  if (bytes.length !== TAG_LENGTH) {
    throw new Error(`Opaque id tag must be ${TAG_LENGTH} ASCII bytes`);
  }
  return bytes;
}

export function sealId(id: number, tag: string): string {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error("Opaque id must be a non-negative safe integer");
  }
  const block = Buffer.alloc(16);
  block.writeBigUInt64BE(BigInt(id), 0);
  tagBytes(tag).copy(block, 8);
  const cipher = createCipheriv("aes-256-ecb", getKey(), null).setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]).toString("base64url");
}

/** Returns `null` for anything that isn't a token sealed with this key + tag. */
export function openId(token: string, tag: string): number | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const sealed = Buffer.from(token, "base64url");
  if (sealed.length !== 16) return null;
  const decipher = createDecipheriv("aes-256-ecb", getKey(), null).setAutoPadding(false);
  const block = Buffer.concat([decipher.update(sealed), decipher.final()]);
  if (!timingSafeEqual(block.subarray(8), tagBytes(tag))) return null;
  const id = block.readBigUInt64BE(0);
  return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : null;
}

const JOURNAL_ID_TAG = "journal1";

/** Wire form of a journal entry id / cursor / SSE event id. */
export function encodeJournalId(id: number): string {
  return sealId(id, JOURNAL_ID_TAG);
}

/**
 * Inverse of {@link encodeJournalId}. Lenient by design: `null`,
 * malformed, tampered, legacy numeric (pre-opaque clients), or
 * secret-rotated cursors all decode to `null`, which every caller treats
 * as "no cursor" → full backfill. Full backfill is always safe because
 * both journal consumers dedup by entry id.
 */
export function decodeJournalId(token: string | null | undefined): number | null {
  if (!token) return null;
  const id = openId(token, JOURNAL_ID_TAG);
  return id !== null && id > 0 ? id : null;
}

/** Wire form of the nullable numeric cursor returned by the journal stores. */
export function encodeJournalCursor(cursor: number | null): string | null {
  return cursor !== null && cursor > 0 ? encodeJournalId(cursor) : null;
}

export function toWireEntries(
  entries: readonly { id: number; personId: string; operation: string }[],
): { id: string; personId: string; operation: string }[] {
  return entries.map((e) => ({ id: encodeJournalId(e.id), personId: e.personId, operation: e.operation }));
}
