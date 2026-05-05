import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { JOURNAL_QUERY_KEY } from "./journal-query.js";
import { SELF_JOURNAL_QUERY_KEY } from "./self-journal.js";

/**
 * Drops cache state scoped to the previous person when the URL token changes
 * within the same tab.
 *
 * HTTP query caches are reset by key prefix: `groups`, `sync`, and `questions`
 * all use shared keys (no token in their input shape), so navigating between
 * two `/p/$token` URLs in the same tab would otherwise hand back the previous
 * person's data.
 *
 * Active SSE subscriptions are torn down by the `key={token}` remount on the
 * authed subtree in `routes/p/$token/route.tsx`, NOT by this hook —
 * `resetQueries` does not unmount components or cancel `useSubscription`s,
 * so without that key prop the previous EventSource would keep streaming
 * under the old session-key.
 *
 * Two key shapes coexist in the cache:
 *   1. tRPC-proxy keys, nested-array form: `[["sync", "selfJournal"], …]`.
 *      Reset by the prefix `[["sync"]]`.
 *   2. Hand-rolled flat keys for derived slots: `["sync", "self-journal"]`
 *      (useSelfJournal cache) and `["sync", "journal", "derived"]`
 *      (Comparison cache). The nested-array prefix above does NOT match
 *      these — the first element of the prefix is the array `["sync"]`,
 *      while the first element of these flat keys is the string `"sync"`.
 *      They must be reset explicitly, otherwise navigating from /p/A to
 *      /p/B in the same tab would hand B's first render A's answers.
 *
 * `resetQueries` (not `invalidateQueries`) — the latter marks data stale and
 * keeps it in the cache until refetch lands, so subscribed components would
 * render the previous person's name, anatomy, completion state, journal, etc.
 * for the duration of the round-trip. Reset clears the data and re-suspends,
 * which is the correct semantic for "this tab is a different person now."
 */
export function useTokenSwitchCleanup(token: string) {
  const queryClient = useQueryClient();
  const prevTokenRef = useRef(token);
  useEffect(() => {
    if (prevTokenRef.current === token) return;
    queryClient.resetQueries({ queryKey: [["groups"]] });
    queryClient.resetQueries({ queryKey: [["sync"]] });
    queryClient.resetQueries({ queryKey: [["questions"]] });
    queryClient.resetQueries({ queryKey: SELF_JOURNAL_QUERY_KEY });
    queryClient.resetQueries({ queryKey: JOURNAL_QUERY_KEY });
    prevTokenRef.current = token;
  }, [token, queryClient]);
}
