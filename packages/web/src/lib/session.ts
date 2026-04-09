import { fnv1a } from "@spreadsheet/shared";
import { createStore } from "zustand/vanilla";

/**
 * Per-tab session state. Set once from URL on mount, read everywhere.
 * Vanilla store (not a React hook) — usable from both React components and plain modules.
 */
interface Session {
  token: string | null;
  scope: string;
}

export const sessionStore = createStore<Session>()(() => ({
  token: null,
  scope: "",
}));

/** Set the current person token. Called by PersonApp on every render. */
export function setSession(token: string) {
  const current = sessionStore.getState();
  if (current.token === token) return;
  sessionStore.setState({ token, scope: `s${fnv1a(token)}:` });
}

/** Get the current auth token for tRPC headers. */
export function getAuthToken(): string | null {
  return sessionStore.getState().token;
}

/** Get the localStorage key prefix for the current person. */
export function getScope(): string {
  return sessionStore.getState().scope;
}
