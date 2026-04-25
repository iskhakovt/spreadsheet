import { createTRPCClient, createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { getAuthHeaders, getAuthParams } from "./session.js";

// WebSocket URL is built lazily inside createWSClient so SSR-style tooling
// (which has no `location`) doesn't crash on import.
const wsUrl = (): string => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/trpc-ws`;
};

/**
 * Single tRPC WebSocket client per tab. Lazy so the WS doesn't connect until
 * the first subscription — guarantees `connectionParams` is evaluated AFTER
 * PersonApp has called `setSession()` and the auth token is available.
 *
 * Exported so PersonApp can call `wsClient.close()` on token change to force
 * a fresh auth handshake with the new token.
 */
export const wsClient = createWSClient({
  url: wsUrl,
  lazy: { enabled: true, closeMs: 5_000 },
  connectionParams: () => getAuthParams(),
});

/**
 * Factory for the tRPC client. Exported as a factory (rather than a stable
 * singleton) so the provider tree can wrap it in `useState(() => ...)` for
 * referential stability across renders.
 */
export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({ client: wsClient }),
        false: httpBatchLink({
          url: "/api/trpc",
          headers: () => getAuthHeaders(),
        }),
      }),
    ],
  });
}

/**
 * TanStack Query integration bindings. Components use these:
 *
 *   const trpc = useTRPC();
 *   const query = useSuspenseQuery(trpc.groups.status.queryOptions({ token }));
 *   const mutation = useMutation(trpc.groups.markReady.mutationOptions({ onSuccess: ... }));
 *   useSubscription(trpc.groups.onStatus.subscriptionOptions(undefined, { onData: ... }));
 *
 * The legacy stable `trpc` singleton has been removed — every call site goes
 * through `useTRPC()` now. If you need to call a query/mutation imperatively
 * from a non-hook context (rare), use `useTRPCClient()` to grab the vanilla
 * client instead.
 */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
