import { on } from "node:events";
import { decodeOpaque } from "@spreadsheet/shared";
import { TRPCError, type TrackedEnvelope, tracked } from "@trpc/server";
import { z } from "zod";
import { emitJournalUpdate, journalEventName, journalEvents } from "../../events.js";
import { authedProcedure, broadcastingProcedure, router } from "../init.js";

/**
 * Payload shape for the sync.onJournalChange subscription. Each yielded
 * tracked event carries one or more newly-committed journal entries.
 */
export interface JournalChangeMessage {
  entries: { id: number; personId: string; operation: string }[];
}

/**
 * Explicit envelope type for yielded events. Using `TrackedEnvelope` from the
 * public `@trpc/server` entrypoint forces TypeScript's declaration emit to
 * resolve the type through the public path rather than through the internal
 * `unstable-core-do-not-import` module. Wrapping `tracked(...)` calls as
 * `tracked(...) as JournalChangeEnvelope` ensures the async generator's yield
 * type uses the public alias.
 */
export type JournalChangeEnvelope = TrackedEnvelope<JournalChangeMessage>;

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
        progress: z.string().nullable(),
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

      const result = await ctx.sync.push(ctx.person.id, input);

      // Emit journal update after a successful, non-rejected commit. Rejected
      // pushes changed nothing server-side, so there's nothing to propagate;
      // the client will merge and retry, and the retry's success will emit.
      //
      // Unconditional emit (no isCompleted check) — if nobody is subscribed to
      // sync.onJournalChange for this group (the common case during normal
      // answering), EventEmitter.emit is a no-op. Subscriber gating happens
      // client-side via Comparison mount on /results.
      if (!result.pushRejected && result.committedEntries.length > 0) {
        emitJournalUpdate(ctx.group.id, result.committedEntries);
      }

      // The committedEntries field is internal — don't expose it on the wire.
      const { committedEntries: _committedEntries, ...wireResult } = result;
      return wireResult;
    }),

  markComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.markComplete(ctx.person.id);
    return { ok: true };
  }),

  unmarkComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.unmarkComplete(ctx.person.id);
    return { ok: true };
  }),

  journal: authedProcedure
    .input(z.object({ sinceId: z.number().int().nonnegative().nullable() }).optional())
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
    .input(z.object({ lastEventId: z.string().nullish() }).optional())
    .subscription(async function* ({ ctx, input, signal }): AsyncGenerator<JournalChangeEnvelope, void, unknown> {
      // Precondition: the whole group must be complete before anyone can
      // stream the journal. Matches the `sync.journal` query gate.
      const status = await ctx.groups.getStatus(ctx.personToken);
      if (!status?.members.every((m) => m.isCompleted)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }

      // CRITICAL: listener BEFORE query, so events emitted during the query
      // are buffered in the iterable rather than lost.
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
        const envelope: JournalChangeEnvelope = tracked(String(latestId), {
          entries: backfill.entries,
        });
        yield envelope;
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
        const envelope: JournalChangeEnvelope = tracked(String(latestId), {
          entries: fresh,
        });
        yield envelope;
        cursor = latestId;
      }
    }),
});
