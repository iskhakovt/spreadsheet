import { decodeOpaque, encodeOpaque } from "@spreadsheet/shared";
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
async function importKey(base64urlKey: string): Promise<CryptoKey> {
  const raw = base64urlDecode(base64urlKey);
  return crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: ALGO, length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a string. Returns base64url(iv || ciphertext) */
async function encryptRaw(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  // Prepend IV to ciphertext
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return base64urlEncode(combined);
}

/** Decrypt base64url(iv || ciphertext) back to a string */
async function decryptRaw(encoded: string, key: CryptoKey): Promise<string> {
  const combined = base64urlDecode(encoded);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/**
 * Encode a value as an opaque string.
 * - Plaintext mode: `p:1:json`
 * - Encrypted mode: `e:1:base64url(iv || ciphertext)`
 *
 * groupKey: omit to use the session key, pass null to force plaintext, pass a string to encrypt with that key.
 */
export async function encodeValue(value: unknown, groupKey?: string | null): Promise<string> {
  const resolvedKey = groupKey === undefined ? getGroupKeyFromUrl() : groupKey;
  const json = JSON.stringify(value);
  if (!resolvedKey) {
    return encodeOpaque(false, json);
  }
  const key = await importKey(resolvedKey);
  const encrypted = await encryptRaw(json, key);
  return encodeOpaque(true, encrypted);
}

/**
 * Decode an opaque string back to a value.
 * Handles both `p:1:` and `e:1:` prefixes.
 *
 * groupKey: omit to use the session key, pass a string to decrypt with that key.
 */
export async function decodeValue<T = unknown>(opaque: string, groupKey?: string | null): Promise<T> {
  const { mode, payload } = decodeOpaque(opaque);
  if (mode === "p") {
    return JSON.parse(payload) as T;
  }
  const resolvedKey = groupKey === undefined ? getGroupKeyFromUrl() : groupKey;
  if (!resolvedKey) {
    throw new MissingKeyError();
  }
  const key = await importKey(resolvedKey);
  const json = await decryptRaw(payload, key);
  return JSON.parse(json) as T;
}

/**
 * Extract the group key from the URL fragment.
 * URL format: https://example.com/p/token#key=base64urlKey
 * Returns null if no key in fragment (plaintext mode).
 *
 * The key is held in a module-scoped variable (in-memory only):
 * - TanStack Router drops the hash fragment during client-side navigation,
 *   so we cache the key the first time we see it in the URL.
 * - In-memory storage never leaves a trace (unlike sessionStorage) and is
 *   not accessible to other scripts via the Web Storage API.
 * - A full page reload clears the cache — the user must navigate back via
 *   a full link that includes the #key= fragment, which is the expected flow.
 */
// Module-level cache keyed by the session scope. Scoping prevents the
// "earlier encrypted group's key leaks into a later unrelated group" bug —
// without it, navigating from `/p/TOKEN_A#key=...` to a later `/p/TOKEN_B`
// in the same tab would return TOKEN_A's key for TOKEN_B, and TOKEN_B's
// unencrypted data would silently be wrapped with TOKEN_A's key (observed
// as `e:1:` payloads on a `group.encrypted = false` row).
let cachedGroupKey: string | null = null;
let cachedScope: string | null = null;

export function getGroupKeyFromUrl(): string | null {
  if (typeof window === "undefined") return cachedGroupKey;

  const scope = getScope();
  // Invalidate the module cache when the token has changed — otherwise
  // the previous group's key stays cached and gets returned for the new group.
  if (cachedScope !== scope) {
    cachedGroupKey = null;
    cachedScope = scope;
  }

  const hash = window.location.hash;
  if (hash) {
    const params = new URLSearchParams(hash.slice(1));
    const key = params.get("key");
    if (key) {
      cachedGroupKey = key;
    }
  }
  return cachedGroupKey;
}

/**
 * Wrap a sensitive string for storage — encrypts if session key exists, returns raw otherwise.
 * Use for names, anatomy, and other PII that should be encrypted in encrypted groups.
 */
export async function wrapSensitive(value: string): Promise<string> {
  const key = getGroupKeyFromUrl();
  if (!key) return value;
  return encodeValue(value);
}

/**
 * Unwrap a stored sensitive string — decodes if opaque format (p:N: or e:N:), returns raw otherwise.
 * Safe to call on both encrypted and plaintext values.
 *
 * groupKey: omit to use session key, pass explicitly in tests.
 */
export async function unwrapSensitive(value: string, groupKey?: string | null): Promise<string> {
  if (/^[pe]:\d+:/.test(value)) {
    return decodeValue<string>(value, groupKey);
  }
  return value;
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

function base64urlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
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
