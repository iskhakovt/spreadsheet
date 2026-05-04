# Todo

## Next

## Later

- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] `p3` Add a `plainOp(key, data)` helper to `packages/server/src/test/factories.ts` (mirroring the one in `packages/web/src/lib/journal.test.ts`) and migrate the ~63 raw-string `'p:1:{...}'` fixtures across the 6 server test files (`store/sync.test.ts`, `trpc/routes/{sync,sync.integration,sync.self-journal-subscription.integration,sync.journal-subscription.integration,groups.subscription.integration}.test.ts`) to use it. Type-checks fixture shape against `Answer`, so future field drops fail compile instead of silently leaving stale keys (the way `timing` survived #131). Pure mechanical refactor, ~75-line PR, no production code touched. Consider exporting a single shared helper from `@spreadsheet/shared` so server and web tests don't duplicate it.
- [ ] `p2` Pull the testcontainers Postgres image from ECR Public instead of Docker Hub to dodge the 200-pulls/day Free-tier limit on `DOCKERHUB_USERNAME`. Change `packages/server/src/test/integration-setup.ts:8` from `new PostgreSqlContainer("postgres:17")` to `new PostgreSqlContainer("public.ecr.aws/docker/library/postgres:17")`. ECR Public mirrors the official Postgres image, no rate limit, no auth required, same content. While there: audit other Hub pulls in CI (e.g. the `app` image's Node base in the bake build, `mcr.microsoft.com/playwright` is fine — already from MCR not Hub) and mirror any others through ECR Public if they're rate-limit-prone. Alternative: upgrade Docker Hub to Pro (~$5/mo) — zero code change but recurring cost.
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
