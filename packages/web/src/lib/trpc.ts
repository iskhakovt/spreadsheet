import { createTRPCClient, createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { getAuthToken } from "./session.js";

// WebSocket URL is built lazily inside createWSClient so SSR-style tooling
// (which has no `location`) doesn't crash on import.
const wsUrl = (): string => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/trpc-ws`;
};

/**
 * Single tRPC WebSocket client per tab. We use lazy mode so the WS doesn't
 * connect until the first subscription is started — this guarantees that
 * `connectionParams` is evaluated AFTER PersonApp has called `setSession()`
 * and the auth token is available.
 *
 * Known limitation: if the user navigates between two `/p/:token` URLs in
 * the same tab (rare — normally a fresh page load), the existing WS keeps
 * its original auth context. New subscriptions still go through the same
 * connection so they'd be authorized as the previous person. The polling
 * fallback in `useGroupStatus` recovers within `pollMs` and a hard reload
 * fixes it permanently.
 */
const wsClient = createWSClient({
  url: wsUrl,
  lazy: { enabled: true, closeMs: 5_000 },
  connectionParams: () => {
    const token = getAuthToken();
    return token ? { token } : {};
  },
});

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        url: "/api/trpc",
        headers() {
          const token = getAuthToken();
          return token ? { "x-person-token": token } : {};
        },
      }),
    }),
  ],
});
