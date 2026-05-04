# Todo

## Next

- [ ] `p2` Fix create-group "Link not found" in `pnpm dev`. Root cause: `Landing.tsx` does `window.location.assign('/p/${token}')` after `groups.create` expecting the server's `/p/:token` handler (`spa-routes.ts:serveBootstrap`) to set the `s_${hash}` session cookie. In production the same Hono process serves `/api/*`, `/p/:token`, and the SPA shell — works. In dev, Vite serves `/p/:token` from its own history fallback (the proxy in `web/vite.config.ts` only forwards `/api/*`), so `serveBootstrap` never runs and the cookie is never set. SPA mounts → `groups.status` returns null → "Link not found". Fix per the standard Vite + Hono pattern: replace the two-process dev (vite + `tsx watch src/index.ts`) with `@hono/vite-dev-server`, which runs the Hono app inside Vite so `/p/:token` runs the real handler and Vite injects HMR into the response. Drop the proxy entries; `scripts/dev.ts` no longer spawns a separate server. Watch out: WS upgrade for `/api/trpc-ws` currently attaches to the Node HTTP server in `index.ts:server.on("upgrade", ...)` — needs to attach to Vite's HTTP server in dev.
- [ ] `p2` Investigate local `pnpm test:e2e` flakiness — different runs produce different sets of failures (3, 10, 12 across runs on the same code), with characteristic "Target page, context or browser has been closed" timeouts. Affects both `main` and feature branches; CI Docker image runs are clean. Likely resource contention on the local Chromium pool or fixture lifecycle. Fix so local pre-push e2e is a usable signal.

## Later

- [ ] `p2` Rotate person token on first land — admin currently knows partner tokens (returned by `setupAdmin`), so they could use a partner's token to read unsubmitted answers via the sync journal. Rotating the token when the partner first opens their link would close this.
- [ ] `p3` Migrate `.stagger` animation delay to native CSS `sibling-index()` once Firefox ships it. Currently the `.stagger` class reads its delay from an inline `--stagger-index` custom property per element — works everywhere and scales to any count, but authors must remember to set the index. `sibling-index() * 100ms` in CSS would be fully declarative (zero inline style, zero prop passing). Chrome 132+ / Safari 18.2+ already support it; blocked on Firefox. Track at caniuse.com/css-sibling-functions
- [ ] `p3` Revisit focus-visible — global vs per-component. Currently `index.css` has a single `*:focus-visible { outline: 2px solid var(--color-accent-light); outline-offset: 2px }` that every interactive element inherits. The React + Tailwind convention (shadcn/ui, Tailwind UI) is per-component `focus-visible:` utilities in each component's className. Trade-off is cross-element consistency (current) vs. per-component tunability. Worth migrating if/when the app grows shared components that need distinct focus treatments; stay global otherwise.
- [ ] `p3` Stop the TanStack Router code-split warning on `routes/p/$token/results.tsx`. The router complains that named exports (`ResultsRoute`, etc.) won't be code-split and will increase bundle size. Move the named export out of the route file or drop the export entirely so each `/p/$token/...` route can be lazily loaded.
- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod
- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
