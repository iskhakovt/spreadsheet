import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { wsClient } from "./trpc.js";

/**
 * Drops cache state scoped to the previous person when the URL token changes
 * within the same tab.
 *
 * The WS is closed so the next subscription reauthenticates with the new
 * session's `connectionParams`. HTTP query caches are evicted by key prefix:
 * `groups`, `sync`, and `questions` all use shared keys (no token in their
 * input shape), so navigating between two `/p/$token` URLs in the same tab
 * would otherwise hand back the previous person's data until the next WS
 * push lands.
 */
export function useTokenSwitchCleanup(token: string) {
  const queryClient = useQueryClient();
  const prevTokenRef = useRef(token);
  useEffect(() => {
    if (prevTokenRef.current === token) return;
    wsClient.close();
    queryClient.invalidateQueries({ queryKey: [["groups"]] });
    queryClient.invalidateQueries({ queryKey: [["sync"]] });
    queryClient.invalidateQueries({ queryKey: [["questions"]] });
    prevTokenRef.current = token;
  }, [token, queryClient]);
}
