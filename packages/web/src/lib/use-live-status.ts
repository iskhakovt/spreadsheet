import { type QueryKey, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useRef } from "react";
import { decryptStatus, type LiveGroupStatus } from "./decrypt-status.js";
import { getScope } from "./session.js";
import { useTRPC, useTRPCClient } from "./trpc.js";

/**
 * Live-updating group status with TanStack Query + tRPC SSE subscription.
 *
 * Architecture:
 * - `useSuspenseQuery` fetches initial status via HTTP with a wrapped queryFn
 *   that awaits `decryptStatus` before returning, so the cache stores
 *   already-decrypted data. This eliminates the extra render cycle that
 *   async-decrypting-in-a-useEffect would introduce.
 * - `useSubscription` opens a tRPC v11 SSE subscription (via
 *   `httpSubscriptionLink`) to `groups.onStatus`. `onData` async-decrypts
 *   the pushed payload and writes the result into the same TanStack cache
 *   entry via `setQueryData`. A per-mount sequence counter guards against
 *   out-of-order application if two pushes are in flight with their
 *   decryptions interleaved (latest wins).
 * - The subscription is gated on `personId` — during the brief `/setup`
 *   phase (admin token before `setupAdmin` has created the person row),
 *   the auth'd procedure would reject anyway, so we leave the EventSource
 *   un-opened.
 *
 * Error handling: decryption failures throw out of the queryFn, which
 * Suspense-query surfaces to the nearest ErrorBoundary. No separate
 * "error" state tracked in the hook.
 */
export function useLiveStatus(): { status: LiveGroupStatus | null; refresh: () => Promise<void> } {
  // React Compiler reports a false-positive "Cannot access refs during render"
  // — `seqRef.current` is only touched inside the async `onData` callback. The
  // compiler can't prove the callback isn't synchronous, so it falls back to
  // the unmemoized form. The directive marks intent and guards against stricter
  // panicThreshold settings. See facebook/react#35982.
  "use no memo";
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // The cache holds the OPENED status (see decryptStatus), not the sealed
  // wire shape tRPC's query key is tagged with. So the key is widened to a
  // plain QueryKey and the slot is typed by the queryFn instead: reading it
  // through a tRPC-typed key would claim the values are still sealed.
  //
  // The key also carries the session scope, so a same-tab token switch gets
  // its own slot: the previous person's status is never rendered (or acted
  // on, e.g. by the legacy re-seal) under the next person's session. Prefix
  // invalidation through `trpc.groups.status.pathKey()` still matches it.
  const trpcClient = useTRPCClient();
  const statusKey: QueryKey = [...trpc.groups.status.queryKey(), { scope: getScope() }];
  const { data: status } = useSuspenseQuery({
    queryKey: statusKey,
    queryFn: async ({ signal }): Promise<LiveGroupStatus | null> => {
      const raw = await trpcClient.groups.status.query(undefined, { signal });
      return raw ? await decryptStatus(raw) : null;
    },
  });

  // Open the subscription once we have a person. During /setup, personId
  // is null and we don't open it — the server's authed procedure would
  // reject anyway, and there's nothing to stream at that point (admin is
  // alone, filling out a form).
  const personId = status?.person?.id ?? null;

  // Monotonic sequence counter to drop out-of-order decryption results.
  // If two pushes arrive in quick succession and their decryptions
  // interleave, we always want the latest to win.
  const seqRef = useRef(0);

  useSubscription(
    trpc.groups.onStatus.subscriptionOptions(undefined, {
      enabled: !!personId,
      onData: async (raw) => {
        if (!raw) return;
        const mySeq = ++seqRef.current;
        try {
          const decrypted = await decryptStatus(raw);
          // If a newer push landed while we were decrypting, drop this one.
          if (mySeq !== seqRef.current) return;
          queryClient.setQueryData<LiveGroupStatus | null>(statusKey, decrypted);
        } catch (err) {
          console.error("Failed to decrypt status update:", err);
        }
      },
      onError: (err) => {
        console.error("Status subscription error:", err);
      },
    }),
  );

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: statusKey });
  }

  return { status, refresh };
}
