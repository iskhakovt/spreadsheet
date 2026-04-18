# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p0` Encrypt the `question` / `key` field of each operation — in encrypted mode the server still sees which question was answered (operations are keyed by plaintext `questionId:role`, e.g. `cunnilingus:give`). Server should learn nothing beyond "person X wrote entry N". Options: deterministic HMAC of the questionId under the group key (preserves the last-write-wins replay semantics that need stable keys), or include the key inside the encrypted payload and let the client dedupe at replay time (loses server-side ability to reason about keys — but the server doesn't today anyway).

## Later

- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p2` Stabilize localStorage-backed state via `useSyncExternalStore`. `getAnswers()`, `getPendingOps()`, `getSelectedCategories()`, `getSelectedTier()`, etc. return fresh object identity each call. This defeats at least two `useMemo` blocks in the codebase (`Summary.tsx` `grouped` and `Review.tsx` `grouped` both list `answers` as a dep — memo re-runs every render). Fix: wrap each localStorage key in a per-key external store with cached snapshot + storage-event + custom same-tab event. Adds subscribe-on-write plumbing to every setter, but yields stable identity, working `useMemo`, and cross-tab reactivity for free. Also enables the planned follow-up on `Question.tsx`'s welcome-screen `hasAnswersInCategory` / `firstUnansweredInCategoryIdx` per-render scans.
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
