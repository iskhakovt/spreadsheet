import type { GroupStatus } from "@spreadsheet/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useRef } from "react";
import { decryptStatus } from "./decrypt-status.js";
import { useTRPC } from "./trpc.js";

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
export function useLiveStatus(): { status: GroupStatus | null; refresh: () => Promise<void> } {
  // React Compiler reports a false-positive "Cannot access refs during render"
  // — `seqRef.current` is only touched inside the async `onData` callback. The
  // compiler can't prove the callback isn't synchronous, so it falls back to
  // the unmemoized form. The directive marks intent and guards against stricter
  // panicThreshold settings. See facebook/react#35982.
  "use no memo";
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Grab the proxy-generated options (stable queryKey, typed queryFn) and
  // override the queryFn to decrypt before returning. The cache stores the
  // decrypted shape — readers don't need an extra useEffect cycle.
  const baseOptions = trpc.groups.status.queryOptions();
  const { data: status } = useSuspenseQuery({
    ...baseOptions,
    queryFn: async (context) => {
      // biome-ignore lint/style/noNonNullAssertion: proxy-generated queryFn is always defined at runtime
      const raw = await baseOptions.queryFn!(context);
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
          queryClient.setQueryData(baseOptions.queryKey, decrypted);
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
    await queryClient.invalidateQueries({ queryKey: baseOptions.queryKey });
  }

  return { status, refresh };
}
