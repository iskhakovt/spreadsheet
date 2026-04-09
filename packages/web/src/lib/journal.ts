import type { Answer, OperationPayload } from "@spreadsheet/shared";
import { decodeValue } from "./crypto.js";

/**
 * Replay journal entries to build current answer state.
 * Last operation for each key wins. Null data = delete.
 *
 * groupKey: omit to use session key, pass explicitly in tests.
 */
export async function replayJournal(
  entries: { operation: string }[],
  groupKey?: string | null,
): Promise<Record<string, Answer>> {
  const state: Record<string, Answer> = {};
  for (const entry of entries) {
    try {
      const payload = await decodeValue<OperationPayload>(entry.operation, groupKey);
      if (payload.data === null) {
        delete state[payload.key];
      } else {
        state[payload.key] = payload.data;
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
    return payload.key;
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
