import { fnv1a } from "@spreadsheet/shared";
import { createStore } from "zustand/vanilla";

/**
 * Per-tab session state. Set once from URL on mount, read everywhere.
 * Vanilla store (not a React hook) — usable from both React components and plain modules.
 */
interface Session {
  token: string | null;
  hash: string | null;
  exchanged: boolean;
  scope: string;
}

export const sessionStore = createStore<Session>()(() => ({
  token: null,
  hash: null,
  exchanged: false,
  scope: "",
}));

/** Set the current person token. Called by PersonApp on every render. */
export function setSession(token: string) {
  const current = sessionStore.getState();
  if (current.token === token) return;
  sessionStore.setState({ token, hash: fnv1a(token), exchanged: false, scope: `s${fnv1a(token)}:` });
}

/** Mark the session as cookie-exchanged. After this, requests use X-Session-Key. */
export function setExchanged() {
  sessionStore.setState({ exchanged: true });
}

/** Get auth headers for tRPC requests. */
export function getAuthHeaders(): Record<string, string> {
  const { token, hash, exchanged } = sessionStore.getState();
  if (exchanged && hash) return { "x-session-key": hash };
  if (token) return { "x-person-token": token };
  return {};
}

/** Get auth params for the WebSocket connectionParams. */
export function getAuthParams(): Record<string, string> {
  const { token, hash, exchanged } = sessionStore.getState();
  if (exchanged && hash) return { sessionKey: hash };
  if (token) return { token };
  return {};
}

/** Get the current person token. */
export function getAuthToken(): string | null {
  return sessionStore.getState().token;
}

/** Get the localStorage key prefix for the current person. */
export function getScope(): string {
  return sessionStore.getState().scope;
}
