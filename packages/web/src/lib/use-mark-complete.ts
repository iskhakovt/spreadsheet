import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { type GroupCodec, WrongKeyError } from "./codec.js";
import { flushPendingOps } from "./sync-flush.js";
import { useTRPC } from "./trpc.js";

/**
 * Single source of truth for the "mark complete" flow.
 *
 * Always flushes any pending ops BEFORE calling `sync.markComplete`, so
 * answers queued inside the 3-second auto-sync debounce window can't be
 * orphaned when the user navigates out of `/questions` via
 * `/summary → /review → Done`. That navigation unmounts `useSyncQueue`
 * and clears its debounce timer, so the debounced auto-sync no longer
 * fires — the final flush here is the only thing guarding against
 * data loss on that path.
 *
 * Use this hook from every component that calls markComplete. Do not
 * roll your own mark-complete flow: the whole point is that every
 * mark-complete goes through the same flush.
 */
export function useMarkComplete(token: string, codec: GroupCodec): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() });
  const pushMutation = useMutation(trpc.sync.push.mutationOptions());
  const markCompleteMutation = useMutation(trpc.sync.markComplete.mutationOptions({ onSuccess: invalidateStatus }));

  // Re-entrancy guard. Lifetime-stable ref — write only inside the callback.
  const inFlightRef = useRef(false);

  // A flush that reveals a wrong key is rethrown on the next render (the
  // boundary shows the key-mismatch screen) instead of marking complete.
  const [keyError, setKeyError] = useState<WrongKeyError | null>(null);

  const markComplete = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await flushPendingOps(
        (input) => pushMutation.mutateAsync(input),
        async () => undefined,
        codec,
      );
      await markCompleteMutation.mutateAsync();
      void navigate({ to: "/p/$token/waiting", params: { token } });
      inFlightRef.current = false;
    } catch (err) {
      inFlightRef.current = false;
      if (err instanceof WrongKeyError) {
        setKeyError(err);
        return;
      }
      throw err;
    }
  }, [pushMutation, markCompleteMutation, navigate, token, codec]);

  if (keyError) throw keyError;
  return markComplete;
}
