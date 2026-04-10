import { EventEmitter } from "node:events";

/**
 * Shared event bus for server-side group state changes.
 *
 * Mutating tRPC procedures emit on this bus via {@link emitGroupUpdate}, and
 * the `groups.onStatus` subscription listens for events keyed by group id and
 * yields fresh per-subscriber status to connected WebSocket clients.
 */
export const groupEvents = new EventEmitter();

// We expect many concurrent subscribers per group during normal use; bypass
// the default 10-listener warning.
groupEvents.setMaxListeners(0);

export function groupEventName(groupId: string): string {
  return `group:${groupId}`;
}

export function emitGroupUpdate(groupId: string): void {
  groupEvents.emit(groupEventName(groupId));
}
