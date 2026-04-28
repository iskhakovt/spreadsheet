# UI Design

Mobile-first form app. Primary use: filling out on a phone, reviewing comparison on any device.

## Visual Design

**Theme:** Peach & Sage — warm peach accent, muted sage neutrals, cream background. Gender-neutral, inviting, not clinical.

**Font:** Lexend (≡ Lexend Deca, the narrowest width variant) — designed for readability and reduced visual stress. ND-friendly by design. Single font throughout. Lexend ships seven width variants (Deca → Zetta, progressively wider spacing); wider variants help struggling/impaired readers, narrower ones suit typical readers. Our audience is literate adults reading carefully, so Deca is the right fit.

**Border radius:** 20px everywhere. Soft, rounded, no sharp edges.

**Light mode only.** Research shows consent/wellness tools benefit from light, airy palettes that feel safe — not dark themes that feel heavy.

### Button color system

Two accent shades + one neutral. Three visual groups, not five colors:

| Rating | Color | Group |
|-|-|-|
| Yes | Accent (solid) | Positive |
| If partner wants | Accent (lighter) | Positive |
| Maybe | Neutral (solid) | Discussable |
| Fantasy only | Neutral (solid, italic text) | Discussable |
| No | Neutral (outline) | Boundary |

**No is not faded or diminished.** Every answer is a valid, confident choice.

### Design principles

- **Safety over sexiness** — pastel/warm palette, generous spacing, no pressure
- **One thing at a time** — one question, one decision per screen
- **Every answer is equal** — no color shaming for "no"
- **ND-friendly** — Lexend font, clear progress, consistent layout, breaks OK, skip OK
- **Two people, one app** — gender-neutral colors that both partners feel at home with

### Design system tokens

All visual tokens are defined as CSS custom properties in `packages/web/src/index.css` under `@theme`:

- **Palette** — `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-accent` (+ `-light`, `-dark`), `--color-neutral`, `--color-match-green`, `--color-match-blue`
- **Shape** — `--radius-lg: 20px`, `--radius-md: 16px`, `--radius-sm: 12px`
- **Motion** — `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)` used for every transition and keyframe
- **Depth** — `--shadow-accent-sm/md`, `--inset-highlight` for tactile emboss on filled buttons; `.shadow-warm`, `.shadow-warm-lg` utility classes for cards
- **Texture** — a fixed fractal-noise SVG overlay at 2.5% opacity in `body::before` gives the cream background a paper-like quality; three radial washes (peach + sage) layer behind it for "natural lighting" feel

**Animations** declared globally:
- `.animate-in` — 400ms fade + slide-up entrance on the spring curve
- `.stagger` — sibling entrance with per-element `--stagger-index` driving a 120ms step delay
- `.float-a` / `.float-b` — 20s/26s drift for decorative background blobs (different periods to avoid settling)
- `.celebrate` — one-shot scale + accent-color ring pulse for mark-complete moments
- `@media (prefers-reduced-motion: reduce)` disables all of these

The `stagger` class uses an inline `--stagger-index` prop rather than CSS `sibling-index()` because Firefox doesn't ship it yet — tracked in [../todo.md](../todo.md).

## Screens

### 1. Landing

No token in URL. Explains what Spreadsheet is.
- Tagline + explanation
- "Get started" button → Create Group form

### 2. Create Group

- Question mode toggle: "Filter by body" / "All questions"
- If filtered: label style picker + who picks anatomy (admin / each person)
- Optional: "Ask now or later?" toggle (timing sub-question, default on)
- Optional: end-to-end encryption toggle
- Submit: creates group with `adminToken`, redirects to `/p/{adminToken}`

### 3. Group Setup (admin only)

Admin enters their name + partner names. In admin-picks-anatomy mode, anatomy pickers appear for each person.
- "Create & get links" → calls `setupAdmin` (creates all persons + marks ready in one transaction)
- Shows partner links with copy buttons
- "Start filling out" → intro

### 4. Group (admin only)

Accessible from the Summary screen. Shows member list with status:
- **Done** — completed questionnaire
- **Pending setup** — filtered mode, hasn't picked anatomy yet
- **In progress** — everything else

Primary CTA is state-aware once `group.isReady`:
- Admin hasn't answered yet → "Start filling out"
- Admin has local answers but isn't done → "Continue"
- Admin marked complete → "View my answers" (→ `/review`)

### 5. Pick Anatomy (self-pick mode)

Shown when `questionMode=filtered`, `anatomyPicker=self`, and person's anatomy is null. Buttons for the configured label preset (e.g., "Penis" / "Vulva" with "Show more options" for "Both" / "Neither").

### 6. Pending

Waiting room for non-admin users. Two states:
- **"The group is being set up"** — admin hasn't marked ready yet. Shows member names.
- **"Waiting for everyone to finish setting up"** — admin marked ready, but some members haven't picked anatomy. Shows per-member status (Ready / Setting up...).

Auto-advances via universal guard when `group.isReady` becomes true. Updates arrive via the `groups.onStatus` WebSocket subscription — no polling.

### 7. Intro

One-time tutorial screen. Four steps explaining how it works, an answer-legend (what each rating means), and a tier picker. "Let's go" button.

The tier picker is a four-button radiogroup: **Essentials**, **Common**, **Adventurous**, **Edge / Risk**. Each button shows an approximate question count. The selected tier becomes `maxTier` for the question flow — answers above the picked level are hidden. Default is tier 2 (Common). Persisted to localStorage; can be revised on the Summary screen.

### 8. Category Welcome (interstitial)

Shown before the first question in each category. Part of the Question screen's `screens[]` array (discriminated union type).

```
+------------------------------+
|                              |
|     Oral                     |
|     Oral sex and mouth play  |
|     11 questions             |
|                              |
|  [        Start           ]  |
|  [  Skip this category    ]  |
|     View all categories      |
|                              |
+------------------------------+
```

"Skip this category" advances past all questions in the category. "View all categories" navigates to the Summary screen.

### 9. Question

One question per screen. Centered card (max 480px).

```
+------------------------------+
|  Oral > 3 of 11    Progress  |
|                              |
|  Going down on your partner  |
|  What's this?                |
|                              |
|  [         Yes            ]  |
|  [    If partner wants    ]  |
|  [        Maybe           ]  |
|  [    Fantasy only        ]  |
|  [         No             ]  |
|                              |
|  < Back              Skip >  |
|                              |
|  ========-----------------   |  progress bar
|                 3 unsynced   |  sync indicator (hidden until 5s stale)
+------------------------------+
```

After tapping Yes or If partner wants → timing sub-question (Now / Later) → auto-advances. Timing is optional — controlled by `showTiming` group setting. When off, yes/willing save immediately with null timing.

"Progress" link → Summary screen. Sync indicator uses `visibility: hidden` to avoid layout shifts.

**Dependency-gated questions** disappear when their parent gate is answered "no". For example, answering "no" to *Penetrative sex is welcome* hides every position, creampie, and toy that requires penetration. Per-side gating: a g/r child whose g/r parent has give-no but receive-yes still shows its receive-side. The gate question itself stays visible — gating only affects descendants.

### 10. Summary / Progress

Accessible from question header's "Progress" link. Shows:

- **Tier slider** at the top — re-pick the tier (1–4) without going back to Intro. 4-up row on `sm+`, 2×2 grid on mobile (the four labels don't fit horizontally below 640px).
- **Category list** with:
  - Toggle checkbox (enable/disable category)
  - Category label + "X of Y answered" progress bar
  - Tap to jump to that category's welcome screen

Categories whose visible-question count would be zero for this user/group are hidden entirely. This includes: tier filter removes everything; anatomy filter removes everything (e.g. all-amab group with the Reproductive category); dependency gating removes everything (every question requires a gate that's answered "no"). The picker only lists categories with at least one applicable question.

Overall progress (`totalAnswered / totalQuestions` at top) sums only across **enabled** categories, so toggling a category off shrinks both numerator and denominator together — the bar can't exceed 100%.

Buttons: "Back to questions", "Review answers", "Group members" (admin only).

### 11. Review

Shows all answered questions grouped by category. Tap any answer to jump back and edit it.
- "I'm done" button: syncs pending ops + marks complete
- "Edit categories" link → Summary screen

### 12. Waiting

After marking done. Shows member status list (Done / In progress).
- Updates live via tRPC WebSocket subscription (`groups.onStatus`)
- Auto-redirects to Results when all complete (declarative route guard)
- **"Edit my answers" button** — navigates back to `/questions` without touching completion state. Partners viewing `/results` see the subsequent edits live via the journal subscription; their route doesn't change because `isCompleted` is unchanged.

### 13. Comparison

Available once all members mark complete. Grouped by category, sorted by match quality.

| Match type | Label | Meaning |
|-|-|-|
| Both yes + now | Go for it | Green light |
| Both yes (any timing) | Match | Discuss timing |
| Both maybe | Worth discussing | Curious |
| Mixed yes/maybe | Possible | Worth exploring |
| Both fantasy | Shared fantasy | Both fantasize |
| Either said no | *Hidden* | Not shown |

**Live updates**: if any group member edits an answer after marking complete, their changes propagate to everyone viewing `/results` via the `sync.onJournalChange` WebSocket subscription (using tRPC v11's `tracked()` for reconnect-safe delivery). The comparison updates in place without a page reload.

**"Change my answers" button**: navigates to `/questions` without calling `unmarkComplete`. Same semantics as the `/waiting` "Edit my answers" button — `isCompleted` stays true for everyone, so route guards don't redirect.

## Layout

Centered card (max-width 480px) for all screens except Comparison. Comparison uses full width on desktop for pairwise display.

## Routing

URL-based routing via wouter (nested under `/p/:token`):

```
/p/:token           → catch-all, redirects via resolveRoute()
/p/:token/setup     → non-admin onboarding
/p/:token/pending   → waiting for group (declarative guard)
/p/:token/group     → admin group management
/p/:token/anatomy   → body type picker (declarative guard)
/p/:token/intro     → tutorial
/p/:token/questions → question flow
/p/:token/summary   → progress / category management
/p/:token/review    → review answers
/p/:token/waiting   → waiting for others (declarative guard)
/p/:token/results   → comparison
```

**Navigation patterns**:
- **Universal guard**: `<Redirect>` at top of Switch redirects if current route doesn't match `resolveRoute()`. Free routes (`/group`, `/summary`, `/review`, `/questions`) are exempt — users reach them intentionally.
- **`/questions` is a free route** so marked-complete users can edit their answers without unmarking. Because the guard doesn't route them off `/questions` once `isCompleted` flips, `handleMarkComplete` explicitly calls `navigate("/waiting")` after the mutation.
- **Mutations self-invalidate** via TanStack Query's `useMutation({ onSuccess: invalidateQueries })`. The handler returns the invalidation promise so the mutation stays pending until the refetch completes — callers don't need to thread a separate refresh call.

**Admin token pre-setup**: Before `setupAdmin`, the URL `/p/{adminToken}` resolves via the group's `admin_token` field. PersonApp detects `status.person === null` and renders GroupSetup directly (outside the router).

## Auto-sync

- Owned by the `useSyncQueue(totalQuestions)` hook in `lib/use-sync-queue.ts`
- Answers are synced to the server 3 seconds after the last answer (debounced)
- Sync indicator hidden for the first 5 seconds — auto-sync handles it silently
- If auto-sync fails, "N unsynced" appears below the progress bar (click to retry)
- Uses `visibility: hidden` (not conditional rendering) to prevent layout shifts
- Conflict retry: on `pushRejected`, merges the server's returned entries with local pending ops and retries once. Double-rejection leaves ops in the queue for the next manual sync.

## Encryption Key Lifecycle

1. Generated in Landing → put in URL fragment `#key=base64url`
2. Read by `getGroupKeyFromUrl()` on first access → cached in `sessionStorage`
3. `sessionStorage` survives page reloads but not new tabs (each tab gets key from URL)
4. `wrapSensitive(value)` / `unwrapSensitive(value)` handle encrypt/decrypt transparently
5. wouter's `pushState` drops the hash fragment — sessionStorage cache handles this

## ND-Friendly Considerations

- One question at a time (no overwhelming lists)
- Clear progress indication (category + position + overall bar)
- No time pressure — auto-sync saves constantly, resume anytime
- Back button to change previous answers without penalty
- Skip button — no question is mandatory
- Category welcome screens provide context and a "skip entire category" option
- Consistent layout — buttons always in the same position
- "What's this?" for unfamiliar terms
