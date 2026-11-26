# Todo

## Next

- [ ] `p3` E2E for the SIGTERM → reconnect path: kill the server mid-stream, restart, assert the next `tracked()` cursor is honored and the client receives the catch-up backfill. Currently asserted only by reasoning.
- [ ] `p2` Investigate local `pnpm test:e2e` flakiness — different runs produce different sets of failures (3, 10, 12 across runs on the same code), with characteristic "Target page, context or browser has been closed" timeouts. Affects both `main` and feature branches; CI Docker image runs are clean. Likely resource contention on the local Chromium pool or fixture lifecycle. Fix so local pre-push e2e is a usable signal.
- [ ] `p2` Outbox races can lose or resend answers: a push clears its batch by count while keyed dedup moves ops around (`drainPendingOps`, `addPendingOpForKey`), autosync and Done flush independently, and tabs share one read-modify-write queue. Design in [design/outbox.md](design/outbox.md): one outbox entry per answer with compare-and-delete acknowledgement, plus server-side op ids so a resend is harmless. Two open questions for the owner there.
- [ ] `p3` `SyncStore.journalSince` can skip a newly added member's entry for good. It reads the member list and then the entries in two statements, each with its own READ COMMITTED snapshot. Say an admin adds member X between them, X pushes entry N, and an existing member then commits N+1. The scan filters on the old member list, so it returns N+1 without N, and the cursor passes N. Once X completes, every read resumes past N. Needs a member added while the group is on `/results`. Fix: run `journalSince` in one REPEATABLE READ transaction, so the all-complete gate and the scan see the same members. Since #248, a group's ids commit in order: if N+1 is in the snapshot, N and X's row are too, so the gate fails instead of skipping. Found in review of #248.

## Later

- [ ] `p2` Upgrade `postgres` (postgres.js) 3.4.9 → 4.x. v4 (Oct 2026) rewrites everything below the public API, and drizzle-orm 0.45's postgres-js adapter mutates internals v4 restructured (`client.options.parsers`/`serializers` for date/time and JSON OIDs). Behavior changes that matter here: the server now decides parameter types (`infer: false`), so a `Date` written to or compared with a `timestamp`/`date` column is taken as UTC and needs a cast where the query doesn't fix its type; `sql.array()` is removed; an unsafe `BEGIN` outside `sql.begin` rejects. Blocked on drizzle declaring v4 support (drizzle-team/drizzle-orm#6686 is open). When it lands, check that drizzle's timestamp columns still round-trip as before (string vs `Date`) across store tests, integration, and e2e against the image. Held back in #238.
- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
