import { Answer, MAX_TIER } from "@spreadsheet/shared";
import { useSyncExternalStore } from "react";
import { getScope } from "./session.js";

function getJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(getScope() + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setJson(key: string, value: unknown): void {
  localStorage.setItem(getScope() + key, JSON.stringify(value));
}

function getRaw(key: string): string | null {
  return localStorage.getItem(getScope() + key);
}

function setRaw(key: string, value: string): void {
  localStorage.setItem(getScope() + key, value);
}

function removeRaw(key: string): void {
  localStorage.removeItem(getScope() + key);
}

// React-side reads of localStorage-backed state go through useSyncExternalStore
// so they get stable object identity. Non-React callers keep using the
// imperative getters — they don't need stable identity.

// Snapshot cache keyed by full localStorage key (scope + suffix), so session
// changes in-tab don't cross-contaminate.
const snapshotCache = new Map<string, { raw: string | null; parsed: unknown }>();

function readCachedSnapshot<T>(suffix: string, parse: (raw: string | null) => T): T {
  const fullKey = getScope() + suffix;
  const raw = localStorage.getItem(fullKey);
  const cached = snapshotCache.get(fullKey);
  if (cached && cached.raw === raw) return cached.parsed as T;
  // Self-heal on corrupt storage (manual edits, partial writes): fall back
  // to parse(null). Cache the raw alongside the fallback so subsequent
  // reads short-circuit to the cached value instead of re-throwing.
  let parsed: T;
  try {
    parsed = parse(raw);
  } catch {
    parsed = parse(null);
  }
  snapshotCache.set(fullKey, { raw, parsed });
  return parsed;
}

function notifyChanged(suffix: string): void {
  snapshotCache.delete(getScope() + suffix);
  // `window` guard for the node-env unit tests that exercise setters.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(`storage:${suffix}`));
  }
}

/**
 * Build a React hook that subscribes to a scoped localStorage key via
 * useSyncExternalStore. Returns a hook that yields a stable reference
 * across renders until the underlying value changes (native `storage`
 * event from other tabs, or `storage:{suffix}` dispatched by our
 * setters in this file).
 */
function makeLocalStorageHook<T>(suffix: string, parse: (raw: string | null) => T): () => T {
  // subscribe + getSnapshot are closed over here so useSyncExternalStore
  // sees stable references across calls.
  function subscribe(callback: () => void): () => void {
    function onStorage(e: StorageEvent) {
      if (e.key === getScope() + suffix) callback();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(`storage:${suffix}`, callback);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(`storage:${suffix}`, callback);
    };
  }
  function getSnapshot(): T {
    return readCachedSnapshot(suffix, parse);
  }
  return () => useSyncExternalStore(subscribe, getSnapshot);
}

// === answers ===
//
// The journal is the source of truth for answers; `useSelfJournal`
// (lib/self-journal.ts) materialises it into a TanStack cache slot on
// every play-page mount. The cache slot is the in-memory source for
// reads — components call `useAnswers` (exported from self-journal.ts)
// which reads the slot directly.
//
// localStorage is a write-through persister whose only job is first-paint
// hydration on the next reload. The `setAnswers` / `setAnswer` writers
// below update localStorage and dispatch a `storage:answers` event;
// `useSelfJournal` listens for that event (and the native cross-tab
// `storage` event) and mirrors the change into the cache slot. Same-tab
// optimistic writes therefore propagate to all readers via this mirror,
// and cross-tab writes propagate via the native event.
//
// `getAnswers()` is the canonical localStorage reader; `useSelfJournal`
// uses it as the local-truth input to the merge so optimistic edits
// survive the subscription echo of their own commits.

/**
 * Validate persisted answers via `Answer.safeParse`. The schema itself
 * handles legacy shapes (missing `note` defaults to null, stray `timing`
 * key stripped). A single corrupt entry is dropped silently rather than
 * tanking the whole map.
 */
function normalizeAnswers(raw: unknown): Record<string, Answer> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = Answer.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export function getAnswers(): Record<string, Answer> {
  return normalizeAnswers(getJson("answers", {}));
}

export function setAnswers(answers: Record<string, Answer>): void {
  setJson("answers", answers);
  notifyChanged("answers");
}

export function setAnswer(key: string, answer: Answer | null): void {
  const answers = getAnswers();
  if (answer === null) {
    delete answers[key];
  } else {
    answers[key] = answer;
  }
  setAnswers(answers);
}

// === pendingOps ===
//
// The queue is `string[]` of opaque ops on disk — never persist anything
// else under this key. To dedup debounced same-key writes (typing a
// 50-char note used to enqueue ~6 redundant ops) we maintain an
// in-memory key→position index alongside the queue. The index is NOT
// persisted: `p:1:` ops can be rebuilt from the cleartext payload on
// first access, and `e:1:` ops can't be decrypted synchronously —
// accepted, since auto-sync flushes within 3s and the server-side
// last-write-wins keeps state correct even when dedup misses across
// reloads.
//
// The privacy property of `e:1:` ops is preserved: the server still
// can't tell which question a ciphertext targets. The index is local-
// only, never serialized into the queue or sent to the server.

export const usePendingOps = makeLocalStorageHook("pendingOps", (raw): string[] => (raw ? JSON.parse(raw) : []));

export function getPendingOps(): string[] {
  return getJson("pendingOps", []);
}

export function setPendingOps(ops: string[]): void {
  setJson("pendingOps", ops);
  notifyChanged("pendingOps");
  // External replacement: any positions we tracked are now meaningless.
  dedupIndexes.delete(getScope() + "pendingOps");
}

export function addPendingOp(op: string): void {
  const ops = getPendingOps();
  ops.push(op);
  setJson("pendingOps", ops);
  notifyChanged("pendingOps");
  // Position-shifting append without a key invalidates the index: prior
  // positions are still valid for prior keys, but the new op has no key
  // we can record. Drop the index so the next keyed enqueue rebuilds.
  dedupIndexes.delete(getScope() + "pendingOps");
}

/**
 * Enqueue an op tagged with the answer key it targets. If a prior op
 * for the same key is still in the queue, splice it out so only the
 * latest write survives the next push. Server still applies
 * last-write-wins, this just trims redundant payload.
 *
 * The dedup is safe under cross-tab races: the index stores both the
 * position and the op string, and we only splice when the queue still
 * matches what we tracked. If another tab drained or rewrote the queue
 * mid-session, we degrade to "no dedup" rather than splice the wrong op.
 */
export function addPendingOpForKey(op: string, key: string): void {
  const fullKey = getScope() + "pendingOps";
  const ops = getPendingOps();
  const index = ensureDedupIndex(fullKey, ops);

  let next: string[];
  const prior = index.get(key);
  if (prior && prior.position < ops.length && ops[prior.position] === prior.op) {
    next = [...ops.slice(0, prior.position), ...ops.slice(prior.position + 1)];
    for (const entry of index.values()) {
      if (entry.position > prior.position) entry.position--;
    }
    index.delete(key);
  } else {
    next = [...ops];
  }

  next.push(op);
  index.set(key, { position: next.length - 1, op });
  setJson("pendingOps", next);
  notifyChanged("pendingOps");
}

/**
 * Remove the first `count` entries from the queue and shift index
 * positions in lockstep. Replaces the manual slice-and-setPendingOps in
 * the sync flush path so the dedup index survives a successful drain.
 */
export function drainPendingOps(count: number): void {
  const fullKey = getScope() + "pendingOps";
  const ops = getPendingOps();
  const drained = count >= ops.length ? [] : ops.slice(count);

  const index = dedupIndexes.get(fullKey);
  if (index) {
    for (const [k, entry] of [...index]) {
      if (entry.position < count) index.delete(k);
      else entry.position -= count;
    }
  }
  setJson("pendingOps", drained);
  notifyChanged("pendingOps");
}

export function clearPendingOps(): void {
  removeRaw("pendingOps");
  notifyChanged("pendingOps");
  dedupIndexes.delete(getScope() + "pendingOps");
}

interface DedupEntry {
  position: number;
  op: string;
}
const dedupIndexes = new Map<string, Map<string, DedupEntry>>();

function ensureDedupIndex(fullKey: string, ops: readonly string[]): Map<string, DedupEntry> {
  const existing = dedupIndexes.get(fullKey);
  if (existing) return existing;
  // Seed from any `p:1:` ops already in the queue — their key sits in
  // cleartext JSON, so we can extract it without async crypto. `e:1:` ops
  // are skipped (we'd need the group key to decrypt). On a first enqueue
  // after reload, `p:1:` dedup works; cross-reload `e:1:` dedup is best-
  // effort within the current session only.
  const index = new Map<string, DedupEntry>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op.startsWith("p:1:")) continue;
    try {
      const parsed = JSON.parse(op.slice(4));
      if (parsed && typeof parsed === "object" && typeof parsed.key === "string") {
        index.set(parsed.key, { position: i, op });
      }
    } catch {
      // Malformed cleartext — skip; the op will still send and the server
      // can decide what to do with it.
    }
  }
  dedupIndexes.set(fullKey, index);
  return index;
}

// === stoken ===

export function getStoken(): string | null {
  return getRaw("stoken");
}

export function setStoken(stoken: string | null): void {
  if (stoken) {
    setRaw("stoken", stoken);
  } else {
    removeRaw("stoken");
  }
}

// === self-journal cursor ===
//
// The numeric id of the latest journal entry the client has integrated for
// the authed person. Drives the delta-fetch / `lastEventId` resume on every
// play-page mount via `useSelfJournal`. Absent → bootstrap path (full replay
// on next mount), which is also the first-boot state for any new device.

export function getSelfJournalCursor(): number | null {
  const raw = getRaw("selfJournalCursor");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function setSelfJournalCursor(cursor: number | null): void {
  if (cursor === null) {
    removeRaw("selfJournalCursor");
  } else {
    setRaw("selfJournalCursor", String(cursor));
  }
}

// === selectedCategories / selectedTier ===
// Wrapped in component-level useState, so no useSyncExternalStore hook.

export function getSelectedCategories(): string[] | null {
  return getJson("selectedCategories", null);
}

export function setSelectedCategories(categories: string[]): void {
  setJson("selectedCategories", categories);
}

export function getSelectedTier(): number {
  const raw = getRaw("selectedTier");
  if (raw) {
    const n = Number(raw);
    if (n >= 1 && n <= MAX_TIER) return n;
  }
  return 2;
}

export function setSelectedTier(tier: number): void {
  setRaw("selectedTier", String(tier));
}

// === one-shot flags / cursors ===

export function getHasSeenIntro(): boolean {
  return getRaw("hasSeenIntro") === "true";
}

export function setHasSeenIntro(): void {
  setRaw("hasSeenIntro", "true");
}

export function getCurrentScreenKey(): string | null {
  return getRaw("currentScreen");
}

export function setCurrentScreenKey(key: string): void {
  setRaw("currentScreen", key);
}
