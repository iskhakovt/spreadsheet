# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod

## Later

- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p3` Pick the right Lexend family for our target readership. Lexend ships as seven width variants (Deca, Exa, Giga, Mega, Peta, Tera, Zetta) implementing the Shaver-Troup formulation — the reading-fluency improvements that Lexend is known for come from choosing the right width, not from any OpenType features. Narrower widths (Deca, Exa, Giga) fit readers with fewer issues; wider widths (Peta, Tera, Zetta) help struggling or impaired readers. We currently import the base "Lexend" (≈ Deca) without intentional selection. Evaluate against our audience — a sex-positive questionnaire for couples/groups is read carefully but not by people with reading difficulties by default, so Deca is probably right — but the decision should be explicit and documented. See lexend.com/#faq and design.google/library/lexend-readability
- [ ] `p3` Visual regression coverage — Playwright screenshot tests or Chromatic/Percy. Current gap: keyboard focus treatment (`*:focus-visible` in `@layer base` vs per-input `focus:outline-none focus:ring-*`), animations, and color palette changes are unverified by automation. E2E tests exercise flows, not rendering. A one-shot baseline per key screen (Landing, Question, Comparison, Summary) plus `:focus-visible` hover/tab states would catch cascade-layer accidents like the double-outline bug fixed in #22 before merge. Decide on tooling first — Playwright's built-in `toHaveScreenshot` is cheapest (no external service) but needs CI-stable rendering (Linux only, fonts pinned)
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
