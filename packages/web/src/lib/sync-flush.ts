import { OperationPayload, type Progress, type Sealed } from "@spreadsheet/shared";
import { assertKeyOpens, type GroupCodec } from "./codec.js";
import { mergeAfterRejection } from "./journal.js";
import { acknowledgePendingOps, getAnswers, getPendingOps, getStoken, setAnswers, setStoken } from "./storage.js";

interface PushInput {
  stoken: string | null;
  operations: Sealed<OperationPayload>[];
  progress?: Sealed<Progress>;
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
 * Clearing: after a successful push we remove exactly the ops we sent
 * (`acknowledgePendingOps`), not the entire queue or a prefix of it. An op
 * queued while the push was in flight must survive, including an edit to
 * a key in the batch, which dedup moves to the end of the queue.
 */
export async function flushPendingOps(
  push: PushFn,
  getProgress: () => Promise<Sealed<Progress> | undefined>,
  codec: GroupCodec,
): Promise<void> {
  const ops = getPendingOps();
  if (ops.length === 0) return;

  const progress = await getProgress();
  // While the key is unproven, send no stoken: one another tab saved would
  // get this push accepted without checking your existing entries. Without
  // it, any entries come back in a rejection and are checked below.
  const stoken = codec.encrypted && !codec.keyProven ? null : getStoken();
  const result = await push({ stoken, operations: ops, progress });

  if (!result.pushRejected) {
    setStoken(result.stoken);
    acknowledgePendingOps(ops);
    return;
  }

  // Merge reconciles the local answer cache with what the server has,
  // against the current outbox: an edit made while the push was in flight
  // must win over the history the rejection returns. The retry re-sends
  // the same `ops` array, which is what a successful retry acknowledges.
  // The fresh stoken tells the server "I've seen your latest state, apply these."
  //
  // `mergeAfterRejection` is the same merge that runs on the bootstrap
  // path (`useSelfJournal`) and the SSE echo path (`onSelfJournalChange`).
  // Three call sites, one rule: server values win for keys without a
  // pending edit; outbox wins for keys with one. The cache slot picks
  // up this localStorage write via its own subscription's onData when
  // the retry's commit echoes back, so the slot eventually catches up
  // without us poking it directly here.
  // The rejection carries your own unseen entries, possibly the first
  // evidence about this tab's key: stop with WrongKeyError if none opens,
  // rather than merge them away and retry under the wrong key.
  await assertKeyOpens(codec, result.entries, OperationPayload);
  // Saved only after the check: acknowledging entries that refute the key
  // would let the next flush append on top of them.
  setStoken(result.stoken);
  const merged = await mergeAfterRejection(getAnswers(), getPendingOps(), result.entries, codec);
  setAnswers(merged);
  const retryProgress = await getProgress();
  const retry = await push({
    stoken: result.stoken,
    operations: ops,
    progress: retryProgress,
  });
  if (!retry.pushRejected) {
    setStoken(retry.stoken);
    acknowledgePendingOps(ops);
    return;
  }
  // Same check before acknowledging a second rejection's entries.
  await assertKeyOpens(codec, retry.entries, OperationPayload);
  setStoken(retry.stoken);
  console.error("Sync retry also rejected — leaving ops pending for next manual sync.");
}
