import { NonRetriableError } from "./errors.js";
import { getScope } from "./session.js";

/** Thrown when encrypted data is encountered but no group key is available. */
export class MissingKeyError extends NonRetriableError {
  readonly code = "MISSING_GROUP_KEY" as const;
  constructor() {
    super("Cannot decrypt without group key");
    this.name = "MissingKeyError";
  }
}

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits — recommended for AES-GCM

/** Generate a new AES-256-GCM key and export as base64url string */
export async function generateGroupKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: ALGO, length: KEY_LENGTH },
    true, // extractable
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return base64urlEncode(new Uint8Array(raw));
}

/** Import a base64url-encoded key string into a CryptoKey */
export async function importGroupKey(base64urlKey: string): Promise<CryptoKey> {
  const raw = base64urlDecode(base64urlKey);
  return crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: ALGO, length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Smallest padded plaintext, in bytes. AES-GCM ciphertext is exactly as long
 * as its plaintext, so without padding the server could read an answer off
 * the length of its op: the five ratings serialize to five different lengths,
 * and the question key and set-vs-clear shift it further. 256 covers every
 * note-less op (longest today: 94 bytes) with room for short notes and longer
 * future question ids, so all of those encrypt to one identical length.
 */
const MIN_PADDED_BYTES = 256;

/**
 * UTF-8 encode a JSON string and pad it with trailing spaces to a size bucket:
 * MIN_PADDED_BYTES, then the next power of two. Above the floor (long notes)
 * the length reveals only which bucket a value fell in.
 *
 * Trailing whitespace is insignificant to `JSON.parse`, so this stays inside
 * the `e:1:` format: opening needs no unpadding step, clients still on
 * pre-padding code read padded values unchanged, and older unpadded values
 * keep decoding as before.
 */
function padJson(json: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(json);
  let size = MIN_PADDED_BYTES;
  while (size < bytes.length) size *= 2;
  const padded = new Uint8Array(size).fill(0x20); // ASCII space
  padded.set(bytes);
  return padded;
}

/**
 * Pad and encrypt a JSON string. Returns base64url(iv || ciphertext), the
 * payload of an `e:1:` sealed value. Only the group codec calls this.
 */
export async function encryptJson(json: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, padJson(json));
  // Prepend IV to ciphertext
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return base64urlEncode(combined);
}

/**
 * Decrypt base64url(iv || ciphertext) back to its JSON string (padding
 * included; JSON.parse ignores it). Throws if the key is wrong or the
 * ciphertext was tampered with: GCM authenticates it.
 */
export async function decryptJson(encoded: string, key: CryptoKey): Promise<string> {
  const combined = base64urlDecode(encoded);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/**
 * Extract the group key from the URL fragment.
 * URL format: https://example.com/p/token#key=base64urlKey
 * Returns null if no key in fragment (plaintext mode).
 *
 * The key is persisted to sessionStorage because:
 * - wouter's pushState drops the hash fragment during client-side navigation
 * - A full page reload clears in-memory state
 * sessionStorage survives reloads but not new tabs (each tab needs its own key from the URL).
 */
// Module-level cache keyed by the session scope. Scoping is what prevents
// the "earlier encrypted group's key leaks into a later unrelated group"
// bug — without it, navigating from `/p/TOKEN_A#key=...` to a later
// `/p/TOKEN_B` in the same tab would return TOKEN_A's key for TOKEN_B,
// and TOKEN_B's unencrypted data would silently be wrapped with TOKEN_A's
// key (observed as `e:1:` payloads on a `group.encrypted = false` row).
let cachedGroupKey: string | null = null;
let cachedScope: string | null = null;

export function getGroupKeyFromUrl(): string | null {
  if (typeof window === "undefined") return cachedGroupKey;

  const scope = getScope();
  // Invalidate the module cache when the token has changed — otherwise
  // the previous group's key stays cached and gets returned for the new
  // group. sessionStorage is also scope-prefixed below so the fallback
  // read can't cross-contaminate either.
  if (cachedScope !== scope) {
    cachedGroupKey = null;
    cachedScope = scope;
  }

  const key = keyFromHash();
  // One page = one key: once this page uses a key for this person, a
  // different one in the fragment doesn't replace it in place. Everything
  // the page opened, verified and cached is tied to the first key;
  // `isKeySwitch` tells the layout to reload into the new one instead.
  if (key && cachedGroupKey === null) {
    cachedGroupKey = key;
    sessionStorage.setItem(`${scope}groupKey`, key);
  }
  if (!cachedGroupKey) {
    cachedGroupKey = sessionStorage.getItem(`${scope}groupKey`);
  }
  return cachedGroupKey;
}

/** The `#key=` value in the URL fragment, or null. */
function keyFromHash(): string | null {
  const { hash } = window.location;
  return hash ? new URLSearchParams(hash.slice(1)).get("key") : null;
}

/**
 * True when a `#key=` arrives on a person page that loaded without one
 * (e.g. the same link pasted again with its fragment). Nothing on the page
 * used a key yet, so the right move is the same as a switch: reload into
 * it, so the page starts over with the key instead of staying on the
 * missing-key screen.
 */
export function isKeyArrival(): boolean {
  if (typeof window === "undefined" || cachedGroupKey !== null) return false;
  return window.location.pathname.startsWith("/p/") && keyFromHash() !== null;
}

/**
 * True when the URL fragment carries a different key than the one this
 * page already uses for the current person: the key counterpart of
 * `isPersonSwitch`. The caller reloads (a fresh page adopts the fragment's
 * key and verifies it from scratch) rather than switching keys in place,
 * where cached, already-verified state would be sealed under the new key.
 */
export function isKeySwitch(): boolean {
  if (typeof window === "undefined" || cachedScope !== getScope() || cachedGroupKey === null) return false;
  const key = keyFromHash();
  return key !== null && key !== cachedGroupKey;
}

/**
 * Build a full person link including the #key= fragment when a group key
 * is available. Works for any token — the current user's or a partner's.
 */
export function buildPersonLink(token: string): string {
  const groupKey = getGroupKeyFromUrl();
  const keyFragment = groupKey ? `#key=${groupKey}` : "";
  return `${window.location.origin}/p/${token}${keyFragment}`;
}

// --- base64url helpers (no padding) ---

/** Bytes per `String.fromCharCode` call, well under engines' argument-count limits. */
const BINARY_CHUNK = 0x8000;

function base64urlEncode(bytes: Uint8Array): string {
  // Chunked: spreading a whole buffer into one call throws RangeError once it
  // passes the engine's argument limit (V8: somewhere between 64 and 128 KiB).
  // Padding rounds long notes up to powers of two, which reaches that limit.
  let binary = "";
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
