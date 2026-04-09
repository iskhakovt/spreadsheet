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
| sort_order | integer | Display order within category |

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
```

## Admin Token Flow

1. `groups.create` generates a random `admin_token` and stores it on the group. No person is created yet.
2. The admin visits `/p/{admin_token}`. The `status` query checks `persons.token` first, then falls back to `groups.admin_token`.
3. `setupAdmin` creates the admin person (reusing `admin_token` as the person's `token`), creates partner persons, marks the group ready, and clears `admin_token`.
4. After setup, the same URL resolves via the person token. No redirect needed.

## Question Structure

Each question belongs to a category. Questions are ordered by `(categories.sort_order, questions.sort_order)` via a JOIN query.

### Mutual vs role-based

- **Mutual**: one screen, one rating. E.g. "Blindfolds".
- **Role-based**: two screens (give + receive), two ratings. E.g. "Cunnilingus".

The presence of `give_text`/`receive_text` determines which type.

### Anatomy targeting

`target_give` and `target_receive` filter who sees each screen. Group-aware: a screen only appears if both the giver and receiver anatomy exist in the group.

## Rating Scale

| Rating | Meaning | Timing shown? |
|-|-|-|
| Yes | I want this | Yes |
| If partner wants | Neutral — I'd do it for them | Yes |
| Maybe | Curious, need to discuss | No |
| Fantasy only | Hot to think about, don't want to do | No |
| No | Hard no | No |

Timing: `now` (ready to try) or `later` (interested but not yet). Controlled by `groups.show_timing` — when off, all answers have null timing and "Go for it" (both-yes + both-now) downgrades to "Match" (both-yes).
