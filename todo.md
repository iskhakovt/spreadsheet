# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.

## Later

- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p3` `@testing-library/react` coverage audit — installed in PR #59 for `storage.test.ts`. Candidates, in priority order:
    - **High value:**
        - `lib/use-sync-queue.ts` — 3s debounce + 5s indicator + conflict-merge retry. Timer logic is exactly what `@testing-library/react` + `vi.useFakeTimers` was designed for; currently only `sync-flush.test.ts` covers the pure merge logic.
        - `lib/use-mark-complete.ts` — flush-then-mutate ordering + idempotency. Race conditions here are the kind of thing unit tests catch far earlier than e2e.
        - `lib/use-copy.ts` — `copiedIndex` auto-reset timer. Small, but pure timer UI.
    - **Medium value:**
        - `components/ToggleGroup.tsx` — keyboard nav + `aria-checked` are accessibility contracts worth pinning.
        - `components/AnatomyPicker.tsx` — keyboard + selection state, surfaces in the onboarding flow.
        - `components/copy-link-field.tsx` / `copy-my-link.tsx` — clipboard fallback branches.
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
