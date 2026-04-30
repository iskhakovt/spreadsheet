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
 */
export function useSyncQueue(totalQuestions: number) {
  const trpc = useTRPC();
  const pushMutation = useMutation(trpc.sync.push.mutationOptions());

  const [showSyncIndicator, setShowSyncIndicator] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncIndicatorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Re-entrancy guard. Lifetime-stable ref — write only inside the callback.
  const inFlightRef = useRef(false);

  const handleSync = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await flushPendingOps(
        (input) => pushMutation.mutateAsync(input),
        async () =>
          encodeValue({
            answered: Object.keys(getAnswers()).length,
            total: totalQuestions,
          }),
      );
      inFlightRef.current = false;
    } catch (err) {
      inFlightRef.current = false;
      throw err;
    }
  }, [pushMutation, totalQuestions]);

  /**
   * Schedule or cancel a debounced sync. Call this whenever the pending
   * ops count changes (typically from an effect watching localStorage).
   *
   * - If `pendingCount === 0`: clear any scheduled sync and hide the indicator
   * - Otherwise: reset the 3s debounce timer + the 5s indicator timer
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
