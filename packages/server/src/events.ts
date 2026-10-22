import { EventEmitter, on } from "node:events";

/**
 * Shared event bus for server-side group state changes (status-level).
 *
 * Mutating tRPC procedures emit on this bus via {@link emitGroupUpdate}, and
 * the `groups.onStatus` subscription listens for events keyed by group id and
 * yields fresh per-subscriber status to connected SSE clients.
 */
export const groupEvents = new EventEmitter();
groupEvents.setMaxListeners(0);

export function groupEventName(groupId: string): string {
  return `group:${groupId}`;
}

export function emitGroupUpdate(groupId: string): void {
  groupEvents.emit(groupEventName(groupId));
}

/**
 * Shared event bus for journal appends — separate from `groupEvents` because
 * the concerns differ: status broadcasts fire on mutations that don't touch
 * the journal (setProfile, markReady, etc.), while journal events fire on the
 * high-frequency `sync.push` path. Mixing them would mean every subscriber
 * filters out roughly half the events it receives.
 *
 * `sync.push` emits here after a successful non-rejected commit. The
 * `sync.onJournalChange` subscription listens and yields tracked events so
 * clients can resume losslessly on reconnect via the `lastEventId` cursor.
 */
export const journalEvents = new EventEmitter<JournalEventMap>();
journalEvents.setMaxListeners(0);

export interface JournalEntryPayload {
  id: number;
  personId: string;
  operation: string;
}

/** Every journal event name carries one argument: the committed entries. */
type JournalEventMap = Record<string, [entries: JournalEntryPayload[]]>;

/**
 * Typed wrapper over `events.on()` for the two journal buses.
 *
 * Node's `on()` yields `any[]` tuples whatever the emitter's event map, so
 * the payload type is restored here — once, next to the emit side that
 * guarantees it — instead of at every subscriber.
 *
 * The listener is attached synchronously, before this function returns.
 * Subscribers rely on that for the subscribe-before-query invariant, so
 * don't turn this into an async generator (its body would only run, and
 * attach, on the first `next()`).
 */
export function journalUpdates(
  emitter: EventEmitter<JournalEventMap>,
  eventName: string,
  signal: AbortSignal | undefined,
): AsyncIterable<JournalEntryPayload[]> {
  const events = on(emitter, eventName, { signal });
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<JournalEntryPayload[]> {
      // `entries` is `any` from node's typings; the declared yield type
      // above is where it becomes `JournalEntryPayload[]` again.
      for await (const [entries] of events) yield entries;
    },
  };
}

export function journalEventName(groupId: string): string {
  return `journal:${groupId}`;
}

export function emitJournalUpdate(groupId: string, entries: JournalEntryPayload[]): void {
  if (entries.length === 0) return;
  journalEvents.emit(journalEventName(groupId), entries);
}

/**
 * Per-person journal bus — independent of the group-keyed `journalEvents`
 * because the audience is different. The group bus is gated cross-member
 * delivery (consumed by `Comparison` post-allComplete); this bus is the
 * always-on per-person feed (consumed by `useSelfJournal` to keep the
 * caller's own answers cache live across devices).
 *
 * `sync.push` emits here on the same successful commit that fans out to
 * `journalEvents`. Subscribers are typically one or two — the editing tab
 * itself plus any other device the same person has open. The same-device
 * echo is harmless: the client merge step is idempotent on entry id.
 */
export const selfJournalEvents = new EventEmitter<JournalEventMap>();
selfJournalEvents.setMaxListeners(0);

export function selfJournalEventName(personId: string): string {
  return `self-journal:${personId}`;
}

export function emitSelfJournalUpdate(personId: string, entries: JournalEntryPayload[]): void {
  if (entries.length === 0) return;
  selfJournalEvents.emit(selfJournalEventName(personId), entries);
}
