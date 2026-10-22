# Todo

## Next

- [ ] `p3` E2E for the SIGTERM → reconnect path: kill the server mid-stream, restart, assert the next `tracked()` cursor is honored and the client receives the catch-up backfill. Currently asserted only by reasoning.
- [ ] `p2` Investigate local `pnpm test:e2e` flakiness — different runs produce different sets of failures (3, 10, 12 across runs on the same code), with characteristic "Target page, context or browser has been closed" timeouts. Affects both `main` and feature branches; CI Docker image runs are clean. Likely resource contention on the local Chromium pool or fixture lifecycle. Fix so local pre-push e2e is a usable signal.
- [ ] `p2` Journal live-stream drops entries that commit out of bigserial order. Both journal subscriptions dedup with `e.id > cursor` (`trpc/routes/sync.ts`), and backfill resumes with `id > lastEventId`, assuming id order = commit order. Postgres assigns the id at INSERT, not COMMIT: if tx A inserts id 100, tx B inserts 101 and commits first, the subscriber's cursor jumps to 101 and A's later `emit([100])` is filtered out — and every reconnect / persisted `selfJournalCursor` resumes past it too. Missing until a full reload. Triggers: two members pushing at once (group stream on `/results`), or one person pushing from two devices (self stream). Options: (a) serialize journal inserts per group with `pg_advisory_xact_lock(hashtext(group_id))` in `SyncStore.push` so id order = commit order within a group (cheap, push is low-rate; covers both streams since a person's group is fixed); (b) order by a commit-time sequence instead of the insert-time id (e.g. a `committed_seq` assigned under a lock at commit) — more invasive, changes the cursor; (c) client-side periodic full re-fetch — contradicts the no-polling rule. (a) looks right; needs an integration test that interleaves two push txs.

## Later

- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
