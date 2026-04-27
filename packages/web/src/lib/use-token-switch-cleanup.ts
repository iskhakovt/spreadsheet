import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { wsClient } from "./trpc.js";

/**
 * Drops cache state scoped to the previous person when the URL token changes
 * within the same tab.
 *
 * The WS is closed so the next subscription reauthenticates with the new
 * session's `connectionParams`. HTTP query caches are reset by key prefix:
 * `groups`, `sync`, and `questions` all use shared keys (no token in their
 * input shape), so navigating between two `/p/$token` URLs in the same tab
 * would otherwise hand back the previous person's data.
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
    wsClient.close();
    queryClient.resetQueries({ queryKey: [["groups"]] });
    queryClient.resetQueries({ queryKey: [["sync"]] });
    queryClient.resetQueries({ queryKey: [["questions"]] });
    prevTokenRef.current = token;
  }, [token, queryClient]);
}
