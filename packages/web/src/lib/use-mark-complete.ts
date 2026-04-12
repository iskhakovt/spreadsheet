import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
export function useMarkComplete(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() });
  const pushMutation = useMutation(trpc.sync.push.mutationOptions());
  const markCompleteMutation = useMutation(trpc.sync.markComplete.mutationOptions({ onSuccess: invalidateStatus }));

  return async () => {
    await flushPendingOps(
      (input) => pushMutation.mutateAsync(input),
      async () => null,
    );
    await markCompleteMutation.mutateAsync();
    navigate("/waiting");
  };
}
