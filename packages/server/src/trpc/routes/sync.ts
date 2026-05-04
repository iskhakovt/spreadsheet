import { on } from "node:events";
import { decodeOpaque } from "@spreadsheet/shared";
import { TRPCError, tracked } from "@trpc/server";
import { z } from "zod";
import { emitJournalUpdate, emitSelfJournalUpdate, journalEventName, journalEvents } from "../../events.js";
import { markCompleteCounter, syncPushCounter } from "../../metrics.js";
import { authedProcedure, broadcastingProcedure, router } from "../init.js";

/**
 * Payload shape for the sync.onJournalChange subscription. Each yielded
 * tracked event carries one or more newly-committed journal entries.
 */
export interface JournalChangeMessage {
  entries: { id: number; personId: string; operation: string }[];
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

      syncPushCounter.inc({ result: result.pushRejected ? "conflict" : "clean" });
      // The committedEntries field is internal — don't expose it on the wire.
      const { committedEntries: _committedEntries, ...wireResult } = result;
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
    .input(z.object({ sinceId: z.number().int().nonnegative().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.sync.journalSince(ctx.group.id, input?.sinceId ?? null);
      if ("error" in result) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }
      return result;
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
    .input(z.object({ sinceId: z.number().int().nonnegative().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.sync.journalSinceForPerson(ctx.person.id, input?.sinceId ?? null);
    }),

  /**
   * Real-time journal delivery via tRPC v11 `tracked()` subscriptions.
   *
   * Canonical pattern from the tRPC docs:
   * 1. Attach the event listener BEFORE the backfill query — anything emitted
   *    during the query is buffered in the iterable, not lost.
   * 2. Backfill using the `lastEventId` cursor (the browser re-sends this
   *    automatically on WS reconnect via wsLink).
   * 3. Yield backfill entries as `tracked(id, data)` so the client's wsLink
   *    advances its `lastEventId` cursor.
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
          // lastEventId is stringified journal entry id (bigserial > 0);
          // reject non-numeric strings early so a malformed resume cursor
          // can't reach the `Number(...)` cast below and produce NaN.
          lastEventId: z.string().regex(/^\d+$/, "lastEventId must be a numeric string").nullish(),
        })
        .optional(),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      // Ordering of startup steps matters. The "listener-before-query"
      // invariant is load-bearing for the backfill/live-stream handoff, but
      // there's a preliminary precondition check that must run before either:
      //
      //   1. Precondition gate (getStatus + allComplete check) — throws if
      //      the group isn't ready. Events emitted between this check and
      //      the listener attach are NOT delivered as live events, but they
      //      WILL be picked up by the backfill query below because that query
      //      reads entries > lastEventId (or all entries on a fresh connect).
      //      So this window is structurally safe.
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

      // CRITICAL: listener BEFORE backfill query. Any emission in the
      // backfill window is buffered in the iterable and delivered after
      // we exit the for-await loop's startup.
      const iterable = on(journalEvents, journalEventName(ctx.group.id), { signal });

      // Backfill from the client's cursor (or the beginning on a fresh connect).
      const sinceId = input?.lastEventId ? Number(input.lastEventId) : null;
      const backfill = await ctx.sync.journalSince(ctx.group.id, sinceId);
      if ("error" in backfill) {
        // Shouldn't happen (precondition already checked above), but be defensive.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }

      let cursor = sinceId;
      if (backfill.entries.length > 0) {
        const latestId = backfill.entries[backfill.entries.length - 1].id;
        yield tracked(String(latestId), { entries: backfill.entries } satisfies JournalChangeMessage);
        cursor = latestId;
      }

      // Live stream from the buffered iterable. Dedup entries that overlap
      // with the backfill — the iterable may have been filling up while the
      // query ran, producing rows the backfill already returned.
      for await (const [payload] of iterable) {
        const entries = payload as typeof backfill.entries;
        const fresh = entries.filter((e) => cursor === null || e.id > cursor);
        if (fresh.length === 0) continue;
        const latestId = fresh[fresh.length - 1].id;
        yield tracked(String(latestId), { entries: fresh } satisfies JournalChangeMessage);
        cursor = latestId;
      }
    }),
});
