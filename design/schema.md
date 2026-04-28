# Database Schema

All entity tables use UUIDv4 primary keys (`gen_random_uuid()`) and `created_at TIMESTAMPTZ DEFAULT now()`. All columns are NOT NULL unless explicitly nullable. UUIDv4 chosen over v7 — no need for sortable IDs at this scale, and random IDs avoid leaking creation order.

## Tables

### groups

| Column | Type | Notes |
|-|-|-|
| id | UUID | PK |
| admin_token | text | Unique, nullable. Set at creation, cleared after `setupAdmin`. Used as the admin's entry URL before setup. |
| encrypted | boolean | Whether answers are E2E encrypted. Set at creation, immutable. |
| is_ready | boolean | Admin has finished setup (added members, marked ready). |
| question_mode | enum ("all", "filtered") | Whether questions are filtered by anatomy. |
| show_timing | boolean | Whether to ask "now or later?" after yes/willing answers. |
| anatomy_labels | text | Nullable. Label preset: "anatomical", "gendered", "amab", "short". Only used when filtered. |
| anatomy_picker | text | Nullable. Who picks anatomy: "admin" or "self". Only used when filtered. |
| created_at | timestamptz | |

### persons

| Column | Type | Notes |
|-|-|-|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| name | text | Display name (plaintext) or opaque string (encrypted mode). Server never interprets. |
| anatomy | text | Nullable. `"amab"`, `"afab"`, `"both"`, or `"none"` (plaintext) or opaque (encrypted). Null until picked in self-pick mode. |
| token | text | Unique, URL-safe. Used in `/p/{token}`. Admin's token = the group's `admin_token` (reused by `setupAdmin`). |
| is_admin | boolean | Always plaintext — server needs for authorization. |
| is_completed | boolean | Set when person taps "I'm done". Boolean, not timestamp — avoids leaking *when*. |
| progress | text | Nullable. Opaque — `p:1:{"answered":47,"total":120}` or `e:1:...`. Client-reported on sync. |
| created_at | timestamptz | |

**In encrypted mode**, `name`, `anatomy`, and `progress` are opaque strings. The client encrypts before sending and decrypts after receiving using the key from the URL fragment.

### categories

| Column | Type | Notes |
|-|-|-|
| id | text | PK, e.g. `"oral"`. Human-readable, stable across seeds. |
| label | text | Display name, e.g. `"Oral"` |
| description | text | Short description for category welcome screen |
| sort_order | integer | Display order |

### questions

| Column | Type | Notes |
|-|-|-|
| id | text | PK, e.g. `"cunnilingus"`. Human-readable, stable across seeds. |
| category_id | text | FK → categories |
| text | text | Activity name (used in comparison view headers) |
| give_text | text | Nullable. Display text for "give" screen |
| receive_text | text | Nullable. Display text for "receive" screen |
| description | text | Nullable. One-line explanation shown via "What's this?" |
| target_give | enum ("all", "amab", "afab") | Who sees the give screen |
| target_receive | enum ("all", "amab", "afab") | Who sees the receive screen |
| tier | integer | 1 (essentials), 2 (common), 3 (adventurous), 4 (edge / risk). Default 1. Filtered by the user's tier picker — answers above the picker level are hidden from the flow. |
| note_prompt | text | Nullable. Placeholder text + "encourage a free-text note here" signal. Presence prompts the UI to expand the note input by default; absence renders a collapsed "Add a note" affordance. |
| sort_order | integer | Display order within category |

### question_dependencies

Junction table expressing single- or multi-parent dependencies between questions. AND-only semantics: a child is hidden when ANY required parent is answered "no" (transitively). OR-multi-parent is not supported by design — if a child has multiple plausible parents, pick one canonical parent or leave it independent.

| Column | Type | Notes |
|-|-|-|
| question_id | text | FK → questions, `ON DELETE CASCADE`. The child. |
| requires_question_id | text | FK → questions, `ON DELETE RESTRICT`. The parent — can't be deleted while a dependency still references it. |

Composite primary key on `(question_id, requires_question_id)`. Reverse-lookup index on `requires_question_id` for FK perf and "find children of P" queries.

Seed-time validation in `QuestionStore.seed` rejects: self-loops, unknown refs, child tier < parent tier, and child appearing at-or-before parent in the seed array (the array order becomes the participant flow order — children must come after their gate).

### journal_entries

Append-only log of answer operations. See [sync.md](sync.md) for protocol details.

| Column | Type | Notes |
|-|-|-|
| id | bigserial | PK. Server-assigned, monotonically increasing. |
| person_id | UUID | FK → persons |
| operation | text | Opaque — validated to have `p:1:` or `e:1:` prefix before insert. Server never reads content. |
| created_at | timestamptz | When the server received the entry |

## Entity Relationships

```
group 1──* person 1──* journal_entry
question *──1 category
question 1──* question_dependency *──1 question  (self-edge: child → parent)
```

## Admin Token Flow

1. `groups.create` generates a random `admin_token` and stores it on the group. No person is created yet.
2. The admin visits `/p/{admin_token}`. The `status` query checks `persons.token` first, then falls back to `groups.admin_token`.
3. `setupAdmin` creates the admin person with `token = admin_token` (same value, so the URL keeps working), creates partner persons, marks the group ready, and sets `admin_token` to null — all in one transaction.
4. After setup, the same URL resolves via the person token. No redirect needed.

## Question Structure

Each question belongs to a category. Questions are ordered by `(categories.sort_order, questions.sort_order)` via a JOIN query.

### Mutual vs role-based

- **Mutual**: one screen, one rating. E.g. "Blindfolds".
- **Role-based**: two screens (give + receive), two ratings. E.g. "Cunnilingus".

The presence of `give_text`/`receive_text` determines which type.

### Anatomy targeting

`target_give` and `target_receive` filter who sees each screen. Group-aware: a screen only appears if both the giver and receiver anatomy exist in the group.

### Dependency gating

A question may declare `requires:` (one or more parent question IDs). The child is hidden from a user's flow when any required parent is answered "no" — transitively, and per-side when both parent and child are give/receive (give-no on the parent hides only the child's give-side; receive-no hides only receive). Mutual ↔ give/receive combinations propagate "any-side no" to the corresponding child side. See `packages/web/src/lib/visibility.ts` for the full mapping table.

A handful of gateway questions (`sex-generally`, `oral-generally`, `penetration-generally`, `external-people-generally`, `bondage-generally`, `impact-generally`, `power-generally`, `roleplay-generally`, `exhibitionism-generally`, `edge-generally`) sit at the top of their respective subtrees so a user who's a flat "no" to a domain can skip the whole branch with one answer. Pre-sex-friendly content (kissing, cuddling, environment, communication) has no gate and stays visible to everyone.

Gating is enforced client-side. The server stores the dependency graph and returns it via `questions.list`; the client's `visibleSides` helper combines anatomy + dependency state per render. For matching, a gated-as-no answer is treated as an implicit "no" — gating doesn't classify as missing.

## Rating Scale

| Rating | Meaning | Timing shown? |
|-|-|-|
| Yes | I want this | Yes |
| If partner wants | Neutral — I'd do it for them | Yes |
| Maybe | Curious, need to discuss | No |
| Fantasy only | Hot to think about, don't want to do | No |
| No | Hard no | No |

Timing: `now` (ready to try) or `later` (interested but not yet). Controlled by `groups.show_timing` — when off, the timing sub-question is skipped and all answers have null timing. With null timing, both-yes answers classify as "Match" instead of "Go for it" (which requires both-now).
