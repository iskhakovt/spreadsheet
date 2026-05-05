import { Answer, type OperationPayload } from "@spreadsheet/shared";
import { decodeValue } from "./crypto.js";

/**
 * Validate that a decoded operation key matches the canonical
 * `questionId:role` shape. Rejects malformed input AND prototype-pollution
 * vectors (`__proto__`, `constructor`, `prototype`) by construction —
 * those don't match the regex.
 *
 * The `state` accumulator below is also Object.create(null) for defense
 * in depth, but the regex check is the load-bearing guard because callers
 * (mergeAfterRejection) feed these keys back into regular {} objects.
 */
function isSafeOperationKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-z0-9][a-z0-9-]*:(give|receive|mutual)$/.test(key);
}

/**
 * Sentinel marking a key whose latest journal op was a deletion
 * (`data: null`). Used inside `replayJournalDeletable` so callers can
 * distinguish "key was last set to value V" from "key was last deleted"
 * — the difference matters for the delta-merge path, where a deletion
 * MUST overwrite the local cache, not be silently absent.
 */
const DELETED = Symbol("self-journal-deleted");
type DeletableState = Map<string, Answer | typeof DELETED>;

/**
 * Replay journal entries into a sentinel-bearing map: each key's last op
 * is either a value (set) or `DELETED` (delete). Used by
 * `mergeAfterRejection` so the delta merge can apply both kinds of
 * intent against the local cache.
 */
async function replayJournalDeletable(
  entries: { operation: string }[],
  groupKey?: string | null,
): Promise<DeletableState> {
  const state: DeletableState = new Map();
  for (const entry of entries) {
    try {
      const payload = await decodeValue<OperationPayload>(entry.operation, groupKey);
      if (!isSafeOperationKey(payload.key)) {
        console.error("Skipping journal entry with unsafe key:", payload.key);
        continue;
      }
      if (payload.data === null) {
        state.set(payload.key, DELETED);
      } else {
        const parsed = Answer.safeParse(payload.data);
        if (parsed.success) {
          state.set(payload.key, parsed.data);
        } else {
          console.error("Skipping malformed journal entry payload:", payload.key, parsed.error.issues);
        }
      }
    } catch (err) {
      console.error("Skipping malformed journal entry:", entry.operation.slice(0, 50), err);
    }
  }
  return state;
}

/**
 * Replay journal entries to build current answer state.
 * Last operation for each key wins. Null data = delete.
 *
 * Each non-null payload runs through `Answer.safeParse` — the schema
 * defaults missing `note` to null (legacy pre-PR-89 entries) and strips
 * the legacy `timing` key (pre-timing-removal entries). A malformed
 * entry is skipped rather than tanking the whole replay.
 *
 * Returns a plain object — deleted keys are absent. For the merge path
 * that needs to see deletions explicitly, use `replayJournalDeletable`.
 *
 * groupKey: omit to use session key, pass explicitly in tests.
 */
export async function replayJournal(
  entries: { operation: string }[],
  groupKey?: string | null,
): Promise<Record<string, Answer>> {
  // Null-prototype map — `state["__proto__"] = x` would set a normal
  // property here instead of invoking the Object.prototype setter.
  const state: Record<string, Answer> = Object.create(null);
  const deletable = await replayJournalDeletable(entries, groupKey);
  for (const [key, value] of deletable) {
    if (value !== DELETED) state[key] = value;
  }
  return state;
}

async function extractKey(op: string, groupKey?: string | null): Promise<string | null> {
  try {
    const payload = await decodeValue<OperationPayload>(op, groupKey);
    return isSafeOperationKey(payload.key) ? payload.key : null;
  } catch {
    return null;
  }
}

/**
 * Merge local state with server entries.
 *
 * Same merge runs in three places — kept consistent because the
 * semantics are the same in each: outbox wins for keys with a pending
 * op, otherwise the server's most recent intent (set OR delete) wins:
 *   - `sync.push` rejection retry (`sync-flush.ts`): server has entries
 *     the client hadn't seen.
 *   - Bootstrap on every play-page mount (`useSelfJournal` queryFn):
 *     hydrate from the per-person journal delta.
 *   - SSE echo (`onSelfJournalChange.onData`): keep the cache live.
 *
 * Rules:
 * - For keys in server entries AND in pending ops: keep local answer
 *   (user's latest intention isn't ack'd yet).
 * - For keys only in server entries: apply the server's last op — a
 *   value sets the key, a `null` deletes it.
 * - For keys only in local state (not touched by server entries): keep
 *   the local value.
 *
 * groupKey: omit to use session key, pass explicitly in tests.
 */
export async function mergeAfterRejection(
  localAnswers: Record<string, Answer>,
  pendingOps: string[],
  serverEntries: string[],
  groupKey?: string | null,
): Promise<Record<string, Answer>> {
  const serverState = await replayJournalDeletable(
    serverEntries.map((op) => ({ operation: op })),
    groupKey,
  );

  const extractedKeys = await Promise.all(pendingOps.map((op) => extractKey(op, groupKey)));
  const pendingKeys = new Set<string>(extractedKeys.filter((k): k is string => k !== null));

  const merged = { ...localAnswers };

  for (const [key, value] of serverState) {
    if (pendingKeys.has(key)) continue;
    if (value === DELETED) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return merged;
}
