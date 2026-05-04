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
 * Replay journal entries to build current answer state.
 * Last operation for each key wins. Null data = delete.
 *
 * Each non-null payload runs through `Answer.safeParse` — the schema
 * defaults missing `note` to null (legacy pre-PR-89 entries) and strips
 * the legacy `timing` key (pre-timing-removal entries). A malformed
 * entry is skipped rather than tanking the whole replay.
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
  for (const entry of entries) {
    try {
      const payload = await decodeValue<OperationPayload>(entry.operation, groupKey);
      if (!isSafeOperationKey(payload.key)) {
        console.error("Skipping journal entry with unsafe key:", payload.key);
        continue;
      }
      if (payload.data === null) {
        delete state[payload.key];
      } else {
        const parsed = Answer.safeParse(payload.data);
        if (parsed.success) {
          state[payload.key] = parsed.data;
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

async function extractKey(op: string, groupKey?: string | null): Promise<string | null> {
  try {
    const payload = await decodeValue<OperationPayload>(op, groupKey);
    return isSafeOperationKey(payload.key) ? payload.key : null;
  } catch {
    return null;
  }
}

/**
 * Merge local state with server entries after a rejected push.
 *
 * Rules:
 * - For keys in server entries AND in pending ops: keep local answer (user's latest intention)
 * - For keys only in server entries: accept server's value
 * - For keys only in local state (not in server entries): keep local value
 *
 * groupKey: omit to use session key, pass explicitly in tests.
 */
export async function mergeAfterRejection(
  localAnswers: Record<string, Answer>,
  pendingOps: string[],
  serverEntries: string[],
  groupKey?: string | null,
): Promise<Record<string, Answer>> {
  const serverState = await replayJournal(
    serverEntries.map((op) => ({ operation: op })),
    groupKey,
  );

  const extractedKeys = await Promise.all(pendingOps.map((op) => extractKey(op, groupKey)));
  const pendingKeys = new Set<string>(extractedKeys.filter((k): k is string => k !== null));

  const merged = { ...localAnswers };

  for (const [key, answer] of Object.entries(serverState)) {
    if (!pendingKeys.has(key)) {
      merged[key] = answer;
    }
  }

  return merged;
}
