import { fnv1a } from "@spreadsheet/shared";
import { createStore } from "zustand/vanilla";

/**
 * Per-tab session state. Set once from URL on mount, read everywhere.
 * Vanilla store (not a React hook) — usable from both React components and plain modules.
 *
 * After the invite/auth token split:
 * - `scope` is derived from the URL token (invite token) — stable across auth token rotations
 * - `authToken` is the actual token sent in API headers (may differ from URL token)
 */
interface Session {
  authToken: string | null;
  scope: string;
}

export const sessionStore = createStore<Session>()(() => ({
  authToken: null,
  scope: "",
}));

/**
 * Set the localStorage scope from the URL (invite) token. Called by PersonApp on mount.
 * Scope is derived from the invite token so localStorage keys stay stable even when
 * the auth token is different (post-claim).
 */
export function setScope(inviteToken: string) {
  const scope = `s${fnv1a(inviteToken)}:`;
  const current = sessionStore.getState();
  if (current.scope !== scope) {
    sessionStore.setState({ scope });
  }
}

/**
 * Set the auth token used for tRPC headers and status queries.
 * Called after claim resolution or setupAdmin.
 */
export function setAuthToken(token: string) {
  const current = sessionStore.getState();
  if (current.authToken !== token) {
    sessionStore.setState({ authToken: token });
  }
}

/** Get the current auth token for tRPC headers. */
export function getAuthToken(): string | null {
  return sessionStore.getState().authToken;
}

/** Get the localStorage key prefix for the current person. */
export function getScope(): string {
  return sessionStore.getState().scope;
}
