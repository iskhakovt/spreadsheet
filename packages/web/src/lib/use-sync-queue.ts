import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeValue } from "./crypto.js";
import { getAnswers } from "./storage.js";
import { flushPendingOps } from "./sync-flush.js";
import { useTRPC } from "./trpc.js";

/**
 * Debounced sync queue for journal writes.
 *
 * Owns the 3-second debounce timer, the sync-indicator delay, and the
 * push round-trip. The actual push + conflict-merge logic is in
 * `sync-flush.ts#flushPendingOps`, shared with `useMarkComplete` so
 * there is exactly one code path that clears the pending-ops queue.
 *
 * `handleSync` and `scheduleSync` are exposed with stable references
 * (empty dep array). `pushMutation` changes identity every render
 * so it's accessed through a ref.
 */
export function useSyncQueue(totalQuestions: number) {
  const trpc = useTRPC();
  const pushMutation = useMutation(trpc.sync.push.mutationOptions());

  const [showSyncIndicator, setShowSyncIndicator] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncIndicatorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Guard against re-entrancy: if handleSync is called while a previous
  // invocation is still in flight, bail out early. The debounce timer will
  // reschedule on the next answer.
  const inFlightRef = useRef(false);

  // Mutable inputs held in refs so the callbacks below can be stable
  // across re-renders. `pushMutation` specifically changes identity every
  // render — useMutation doesn't guarantee a stable result object — so
  // we call `.mutateAsync` through the ref instead of closing over it.
  const totalQuestionsRef = useRef(totalQuestions);
  totalQuestionsRef.current = totalQuestions;
  const pushMutationRef = useRef(pushMutation);
  pushMutationRef.current = pushMutation;

  // Stable across the hook's lifetime — empty dep array.
  const handleSync = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await flushPendingOps(
        (input) => pushMutationRef.current.mutateAsync(input),
        async () =>
          encodeValue({
            answered: Object.keys(getAnswers()).length,
            total: totalQuestionsRef.current,
          }),
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  /**
   * Schedule or cancel a debounced sync. Call this whenever the pending
   * ops count changes (typically from an effect watching localStorage).
   *
   * - If `pendingCount === 0`: clear any scheduled sync and hide the indicator
   * - Otherwise: reset the 3s debounce timer + the 5s indicator timer
   *
   * Stable across the hook's lifetime — callers can safely use it as a
   * `useEffect` dep without triggering spurious re-runs.
   */
  const scheduleSync = useCallback(
    (pendingCount: number) => {
      clearTimeout(syncTimerRef.current);
      clearTimeout(syncIndicatorTimerRef.current);
      if (pendingCount === 0) {
        setShowSyncIndicator(false);
        return;
      }
      syncTimerRef.current = setTimeout(() => {
        void handleSync();
      }, 3000);
      syncIndicatorTimerRef.current = setTimeout(() => setShowSyncIndicator(true), 5000);
    },
    [handleSync],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(syncTimerRef.current);
      clearTimeout(syncIndicatorTimerRef.current);
    };
  }, []);

  return {
    syncing: pushMutation.isPending,
    showSyncIndicator,
    handleSync,
    scheduleSync,
  };
}
