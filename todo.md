# Todo

## Next

- [ ] `p3` Consider replacing `window.__ENV` inline injection with a startup-generated `env-config.js` static file to avoid the route-ordering dependency on `serveStatic`
- [ ] `p3` E2E test for `REQUIRE_ENCRYPTION=true` enforcement path — server injects flag → browser shows disabled checkbox → `groups.create` correctly sends `encrypted: true`
- [ ] `p3` `requiresGroupAnatomy` field for group-composition gating — a few questions (`pull-out`, `condoms-always`, fertility) currently render for groups that physically can't produce pregnancy. Per-person `targetGive`/`targetReceive` doesn't fully express "both anatomies must coexist". Small schema add + filter in `visibleSides`, ~5 questions migrated.
- [ ] `p3` Dedupe pending-ops on note-debounce keystrokes — a 50-char note currently produces ~6 pending ops (one per debounce window). Correct via last-write-wins on replay, just wasteful. Add a key-aware replacement path: for `p:1:` ops the key is already extractable from the cleartext JSON; for `e:1:` ops, maintain a local side-index of `key → queue position` so dedup doesn't require decryption. Queue stays `string[]` of opaque ops — preserves the CLAUDE.md storage-shape contract AND the server-side privacy property that encrypted ops never leak their key (`e:2:` with a key in the prefix would dedup easily but degrades that privacy story).
- [ ] `p3` Scroll restoration on `/questions` filter change — when search/tier filter shrinks the page, the user's pixel-Y position can land mid-category or past the end. Cheapest fix: scroll the sticky filter bar into view on filter-deps change. Anchor-based ("keep first-visible row in view") is the fancier option.
- [ ] `p3` Memoize Comparison match rows — every WS journal push triggers a full `PairComparison` re-render and all ~20-50 match rows recompute. Extract row JSX into a memoized component. Profile first: only worth it if RUM or React Profiler shows lag during active sessions.
- [ ] `p3` Outbound click proxy + Prometheus counter — `/api/out?dest=source|tip` redirect with allowlist + `outbound_clicks_total{dest, placement}` counter. Pros: click-rate visibility, tighter allowlist (kills the "misset env XSS" risk). Cons: adds outbound logging to a privacy-marketed app, extra hop on click. Skip unless you actually want the click data.

## Later

- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p3` Refactor imperative loops to native FP idioms — codebase favors `for-of` + Map/Set mutation; some lookup-object builds in `Comparison.tsx` and the `grouped`/`visibleQuestions` block in `QuestionsBrowser.tsx` would read better as native pipelines (`Object.fromEntries`, `Object.groupBy`). Skip places where mutation captures sequential intent (`replayJournal`, `mergeAfterRejection`). Native-only, no Ramda/Lodash dep yet — reassess after a first round.
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
