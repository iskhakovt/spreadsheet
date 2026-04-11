# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod

## Later

- [ ] `p2` Add DB indices on hot query paths — composite `journal_entries (person_id, id)` covers every `sync.push` + `journalSince` filter+sort; `persons (group_id)` covers `getStatus`/`journalSince` member lookups; `questions (category_id, sort_order)` is nice-to-have. Repo currently has zero non-PK indices; fine at dev scale, every `sync.push` becomes a seq-scan of millions of rows at production scale. Drizzle `index()` helpers in `schema.ts` + `drizzle-kit generate` → additive migration, safe to apply live
- [ ] `p2` Add a proper 3-person E2E test with comprehensive question coverage. Current E2E coverage is 2-person-only and mostly narrowed to "Group & External" (6 mutual + 1 g/r). Gaps this should close: (a) **pair-heading behavior for 3+ person groups** — `[You & Bob] [You & Carol] [Bob & Carol]` tab order, viewer-pairs first then other-vs-other; (b) **the `(Bob)` parenthetical on other-vs-other pairs** — `buildPairMatches` keeps the parenthetical when `aIsViewer=false`, but no E2E asserts Alice sees "Giving a sensual massage (Bob)" when viewing the Bob & Carol pair; (c) **tab-widget keyboard nav** — ArrowLeft/Right/Home/End with roving tabindex, implemented in `Comparison.tsx` but only exercised in 3+ person groups; (d) **polycule vs couples UX** — verify the whole results page renders sensibly when there are 3 pairs, not just 1. Should narrow to a category with BOTH mutual AND give/receive questions (e.g. "Foundations" or "Touch & Body") so both display paths are exercised. Requires extending `createGroupAndSetup` to accept additional partners or adding a helper like `createTriad(browser)`
- [ ] `p3` Enable `eslint-react/prefer-read-only-props` — codebase-wide readonly-props convention for function components. Bulk-apply in one pass rather than landing per-component
- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p2` Adopt Pino as the server logger — DESIGN.md already lists "Hono built-in (v1), Pino available." Time to actually wire it up: JSON-structured logs for production, pretty-printing for dev, log levels per module, redact secrets (tokens, passwords). Affects packages/server startup + any manual `console.log` call sites. Makes downstream ingestion (e.g. GlitchTip deployment, a future log aggregator) meaningfully easier
- [ ] `p2` Mention TanStack Query in README/DESIGN.md — the migration landed in #9 but the docs still describe the old hand-rolled state pattern in places. Scope: README stack line, DESIGN.md "Real-time delivery" section cross-references, and any design/sync.md mentions of the client side of state management. Should cover: TanStack Query v5 + `@trpc/tanstack-react-query`, useSuspenseQuery / useMutation / useSubscription patterns, cache invalidation via `onSuccess: invalidateQueries`, `tracked()` subscription for WS resume
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
