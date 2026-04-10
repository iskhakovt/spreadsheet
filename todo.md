# Todo

## Next

- [ ] `p3` v2 illustrations — AI-generated via Flux on RunPod

## Done

- [x] TanStack Query v5 + `@trpc/tanstack-react-query` migration (unified server-state management, `tracked()` subscription for lossless reconnect-safe journal delivery, edit-without-unmark UX so partners see live edits without being kicked from /results, polling fallback removed)
- [x] tRPC subscriptions over WebSocket for cross-user state sync (replaced 5s/30s polling, instant updates, polling fallback retained)

## Later

- [ ] E2E sharding across CI jobs (when test count/runtime grows)
- [ ] Background Sync API for offline sync (when Safari supports it)
- [ ] GlitchTip deployment (error tracking)
- [ ] i18n (question bank + UI text)
- [ ] Push notifications ("partner is done!")
- [ ] Custom questions per group
- [ ] Bundle size budget in CI
