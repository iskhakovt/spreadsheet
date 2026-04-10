import { QueryClient } from "@tanstack/react-query";

/**
 * Factory for the app-wide QueryClient.
 *
 * Defaults reflect the real-time architecture:
 * - Live updates arrive via WS subscriptions (groups.onStatus, sync.onJournalChange).
 * - There is no polling fallback — we rely on wsLink auto-reconnect + tracked() resume + keepAlive.
 * - Background refetch triggers (mount/focus/reconnect) are disabled because the subscription
 *   is the update channel; refetching duplicates work the subscription already did.
 * - staleTime is Infinity so cached data is reused across mount/unmount within gcTime.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 5 * 60_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
