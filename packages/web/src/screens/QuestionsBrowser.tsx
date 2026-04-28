import { type CategoryData, MAX_TIER, type QuestionData, type Tier } from "@spreadsheet/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowLeft, Pencil, Search } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { buildChildrenOf, isGate } from "../lib/dependency-graph.js";
import { useTRPC } from "../lib/trpc.js";

const TIERS: Tier[] = Array.from({ length: MAX_TIER }, (_, i) => (i + 1) as Tier);
const TIER_LABELS: Record<Tier, string> = {
  1: "Essentials",
  2: "Common",
  3: "Adventurous",
  4: "Edge",
};

/**
 * Public read-only browser of the question bank. Lets visitors see exactly
 * what we'd ask before signing up, and serves as a debugging inspector
 * for the curated `requires` graph and tier ordering.
 *
 * Source of truth is the live `trpc.questions.list` endpoint — auto-updates
 * with each deploy, no build-time manifest. No auth, no edit, robots:noindex.
 */
export function QuestionsBrowser() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.questions.list.queryOptions());

  const [tier, setTier] = useState<Tier>(MAX_TIER);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const childrenOf = useMemo(() => buildChildrenOf(data.questions), [data.questions]);
  const questionMap = useMemo(() => new Map(data.questions.map((q) => [q.id, q] as const)), [data.questions]);

  const visibleQuestions = useMemo(() => {
    let qs = data.questions.filter((q) => q.tier <= tier);
    if (deferredQuery) {
      qs = qs.filter((q) => matchesQuery(q, deferredQuery));
    }
    return qs;
  }, [data.questions, tier, deferredQuery]);

  // ID-set view of `visibleQuestions` so child rows can tell at render time
  // whether a parent they'd like to jump to is mounted right now. Used to
  // disable the "requires X" chip when the search filter has hidden the
  // parent — without this, the click would silently no-op.
  const visibleIds = useMemo(() => new Set(visibleQuestions.map((q) => q.id)), [visibleQuestions]);

  const grouped = useMemo(() => {
    const map = new Map<string, QuestionData[]>();
    for (const q of visibleQuestions) {
      const list = map.get(q.categoryId) ?? [];
      list.push(q);
      map.set(q.categoryId, list);
    }
    return map;
  }, [visibleQuestions]);

  // Refs for scroll-and-flash on `requires` chip clicks. Map ids → element so
  // clicking a parent chip from anywhere in the page can flash the target.
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);
  const flashCard = useCallback((id: string) => {
    const el = cardRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Re-trigger the CSS animation by toggling the class.
    el.classList.remove("question-flash");
    void el.offsetWidth;
    el.classList.add("question-flash");
  }, []);

  const totalVisible = visibleQuestions.length;
  const totalAll = data.questions.length;

  return (
    <div className="relative min-h-dvh px-4 py-10 sm:py-14 overflow-hidden">
      {/* Soft atmospheric backdrop, matching Comparison/Landing. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="float-a absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[100px] opacity-20"
          style={{ background: "radial-gradient(circle, #e4b898 0%, transparent 65%)" }}
        />
        <div
          className="float-b absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full blur-[80px] opacity-15"
          style={{ background: "radial-gradient(circle, #7aab8e 0%, transparent 70%)" }}
        />
      </div>

      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-text-muted/70 hover:text-accent transition-colors duration-200 mb-6"
          >
            <ArrowLeft size={14} strokeWidth={1.5} />
            Back to home
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/70 mb-3">Every question</p>
          <h1 className="text-[2.75rem] sm:text-[3.25rem] font-bold leading-[0.95] tracking-[-0.03em]">
            Browse the bank
          </h1>
          <p className="mt-4 text-text-muted text-pretty leading-[1.6] max-w-prose">
            See exactly what we'd ask before signing up. Filter by depth, search for a topic, follow the chains between
            questions.
          </p>
        </header>

        {/* Sticky filter bar — sits below the hero so the page scrolls past it
            cleanly. Tier picker on the left, search on the right; stacks on
            narrow viewports. */}
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-8 bg-bg/80 backdrop-blur-md border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TierPicker tier={tier} onChange={setTier} />
            <label className="relative flex-1 sm:max-w-xs">
              <Search
                size={14}
                strokeWidth={1.75}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/60 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search questions"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-full bg-surface/70 border border-border/50 placeholder:text-text-muted/55 focus:outline-none focus:border-accent/40 focus:bg-white transition-all duration-200"
              />
            </label>
          </div>
          <p className="text-[11px] text-text-muted/60 mt-2 tabular-nums">
            {totalVisible} of {totalAll} {totalAll === 1 ? "question" : "questions"} shown
          </p>
        </div>

        {/* Category sections — empty categories drop out of the list when the
            filter excludes everything they hold. */}
        <div className="space-y-12">
          {data.categories.map((cat) => {
            const qs = grouped.get(cat.id);
            if (!qs?.length) return null;
            return (
              <CategorySection
                key={cat.id}
                category={cat}
                questions={qs}
                questionMap={questionMap}
                childrenOf={childrenOf}
                visibleIds={visibleIds}
                onParentClick={flashCard}
                registerCard={registerCard}
              />
            );
          })}
          {totalVisible === 0 && (
            <div className="text-center py-16 text-text-muted/70">
              <p className="text-sm italic">No questions match your filter.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * True when the question matches the search needle in any of: id,
 * primary text, give/receive variants, description, or category id.
 * Caller should lowercase the needle once to keep the filter pure.
 */
export function matchesQuery(q: QuestionData, needle: string): boolean {
  return (
    q.id.toLowerCase().includes(needle) ||
    q.text.toLowerCase().includes(needle) ||
    (q.giveText?.toLowerCase().includes(needle) ?? false) ||
    (q.receiveText?.toLowerCase().includes(needle) ?? false) ||
    (q.description?.toLowerCase().includes(needle) ?? false) ||
    q.categoryId.toLowerCase().includes(needle)
  );
}

/**
 * Tier filter — WAI-ARIA radio group with roving tabindex. Only the selected
 * radio is in tab order; ArrowLeft/Right move + commit, Home/End jump to
 * ends. Mirrors the pattern in `RatingGroup` (QuestionCard.tsx).
 */
function TierPicker({ tier, onChange }: Readonly<{ tier: Tier; onChange: (t: Tier) => void }>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [shouldFocusSelected, setShouldFocusSelected] = useState(false);
  const selectedIdx = TIERS.indexOf(tier);

  // Focus the newly-selected radio after a keyboard arrow commit so the
  // tab-order anchor follows the user. Only fires when explicitly set —
  // mouse clicks shouldn't steal focus.
  useEffect(() => {
    if (!shouldFocusSelected) return;
    refs.current[selectedIdx]?.focus();
    setShouldFocusSelected(false);
  }, [shouldFocusSelected, selectedIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    const len = TIERS.length;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (selectedIdx + 1) % len;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (selectedIdx - 1 + len) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(TIERS[next]);
    setShouldFocusSelected(true);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Question depth"
      // 2-up on phone — "Adventurous" doesn't fit comfortably alongside three
      // siblings at 375-390px. 4-up unlocks once the row has room (≥sm).
      // Mirrors the Summary tier picker's responsive grid.
      className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1"
      onKeyDown={handleKeyDown}
    >
      {TIERS.map((t, i) => {
        const checked = tier === t;
        return (
          // biome-ignore lint/a11y/useSemanticElements: button[role=radio] is the WAI-ARIA APG pattern for custom radio groups
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(t)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
              checked
                ? "bg-gradient-to-b from-accent to-accent-dark text-accent-fg shadow-accent-md"
                : "bg-surface/70 text-text-muted hover:text-text hover:bg-surface",
            )}
            title={`Tiers 1–${t}`}
          >
            {TIER_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

function CategorySection({
  category,
  questions,
  questionMap,
  childrenOf,
  visibleIds,
  onParentClick,
  registerCard,
}: Readonly<{
  category: CategoryData;
  questions: QuestionData[];
  questionMap: Map<string, QuestionData>;
  childrenOf: Map<string, string[]>;
  visibleIds: ReadonlySet<string>;
  onParentClick: (id: string) => void;
  registerCard: (id: string, el: HTMLElement | null) => void;
}>) {
  return (
    <section>
      <h2 className="flex items-baseline gap-3 mb-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/85">{category.label}</span>
        <span className="flex-1 h-px bg-border/40" />
        <span className="text-[11px] tabular-nums text-text-muted/55">{questions.length}</span>
      </h2>
      <p className="text-sm text-text-muted/85 italic mb-4 leading-[1.55]">{category.description}</p>
      <ul className="space-y-2">
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            questionMap={questionMap}
            childrenOf={childrenOf}
            visibleIds={visibleIds}
            onParentClick={onParentClick}
            registerCard={registerCard}
          />
        ))}
      </ul>
    </section>
  );
}

const TIER_BADGE_STYLES: Record<Tier, string> = {
  1: "bg-accent/15 text-accent-dark border border-accent/25",
  2: "bg-accent-light/15 text-accent-dark border border-accent-light/30",
  3: "bg-neutral/15 text-text-muted border border-neutral/25",
  4: "bg-transparent text-text-muted border border-dashed border-border/60 italic",
};

function QuestionRow({
  question: q,
  questionMap,
  childrenOf,
  visibleIds,
  onParentClick,
  registerCard,
}: Readonly<{
  question: QuestionData;
  questionMap: Map<string, QuestionData>;
  childrenOf: Map<string, string[]>;
  visibleIds: ReadonlySet<string>;
  onParentClick: (id: string) => void;
  registerCard: (id: string, el: HTMLElement | null) => void;
}>) {
  const isRoleBased = q.giveText !== null || q.receiveText !== null;
  const childrenCount = childrenOf.get(q.id)?.length ?? 0;
  const gate = isGate(q.id, childrenOf);
  const tier = q.tier as Tier;
  return (
    <li
      ref={(el) => registerCard(q.id, el)}
      data-question-id={q.id}
      className="group relative px-4 py-3 rounded-[var(--radius-md)] bg-white/65 border border-border/35 shadow-warm-sm transition-all duration-200 hover:border-accent/25 hover:bg-white"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] mt-1",
            TIER_BADGE_STYLES[tier],
          )}
          title={`Tier ${tier} — ${TIER_LABELS[tier]}`}
        >
          T{tier}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[15px] leading-[1.4] text-pretty">{q.text}</span>
            {isRoleBased && <RoleMarker />}
            {q.notePrompt && <NotePromptMarker prompt={q.notePrompt} />}
            {gate && <GateMarker count={childrenCount} />}
          </div>
          {q.description && (
            <p className="mt-1 text-[13px] text-text-muted/85 italic leading-[1.55] text-pretty">{q.description}</p>
          )}
          {(q.requires.length > 0 || (childrenCount > 0 && !gate)) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Array.from(new Set(q.requires)).map((parentId) => {
                const parent = questionMap.get(parentId);
                // Disable when the search filter has hidden the parent —
                // clicking would silently no-op since there's no element to
                // scroll to. Tier filter alone can't hide a parent (seed
                // validation rejects child-tier < parent-tier), so this only
                // bites under search.
                const parentHidden = !visibleIds.has(parentId);
                return (
                  <button
                    key={parentId}
                    type="button"
                    onClick={() => onParentClick(parentId)}
                    disabled={parentHidden}
                    aria-disabled={parentHidden}
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface/70 border border-border/40 transition-colors duration-200",
                      parentHidden
                        ? "text-text-muted/45 line-through cursor-not-allowed"
                        : "text-text-muted/85 hover:text-accent hover:bg-white",
                    )}
                    title={
                      parentHidden
                        ? `${parentId} is hidden by your search — clear it to jump`
                        : parent
                          ? `Jump to: ${parent.text}`
                          : parentId
                    }
                  >
                    <ArrowDownToLine size={10} strokeWidth={1.75} aria-hidden="true" />
                    requires {parentId}
                  </button>
                );
              })}
              {childrenCount > 0 && !gate && (
                <span className="text-[11px] text-text-muted/60">
                  → {childrenCount} child{childrenCount === 1 ? "" : "ren"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function RoleMarker() {
  return (
    <span
      className="inline-flex items-center text-[10px] font-medium uppercase tracking-[0.1em] text-accent-light-dark px-1.5 py-0.5 rounded bg-accent-light/10"
      title="Role-based — give and receive answered separately"
    >
      give · receive
    </span>
  );
}

function NotePromptMarker({ prompt }: Readonly<{ prompt: string }>) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-accent/85 px-1.5 py-0.5 rounded bg-accent/10"
      title={`Encourages a note: ${prompt}`}
    >
      <Pencil size={9} strokeWidth={1.75} aria-hidden="true" />
      note
    </span>
  );
}

function GateMarker({ count }: Readonly<{ count: number }>) {
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-dark px-1.5 py-0.5 rounded-full border border-accent/30 bg-accent/10"
      title={`Gateway question — answering "no" hides ${count} dependent questions`}
    >
      gate · {count}
    </span>
  );
}
