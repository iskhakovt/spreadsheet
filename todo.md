# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod

## Later

- [ ] `p2` Add DB indices on hot query paths — composite `journal_entries (person_id, id)` covers every `sync.push` + `journalSince` filter+sort; `persons (group_id)` covers `getStatus`/`journalSince` member lookups; `questions (category_id, sort_order)` is nice-to-have. Repo currently has zero non-PK indices; fine at dev scale, every `sync.push` becomes a seq-scan of millions of rows at production scale. Drizzle `index()` helpers in `schema.ts` + `drizzle-kit generate` → additive migration, safe to apply live
- [ ] `p3` Enable `eslint-react/prefer-read-only-props` — codebase-wide readonly-props convention for function components. Bulk-apply in one pass rather than landing per-component
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
