import { decodeOpaque, GroupJournalResponse, type JournalEntry, SelfJournalResponse } from "@spreadsheet/shared";
import { TRPCError, tracked } from "@trpc/server";
import { z } from "zod";
import {
  emitJournalUpdate,
  emitSelfJournalUpdate,
  type JournalEntryPayload,
  journalEventName,
  journalEvents,
  journalUpdates,
  selfJournalEventName,
  selfJournalEvents,
} from "../../events.js";
import { markCompleteCounter, syncPushCounter, trackSseConnection } from "../../metrics.js";
import { decodeJournalId, encodeJournalCursor, toWireEntries } from "../../opaque-id.js";
import { authedProcedure, broadcastingProcedure, router } from "../init.js";

/**
 * Payload shape for the sync.onJournalChange subscription. Each yielded
 * tracked event carries one or more newly-committed journal entries.
 */
export interface JournalChangeMessage {
  entries: JournalEntry[];
}

/**
 * Cursor inputs (`sinceId`, `lastEventId`) are opaque ids minted by
 * `encodeJournalId`. Accept any short string and let `decodeJournalId`
 * map anything unrecognised (legacy numeric cursors from pre-opaque
 * clients, a rotated secret, garbage) to "no cursor" → full backfill.
 * Rejecting instead would wedge an auto-reconnecting EventSource that
 * keeps re-sending the same `Last-Event-ID`.
 */
const cursorInput = z.union([z.string().max(64), z.number()]).nullish();

/**
 * Shared tail of both journal subscriptions: yield the backfill, then the
 * live stream, each as a sealed `tracked()` event.
 *
 * `cursor` (numeric, server-side only) dedups live deliveries that overlap
 * the backfill — the iterable was buffering while the backfill query ran.
 * The SSE event id is the last entry's sealed id, derived from the same
 * entry that advances `cursor`, so the resume cursor and the dedup cursor
 * can't drift and no raw bigserial reaches the wire.
 *
 * The caller must create `updates` BEFORE running the backfill query
 * (subscribe-before-query invariant).
 */
async function* streamJournal(
  updates: AsyncIterable<JournalEntryPayload[]>,
  sinceId: number | null,
  backfill: readonly JournalEntryPayload[],
) {
  let cursor = sinceId;
  function* emit(entries: readonly JournalEntryPayload[]) {
    const fresh = entries.filter((e) => cursor === null || e.id > cursor);
    if (fresh.length === 0) return;
    const wire = toWireEntries(fresh);
    yield tracked(wire[wire.length - 1].id, { entries: wire } satisfies JournalChangeMessage);
    cursor = fresh[fresh.length - 1].id;
  }

  yield* emit(backfill);
  for await (const entries of updates) {
    yield* emit(entries);
  }
}

export const syncRouter = router({
  // Stays as authedProcedure on the status side (no groupEvents broadcast):
  // push happens every 3s per active user during normal answering, and the
  // progress field is cosmetic. Edit-after-completion propagation uses the
  // dedicated journalEvents bus below, not groupEvents.
  push: authedProcedure
    .input(
      z.object({
        stoken: z.string().nullable(),
        operations: z.array(z.string()),
        progress: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const op of input.operations) {
        try {
          decodeOpaque(op);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid operation format" });
        }
      }

      const result = await ctx.sync.push(ctx.person.id, input, ctx.group.encrypted);

      if ("error" in result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Operation encryption does not match group setting",
        });
      }

      // Emit journal update after a successful, non-rejected commit. Rejected
      // pushes changed nothing server-side, so there's nothing to propagate;
      // the client will merge and retry, and the retry's success will emit.
      //
      // Two buses, two audiences:
      //   - journalEvents (group-keyed) — gated cross-member feed for
      //     Comparison on /results. Emit unconditionally; if nobody's
      //     subscribed for this group, EventEmitter.emit is a no-op.
      //   - selfJournalEvents (person-keyed) — per-person feed for the
      //     caller's own useSelfJournal cache, plus any other devices the
      //     same person has open. Same idempotency story.
      if (!result.pushRejected && result.committedEntries.length > 0) {
        emitJournalUpdate(ctx.group.id, result.committedEntries);
        emitSelfJournalUpdate(ctx.person.id, result.committedEntries);
      }

      if (result.stokenInvalid) {
        // Expected after a STOKEN_SECRET rotation; otherwise a sign of
        // corrupted client storage or tampering. Never log the stoken itself.
        ctx.logger.warn({ personId: ctx.person.id }, "sync.push: unreadable stoken, forcing resync");
      }
      syncPushCounter.inc({
        result: result.stokenInvalid ? "invalid_stoken" : result.pushRejected ? "conflict" : "clean",
      });
      // committedEntries and stokenInvalid are internal — don't expose them on the wire.
      const { committedEntries: _committedEntries, stokenInvalid: _stokenInvalid, ...wireResult } = result;
      return wireResult;
    }),

  markComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.markComplete(ctx.person.id);
    markCompleteCounter.inc();
    return { ok: true };
  }),

  unmarkComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.unmarkComplete(ctx.person.id);
    return { ok: true };
  }),

  journal: authedProcedure
    .input(z.object({ sinceId: cursorInput }).optional())
    .output(GroupJournalResponse)
    .query(async ({ ctx, input }) => {
      const result = await ctx.sync.journalSince(ctx.group.id, decodeJournalId(input?.sinceId));
      if ("error" in result) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }
      return {
        members: result.members,
        entries: toWireEntries(result.entries),
        cursor: encodeJournalCursor(result.cursor),
      };
    }),

  /**
   * Per-person journal read for the caller's own answer hydration.
   *
   * No precondition — a person can always read their own entries.
   * Backs `useSelfJournal` on the client: on every play-page mount the
   * client calls this with the persisted cursor, replays the delta, and
   * merges with its local outbox. Cross-device hydration without a
   * dedicated boot endpoint.
   *
   * Returns the entries plus the latest stoken so the client can prime
   * its push cursor without a separate handshake.
   */
  selfJournal: authedProcedure
    .input(z.object({ sinceId: cursorInput }).optional())
    .output(SelfJournalResponse)
    .query(async ({ ctx, input }) => {
      const result = await ctx.sync.journalSinceForPerson(ctx.person.id, decodeJournalId(input?.sinceId));
      return {
        entries: toWireEntries(result.entries),
        cursor: encodeJournalCursor(result.cursor),
        stoken: result.stoken,
      };
    }),

  /**
   * Real-time journal delivery via tRPC v11 `tracked()` subscriptions.
   *
   * Canonical pattern from the tRPC docs:
   * 1. Attach the event listener BEFORE the backfill query — anything emitted
   *    during the query is buffered in the iterable, not lost.
   * 2. Backfill using the `lastEventId` cursor (the browser's EventSource
   *    re-sends this automatically as the `Last-Event-ID` header on
   *    SSE reconnect; tRPC surfaces it on the procedure input).
   * 3. Yield backfill entries as `tracked(id, data)` so the SSE event id
   *    advances and the next `Last-Event-ID` header carries the new cursor.
   * 4. Stream live emissions with the same `tracked()` envelope, deduping
   *    any overlap between the backfill query and the in-memory buffer.
   *
   * This gives lossless reconnect recovery by construction: any event that
   * happens while a subscriber is disconnected is replayed on reconnect from
   * whatever cursor they last saw.
   */
  onJournalChange: authedProcedure
    .input(
      z
        .object({
          // lastEventId is the opaque id of the last delivered entry (the
          // SSE event id we yielded via `tracked()`).
          lastEventId: cursorInput,
        })
        .optional(),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      // Ordering of startup steps matters. The "listener-before-query"
      // invariant is load-bearing for the backfill/live-stream handoff, but
      // there's a preliminary precondition check that must run before either:
      //
      //   1. Precondition gate (getStatus + allComplete check) — throws if
      //      the group isn't ready. We run this BEFORE `trackSseConnection`
      //      so a failing precondition doesn't briefly inflate the gauge
      //      for a request that's already on its way to a TRPCError.
      //      Events emitted between this check and the listener attach are
      //      NOT delivered as live events, but they WILL be picked up by
      //      the backfill query below because that query reads entries >
      //      lastEventId (or all entries on a fresh connect). So this
      //      window is structurally safe.
      //
      //   2. Listener attach — MUST be before the backfill query, because
      //      events emitted during the backfill query's round-trip would
      //      otherwise be lost (not in the backfill, not in the live stream).
      //      The iterable buffers them until the for-await loop consumes them.
      //
      //   3. Backfill query — reads entries > lastEventId from Postgres.
      //
      //   4. Live stream — consumes the buffered iterable, deduping entries
      //      that overlap with the backfill via the cursor.
      const status = await ctx.groups.getStatus(ctx.personToken);
      if (!status?.members.every((m) => m.isCompleted)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }

      trackSseConnection("sync.onJournalChange", signal);

      // CRITICAL: listener BEFORE backfill query. Any emission in the
      // backfill window is buffered in the iterable and delivered after
      // we exit the for-await loop's startup.
      const updates = journalUpdates(journalEvents, journalEventName(ctx.group.id), signal);

      // Backfill from the client's cursor (or the beginning on a fresh connect).
      const sinceId = decodeJournalId(input?.lastEventId);
      const backfill = await ctx.sync.journalSince(ctx.group.id, sinceId);
      if ("error" in backfill) {
        // Shouldn't happen (precondition already checked above), but be defensive.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }

      yield* streamJournal(updates, sinceId, backfill.entries);
    }),

  /**
   * Per-person tracked subscription for the caller's own journal entries.
   *
   * Same generator shape as `onJournalChange` (subscribe-before-query,
   * dedup, `tracked()` resume) but consumes the per-person bus and skips
   * the all-complete precondition. Used by `useSelfJournal` to keep the
   * caller's answers cache live across devices.
   *
   * Same-device echo is intentional: when the writer pushes, they also
   * receive the entry on this subscription. The client merge step is
   * idempotent on entry id, so the echo is a no-op visually.
   */
  onSelfJournalChange: authedProcedure
    .input(
      z
        .object({
          lastEventId: cursorInput,
        })
        .optional(),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      trackSseConnection("sync.onSelfJournalChange", signal);
      // CRITICAL: listener BEFORE backfill query. Same invariant as
      // onJournalChange — events emitted during the backfill round-trip
      // are buffered in the iterable, not lost.
      const updates = journalUpdates(selfJournalEvents, selfJournalEventName(ctx.person.id), signal);

      const sinceId = decodeJournalId(input?.lastEventId);
      const backfill = await ctx.sync.journalSinceForPerson(ctx.person.id, sinceId);

      yield* streamJournal(updates, sinceId, backfill.entries);
    }),
});
