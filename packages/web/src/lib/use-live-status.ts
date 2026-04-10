import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useState } from "react";
import { decryptStatus } from "./decrypt-status.js";
import { type trpc as legacyTrpcClient, useTRPC } from "./trpc.js";

type RawStatus = NonNullable<Awaited<ReturnType<typeof legacyTrpcClient.groups.status.query>>>;
type StatusState = RawStatus | null | "loading" | "error";

/**
 * Live-updating group status with TanStack Query + tRPC WS subscription.
 *
 * Architecture:
 * - `useSuspenseQuery` fetches initial status via HTTP and suspends until the
 *   data is available. Stable queryKey keyed by token.
 * - `useSubscription` opens a tRPC v11 WS subscription to `groups.onStatus`.
 *   Each push updates the same TanStack cache entry via `setQueryData` —
 *   the query and subscription share one source of truth.
 * - Decryption runs in a `useEffect` keyed on the raw cache value so encrypted
 *   groups get transparent unwrapping on the client. The cache stores raw
 *   (encrypted) payloads; consumers read the decrypted derived state.
 * - The subscription is gated on `personId` — during the brief `/setup` phase
 *   (admin token before `setupAdmin` has created the person row), the auth'd
 *   subscription has nothing to subscribe to and we intentionally leave it
 *   closed. Once status.person becomes non-null, the effect re-runs and opens
 *   the WS.
 *
 * Returns the same surface as the old `useGroupStatus` hook so call sites in
 * PersonApp don't change: `status` + `refresh`.
 */
export function useLiveStatus(token: string): { status: StatusState; refresh: () => Promise<void> } {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Initial fetch (suspends) and subsequent subscription-driven updates all
  // land in the same cache entry.
  const { data: raw } = useSuspenseQuery(trpc.groups.status.queryOptions({ token }));

  // Decrypted derivation from the (possibly encrypted) cached value. Runs
  // asynchronously; while the first decryption is in flight the status is
  // "loading". Re-runs whenever the cache gets a fresh push.
  const [status, setStatus] = useState<StatusState>("loading");

  useEffect(() => {
    let cancelled = false;
    if (raw === null) {
      setStatus(null);
      return;
    }
    decryptStatus(raw)
      .then((decrypted) => {
        if (!cancelled) setStatus(decrypted);
      })
      .catch((err) => {
        console.error("Failed to decrypt status:", err);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [raw]);

  // Open the WS subscription once we have a person. During /setup, personId
  // is null and we don't open the subscription — the server's authed
  // procedure would reject anyway, and there's nothing to stream at that
  // point (admin is alone, filling out a form).
  const personId = typeof status === "object" && status?.person ? status.person.id : null;

  useSubscription(
    trpc.groups.onStatus.subscriptionOptions(undefined, {
      enabled: !!personId,
      onData: (next) => {
        if (!next) return;
        queryClient.setQueryData(trpc.groups.status.queryKey({ token }), next);
      },
      onError: (err) => {
        console.error("WS subscription error:", err);
      },
    }),
  );

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: trpc.groups.status.queryKey({ token }) });
  }

  return { status, refresh };
}
