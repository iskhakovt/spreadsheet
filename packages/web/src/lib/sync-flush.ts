import { mergeAfterRejection } from "./journal.js";
import { drainPendingOps, getAnswers, getPendingOps, getStoken, setAnswers, setStoken } from "./storage.js";

interface PushInput {
  stoken: string | null;
  operations: string[];
  progress?: string;
}

interface PushResult {
  stoken: string | null;
  pushRejected: boolean;
  entries: string[];
}

type PushFn = (input: PushInput) => Promise<PushResult>;

/**
 * Shared push-pending-ops flow used by both the debounced auto-sync and
 * the mark-complete flush. Having a single code path that clears
 * `pendingOps` is what prevents the "Summary → Review → Done orphans
 * in-flight answers" class of bugs — there is literally only one place
 * that removes entries from the queue, and it only runs after the
 * server has acknowledged the push.
 *
 * `getProgress` is a factory (not a value) so the caller can recompute
 * on the retry path, where the answered-count changes after merging
 * rejected entries. Pass `() => Promise.resolve(undefined)` to skip the
 * server-side progress update — useful for the final flush on
 * mark-complete where progress is about to be moot anyway.
 *
 * Handles conflict-merge retry once. If the retry also rejects, ops
 * remain in the queue for the next invocation to retry.
 *
 * Clearing: after a successful push we remove only the ops we sent
 * (a prefix of the queue), not the entire queue. If the user answered
 * another question while the push was in flight, that newer op was
 * appended after our snapshot and must survive.
 */
export async function flushPendingOps(push: PushFn, getProgress: () => Promise<string | undefined>): Promise<void> {
  const ops = getPendingOps();
  if (ops.length === 0) return;
  const sentCount = ops.length;

  const progress = await getProgress();
  const result = await push({ stoken: getStoken(), operations: ops, progress });
  setStoken(result.stoken);

  if (!result.pushRejected) {
    drainSent(sentCount);
    return;
  }

  // Merge reconciles the local answer cache with what the server has.
  // The retry re-sends the same `ops` array (not re-read from storage)
  // because ops are append-only journal entries — they don't change
  // after a merge, only the local answers map does. The fresh stoken
  // tells the server "I've seen your latest state, apply these."
  //
  // `mergeAfterRejection` is the same merge that runs on the bootstrap
  // path (`useSelfJournal`) and the WS echo path (`onSelfJournalChange`).
  // Three call sites, one rule: server values win for keys without a
  // pending edit; outbox wins for keys with one. The cache slot picks
  // up this localStorage write via its own subscription's onData when
  // the retry's commit echoes back, so the slot eventually catches up
  // without us poking it directly here.
  const merged = await mergeAfterRejection(getAnswers(), ops, result.entries);
  setAnswers(merged);
  const retryProgress = await getProgress();
  const retry = await push({
    stoken: result.stoken,
    operations: ops,
    progress: retryProgress,
  });
  setStoken(retry.stoken);
  if (!retry.pushRejected) {
    drainSent(sentCount);
    return;
  }
  console.error("Sync retry also rejected — leaving ops pending for next manual sync.");
}

/**
 * Remove the first `count` entries from the pending-ops queue, keeping
 * any that were appended while the push was in flight. Delegates to
 * `drainPendingOps` so the in-memory dedup index shifts in lockstep —
 * naive slice-and-replace would invalidate the whole index and lose
 * dedup state for any unsent ops appended during the flush.
 */
function drainSent(count: number): void {
  const current = getPendingOps();
  drainPendingOps(Math.min(count, current.length));
}
