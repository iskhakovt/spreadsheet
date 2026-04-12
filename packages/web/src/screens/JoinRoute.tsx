import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card } from "../components/Card.js";
import { setScope } from "../lib/session.js";
import { getStoredAuthToken, setStoredAuthToken } from "../lib/storage.js";
import { useTRPCClient } from "../lib/trpc.js";

type JoinState = "pending" | "claiming" | "already_claimed";

/**
 * Replace the current URL with `/p/:authToken`, preserving the hash fragment
 * (which carries the encryption key). Uses `location.replace` so the invite
 * URL doesn't linger in browser history.
 */
function redirectToAuth(authToken: string) {
  const hash = window.location.hash; // e.g. "#key=abc..."
  window.location.replace(`/p/${authToken}${hash}`);
}

/**
 * Landing page for invite links (`/join/:inviteToken`).
 *
 * Claims the invite token to generate an auth token, caches it in localStorage
 * (crash safety), then redirects to `/p/:authToken`. If the token was already
 * claimed by another browser, shows an error screen.
 */
export function JoinRoute() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const client = useTRPCClient();

  // Scope localStorage to the invite token so getStoredAuthToken reads the
  // correct cached value if this is a retry after an interrupted redirect.
  setScope(inviteToken);

  // Fast path: if we already claimed this invite token (previous visit or
  // interrupted redirect), skip the network call and redirect immediately.
  const cached = getStoredAuthToken();
  if (cached) {
    redirectToAuth(cached);
    return null;
  }

  const [state, setState] = useState<JoinState>("pending");

  // biome-ignore lint/correctness/useExhaustiveDependencies: claim once on mount
  useEffect(() => {
    if (state !== "pending") return;
    setState("claiming");

    client.groups.claim
      .mutate({ inviteToken })
      .then((result) => {
        // Cache first (crash safety), then redirect.
        setStoredAuthToken(result.authToken);
        redirectToAuth(result.authToken);
      })
      .catch((err: unknown) => {
        const code =
          err && typeof err === "object" && "data" in err
            ? (err as { data?: { code?: string } }).data?.code
            : undefined;
        if (code === "CONFLICT") {
          setState("already_claimed");
          return;
        }
        // Unexpected error — surface it. NOT_FOUND shouldn't happen here
        // because only invite links point to /join/.
        throw err;
      });
  }, [inviteToken]);

  if (state === "already_claimed") {
    return (
      <Card>
        <div className="text-center pt-16 space-y-6">
          <h1 className="text-2xl font-bold">Link already activated</h1>
          <p className="text-text-muted">
            This invite link has already been opened in another browser. For your privacy, each link can only be
            activated once.
          </p>
          <p className="text-sm text-text-muted">
            Please use the browser where you first opened this link, or ask the group admin to send a new invite.
          </p>
        </div>
      </Card>
    );
  }

  // pending / claiming — show nothing while the claim + redirect is in flight
  return null;
}
