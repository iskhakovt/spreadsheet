import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeValue } from "./crypto.js";
import { mergeAfterRejection } from "./journal.js";
import { clearPendingOps, getAnswers, getPendingOps, getStoken, setAnswers, setStoken } from "./storage.js";
import { useTRPC } from "./trpc.js";

/**
 * Debounced sync queue for journal writes.
 *
 * Owns the 3-second debounce timer, the sync-indicator delay, and the
 * conflict-merge retry loop. Wraps `trpc.sync.push` via `useMutation` so
 * `isPending` replaces the previous `syncingRef` pattern and callers can
 * read live status from React state instead of juggling ref chains.
 *
 * The pending-ops queue and sync cursor stay in scoped localStorage —
 * `useSyncQueue` only provides the transport layer.
 *
 * Identity stability
 * ------------------
 * `handleSync` and `scheduleSync` are exposed with stable references for
 * the entire lifetime of the hook. This matters because Question.tsx uses
 * `scheduleSync` as a `useEffect` dependency — if the identity churned on
 * every render, the effect would clear+reschedule the debounce every
 * render, deferring the sync indefinitely if external renders (e.g. WS
 * pushes in a sibling hook) kept firing faster than 3s.
 *
 * To achieve this, the mutable inputs (`totalQuestions`, `pushMutation`)
 * are kept in refs so the `useCallback` closures don't re-create when
 * those values change. `pushMutation` in particular gets a new object
 * reference on every render because `useMutation`'s result isn't stable
 * in the same way `useQuery`'s `data` is — so we read through a ref and
 * call `mutateAsync` via the ref's current value.
 *
 * Usage:
 * ```tsx
 * const { syncing, showSyncIndicator, handleSync, scheduleSync } = useSyncQueue(totalQuestions);
 *
 * // When a new answer lands, call scheduleSync. If nothing else lands
 * // within 3s, the debounce fires handleSync automatically.
 * useEffect(() => scheduleSync(pendingOps.length), [pendingOps.length, scheduleSync]);
 *
 * // For "mark complete" — flush pending writes first, then call the
 * // markComplete mutation.
 * async function handleMarkComplete() {
 *   await handleSync();
 *   await markCompleteMutation.mutateAsync();
 * }
 * ```
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
    const ops = getPendingOps();
    if (ops.length === 0 || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const progress = await encodeValue({
        answered: Object.keys(getAnswers()).length,
        total: totalQuestionsRef.current,
      });
      const result = await pushMutationRef.current.mutateAsync({
        stoken: getStoken(),
        operations: ops,
        progress,
      });
      setStoken(result.stoken);

      if (!result.pushRejected) {
        clearPendingOps();
        return;
      }

      // Conflict: merge server entries with local, retry once with fresh stoken
      const merged = await mergeAfterRejection(getAnswers(), ops, result.entries);
      setAnswers(merged);
      const retryProgress = await encodeValue({
        answered: Object.keys(merged).length,
        total: totalQuestionsRef.current,
      });
      const retry = await pushMutationRef.current.mutateAsync({
        stoken: result.stoken,
        operations: ops,
        progress: retryProgress,
      });
      setStoken(retry.stoken);
      if (!retry.pushRejected) {
        clearPendingOps();
      } else {
        console.error("Sync retry also rejected — leaving ops pending for next manual sync.");
      }
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
