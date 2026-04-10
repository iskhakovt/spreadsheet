import { EventEmitter } from "node:events";

/**
 * Shared event bus for server-side group state changes (status-level).
 *
 * Mutating tRPC procedures emit on this bus via {@link emitGroupUpdate}, and
 * the `groups.onStatus` subscription listens for events keyed by group id and
 * yields fresh per-subscriber status to connected WebSocket clients.
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
export const journalEvents = new EventEmitter();
journalEvents.setMaxListeners(0);

export interface JournalEntryPayload {
  id: number;
  personId: string;
  operation: string;
}

export function journalEventName(groupId: string): string {
  return `journal:${groupId}`;
}

export function emitJournalUpdate(groupId: string, entries: JournalEntryPayload[]): void {
  if (entries.length === 0) return;
  journalEvents.emit(journalEventName(groupId), entries);
}
