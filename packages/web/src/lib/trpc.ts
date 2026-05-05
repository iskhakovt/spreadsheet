import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { getAuthHeaders, getAuthParams } from "./session.js";

/**
 * Factory for the tRPC client. Exported as a factory (rather than a stable
 * singleton) so the provider tree can wrap it in `useState(() => ...)` for
 * referential stability across renders.
 *
 * Subscriptions ride on the same `/api/trpc` endpoint as queries/mutations
 * via SSE (`httpSubscriptionLink`). Auth travels two equivalent paths:
 *   • Queries/mutations send the session-key hash as `X-Session-Key` header.
 *   • Subscriptions send it as `connectionParams` (URL query string), which
 *     EventSource cannot mint custom headers for. The hash is non-secret —
 *     it's `fnv1a(token)` — so URL exposure is acceptable. The actual token
 *     stays in the httpOnly cookie that travels automatically with the
 *     same-origin EventSource request.
 *
 * Reconnect/resume is handled by tRPC: every `tracked(id, data)` yield from
 * a procedure becomes the SSE event id, the browser's EventSource sends it
 * back as `Last-Event-ID` on reconnect, and tRPC re-invokes the procedure
 * with that as `input.lastEventId` so the backfill query picks up where
 * the stream left off.
 */
export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({
          url: "/api/trpc",
          connectionParams: () => getAuthParams(),
        }),
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
