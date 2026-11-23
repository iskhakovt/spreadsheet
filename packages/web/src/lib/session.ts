import { fnv1a } from "@spreadsheet/shared";
import { createStore } from "zustand/vanilla";

/**
 * Per-tab session state — disambiguates which httpOnly session cookie this
 * tab is acting on. Multi-person devices accumulate cookies (`s_${hashA}`,
 * `s_${hashB}`, …); JS can't read them, so each tab tracks the active hash
 * here and sends it as `X-Session-Key` so the server knows which cookie to
 * read.
 *
 * Persisted in `sessionStorage` so the hash survives in-tab reload (e.g.
 * refresh on `/results`) without re-bootstrapping. Cleared by closing the tab.
 *
 * Vanilla store (not a React hook) — usable from both React components and
 * plain modules.
 */
interface Session {
  /** fnv1a hash of the person token; identifies which cookie to read. */
  hash: string | null;
  /** localStorage key prefix scoping this person's client-authored data. */
  scope: string;
}

const STORAGE_KEY = "session.hash";

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // some sandboxed contexts throw on access
  }
}

const initialHash = safeSessionStorage()?.getItem(STORAGE_KEY) ?? null;

export const sessionStore = createStore<Session>()(() => ({
  hash: initialHash,
  scope: initialHash ? `s${initialHash}:` : "",
}));

/**
 * The person this page (document) belongs to: set by the first
 * `adoptSession` in the document and never changed after. Module memory on
 * purpose: a reload starts a new document, so the next page can belong to
 * someone else. The persisted hash above can't serve here, because it can't
 * tell a reload from a switch.
 */
let pagePersonHash: string | null = null;

/**
 * One page = one person. True when `token` belongs to someone other than
 * the person this page already belongs to.
 *
 * The caller must not switch in place: reload instead (see the `/p/$token`
 * layout route). Too much per-tab state outlives an in-place switch: queued
 * tRPC batches read the session header when they go out, async work (sealing,
 * sync retries) re-reads it at each step, and SSE streams keep the previous
 * session's connection. A full page load drops all of it, and it's also what
 * sets the new person's session cookie (the server's `/p/:token` response).
 */
export function isPersonSwitch(token: string): boolean {
  return pagePersonHash !== null && pagePersonHash !== fnv1a(token);
}

/**
 * Adopts a session for the given token. Called from the bootstrap route once,
 * when the user first lands on `/p/$token`. Writes the hash to sessionStorage
 * so reloads in the same tab keep the session.
 *
 * The token itself is not persisted in JS — only its hash. The token lives
 * in the httpOnly cookie set by the server's `/p/:token` response.
 *
 * The in-memory store is updated even when persistence fails (quota,
 * private-browsing modes, sandboxed iframes that throw on `setItem`). The
 * tab still works for its lifetime; only the survive-reload property is lost.
 */
export function adoptSession(token: string) {
  const hash = fnv1a(token);
  pagePersonHash ??= hash;
  if (sessionStore.getState().hash === hash) return;
  try {
    safeSessionStorage()?.setItem(STORAGE_KEY, hash);
  } catch {
    // Storage write failure (quota, private mode, sandbox) — fall through.
  }
  sessionStore.setState({ hash, scope: `s${hash}:` });
}

/**
 * Auth headers for tRPC HTTP requests. Server reads the named cookie
 * `s_${hash}` to recover the token.
 */
export function getAuthHeaders(): Record<string, string> {
  const { hash } = sessionStore.getState();
  return hash ? { "x-session-key": hash } : {};
}

/** Auth params for tRPC subscription `connectionParams` (SSE — sent as URL query string). */
export function getAuthParams(): Record<string, string> {
  const { hash } = sessionStore.getState();
  return hash ? { sessionKey: hash } : {};
}

/** Get the localStorage key prefix for the current person. */
export function getScope(): string {
  return sessionStore.getState().scope;
}

/** Get the current session hash, if any. */
export function getSessionHash(): string | null {
  return sessionStore.getState().hash;
}
