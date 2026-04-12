import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useMemo, useRef, useState } from "react";
import { buildGroupedMatches, buildPairMatches, type QuestionInfo } from "../lib/build-pair-matches.js";
import type { MatchType } from "../lib/classify-match.js";
import {
  type CachedJournal,
  JOURNAL_QUERY_KEY,
  type MemberAnswers,
  makeJournalQueryFn,
  rebuildMemberAnswers,
} from "../lib/journal-query.js";
import { buildPairs, nextTabIndex, sortMembersViewerFirst, viewerDisplayName } from "../lib/member-display.js";
import { mergeJournal } from "../lib/merge-journal.js";
import { useTRPC, useTRPCClient } from "../lib/trpc.js";

/**
 * Visual treatment per match type. "Go for it" is the celebratory tier:
 * solid accent gradient, bright label. Everything else steps down in
 * temperature so the eye can sort the page at a glance without effort.
 *
 * Every answer is equal, but discovering a mutual "yes + now" is the
 * payoff this app exists for — it earns a distinctive treatment.
 */
interface MatchStyle {
  container: string;
  badge: string;
  label: string;
  labelStyle: string;
}

interface ComparisonProps {
  viewerId: string;
  /** Whether the group was set up with the "now/later" timing sub-question.
   *  Controls visibility of the `Go for it` summary (green-light count) —
   *  without timing mode, the green-light tier is unreachable so the column
   *  would always display 0, which is just noise. */
  showTiming: boolean;
  onBack?: () => void;
}

interface PairComparisonProps {
  a: MemberAnswers;
  b: MemberAnswers;
  aDisplayName: string;
  bDisplayName: string;
  /** Whether A is the current viewer — controls whether match-row labels
   *  get a parenthetical ("(Bob)" when Bob is A in an other-vs-other pair,
   *  nothing when A is the viewer because the rows already read from A). */
  aIsViewer: boolean;
  showTiming: boolean;
  questions: Record<string, QuestionInfo>;
  categories: Record<string, string>;
  categoryOrder: string[];
  questionOrder: Record<string, number>;
  showHeading?: boolean;
}

const MATCH_STYLES: Record<MatchType, MatchStyle> = {
  "green-light": {
    container:
      "bg-gradient-to-br from-accent/20 via-accent-light/15 to-accent/10 border border-accent/25 shadow-sm shadow-accent/10",
    badge: "bg-accent text-accent-fg",
    label: "Go for it",
    labelStyle: "font-semibold",
  },
  match: {
    container: "bg-accent-light/20 border border-accent-light/30",
    badge: "bg-accent-light text-accent-fg",
    label: "Match",
    labelStyle: "font-medium",
  },
  "both-maybe": {
    container: "bg-surface/80 border border-border/50",
    badge: "bg-neutral/15 text-text-muted",
    label: "Worth discussing",
    labelStyle: "font-medium",
  },
  possible: {
    container: "bg-surface/60 border border-border/40",
    badge: "bg-neutral/10 text-text-muted",
    label: "Possible",
    labelStyle: "font-medium",
  },
  fantasy: {
    container: "bg-surface/50 border border-dashed border-border/60",
    badge: "bg-neutral/10 text-text-muted",
    label: "Shared fantasy",
    labelStyle: "font-medium italic",
  },
  hidden: { container: "", badge: "", label: "", labelStyle: "" },
};

/**
 * Compares answers between pairs of group members on /results.
 *
 * Data flow:
 * 1. `useSuspenseQuery(trpc.sync.journal, { sinceId: null })` fetches the
 *    initial backfill via HTTP and suspends until it lands.
 * 2. `useSubscription(trpc.sync.onJournalChange, { lastEventId })` opens
 *    a tRPC v11 tracked subscription over WS. The initial `lastEventId`
 *    is seeded from the HTTP query's cursor so the subscription starts
 *    streaming only new entries.
 * 3. Each subscription push's `onData` merges the new entries into the
 *    same TanStack cache entry via `setQueryData` — the query and the
 *    subscription share one source of truth.
 * 4. A `useEffect` keyed on `journal.entries` runs async decryption and
 *    replay per member, producing `memberAnswers` which drives the UI.
 *
 * Reconnect is lossless by construction: wsLink auto-reconnects and
 * re-sends the subscription message with the latest tracked id, so the
 * server's generator replays entries > lastEventId. See Step 4's
 * sync.journal-subscription.integration.test.ts for the full contract.
 */
export function Comparison({ viewerId, showTiming, onBack }: ComparisonProps) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const queryClient = useQueryClient();

  // Questions list — cached session-wide, feeds the category/question lookup tables.
  const { data: questionsData } = useSuspenseQuery(trpc.questions.list.queryOptions());

  const questions = useMemo(() => {
    const qMap: Record<string, QuestionInfo> = {};
    for (const q of questionsData.questions) {
      qMap[q.id] = { text: q.text, categoryId: q.categoryId, giveText: q.giveText, receiveText: q.receiveText };
    }
    return qMap;
  }, [questionsData.questions]);

  const categories = useMemo(() => {
    const cMap: Record<string, string> = {};
    for (const c of questionsData.categories) {
      cMap[c.id] = c.label;
    }
    return cMap;
  }, [questionsData.categories]);

  const categoryOrder = useMemo(() => questionsData.categories.map((c) => c.id), [questionsData.categories]);

  const questionOrder = useMemo(() => {
    const qOrder: Record<string, number> = {};
    for (let i = 0; i < questionsData.questions.length; i++) {
      qOrder[questionsData.questions[i].id] = i;
    }
    return qOrder;
  }, [questionsData.questions]);

  // Initial journal backfill — suspends until server responds AND the
  // per-member replay + decryption finishes. By doing this inside the
  // queryFn we skip the old "render → useEffect → async replay → setState
  // → re-render" cycle entirely. The cache stores the decrypted shape,
  // so on first paint Comparison already has memberAnswers.
  //
  // The queryFn + JOURNAL_QUERY_KEY are shared with `prefetchJournal` in
  // useLiveStatus, which pre-warms this cache entry the moment the WS push
  // signals allComplete. On the receiver side (Alice seeing Bob's complete),
  // by the time this component mounts the data is usually already ready.
  const { data: journal } = useSuspenseQuery({
    queryKey: JOURNAL_QUERY_KEY,
    queryFn: makeJournalQueryFn(trpcClient),
  });

  // Cursor seeded from the HTTP backfill so the subscription doesn't re-fetch
  // the same entries. Captured once on mount via useState's lazy initializer;
  // the subscription advances its own tracked cursor from here. Re-renders do
  // not recompute this value, so the subscription input stays stable.
  const [initialLastEventId] = useState<string | null>(() => {
    const last = journal.entries[journal.entries.length - 1];
    return last ? String(last.id) : null;
  });

  // Monotonic sequence counter: if two subscription updates arrive in quick
  // succession and their async replays interleave, drop stale applies.
  const seqRef = useRef(0);

  // Live updates via tracked subscription. onData merges the new raw entries
  // into the cached raw set, re-replays members over the merged entries,
  // and writes the derived shape back via setQueryData.
  //
  // tRPC v11 tracked subscriptions deliver `{ id, data }` to onData, where
  // `data` is the payload the server yielded via `tracked(id, data)`.
  useSubscription(
    trpc.sync.onJournalChange.subscriptionOptions(
      { lastEventId: initialLastEventId },
      {
        onData: async (msg) => {
          const entries = msg.data.entries;
          if (entries.length === 0) return;
          const mySeq = ++seqRef.current;
          try {
            const current = queryClient.getQueryData<CachedJournal>(JOURNAL_QUERY_KEY);
            if (!current) return;
            // Dedup + append via the pure helper
            const mergedRaw = mergeJournal({ ...current }, entries);
            // Rebuild only the per-person `answers` from the merged entries.
            // Names/anatomy were already decrypted in the initial queryFn and
            // haven't changed, so we don't re-run unwrapSensitive on them.
            const members = await rebuildMemberAnswers(current.members, mergedRaw.entries);
            // Drop if a newer push already landed while we were replaying
            if (mySeq !== seqRef.current) return;
            queryClient.setQueryData(JOURNAL_QUERY_KEY, {
              members,
              entries: mergedRaw.entries,
              cursor: mergedRaw.cursor,
            });
          } catch (err) {
            console.error("Failed to merge journal update:", err);
          }
        },
        onError: (err) => {
          console.error("Journal subscription error:", err);
        },
      },
    ),
  );

  const memberAnswers = useMemo(() => sortMembersViewerFirst(journal.members, viewerId), [journal.members, viewerId]);

  const [activePairKey, setActivePairKey] = useState<string | null>(null);

  const pairs = useMemo(() => buildPairs(memberAnswers), [memberAnswers]);

  const showTabs = pairs.length > 1;
  const pairKey = (a: MemberAnswers, b: MemberAnswers) => `${a.id}-${b.id}`;
  const visiblePair = pairs.find((p) => pairKey(p.a, p.b) === activePairKey) ?? pairs[0];
  const displayName = (member: MemberAnswers) => viewerDisplayName(member, viewerId);

  // Roving tabindex + arrow-key navigation for the tablist (WAI-ARIA APG).
  // Active tab has tabIndex=0, others tabIndex=-1, arrow/Home/End move focus
  // and activate the new tab.
  const tabListRef = useRef<HTMLDivElement>(null);
  const activeIndex = visiblePair
    ? pairs.findIndex((p) => pairKey(p.a, p.b) === pairKey(visiblePair.a, visiblePair.b))
    : 0;

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(e.key, activeIndex, pairs.length);
    if (next === null) return;
    e.preventDefault();
    const nextPair = pairs[next];
    setActivePairKey(pairKey(nextPair.a, nextPair.b));
    // Move focus to the newly-active tab so keyboard users stay inside the tablist
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  return (
    <div className="relative min-h-screen px-4 py-10 sm:py-14 overflow-hidden">
      {/* Atmospheric backdrop — same technique as Landing but softer, so
          /results feels like a destination, not just another form screen. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="float-a absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-3xl opacity-25"
          style={{ background: "radial-gradient(circle, #e4b898 0%, transparent 65%)" }}
        />
      </div>

      <div className="max-w-2xl mx-auto space-y-10">
        <header className="text-center space-y-3">
          <p
            className="stagger text-xs font-medium uppercase tracking-[0.2em] text-accent/80"
            style={{ "--stagger-index": 0 } as React.CSSProperties}
          >
            Everyone's done
          </p>
          <h1
            className="stagger text-[2.75rem] sm:text-[3.25rem] font-bold leading-[0.95] tracking-[-0.02em]"
            style={{ "--stagger-index": 1 } as React.CSSProperties}
          >
            Your matches
          </h1>
          <div
            className="stagger inline-flex items-center gap-3 pt-1"
            style={{ "--stagger-index": 2 } as React.CSSProperties}
          >
            <span className="h-px w-10 bg-accent/30" />
            <p className="text-sm text-text-muted italic">
              {memberAnswers.length > 2
                ? `${memberAnswers.length} people, one shared space`
                : "Two people, one shared space"}
            </p>
            <span className="h-px w-10 bg-accent/30" />
          </div>
        </header>

        {showTabs && (
          <div
            ref={tabListRef}
            className="stagger flex gap-2 justify-center flex-wrap"
            style={{ "--stagger-index": 3 } as React.CSSProperties}
            role="tablist"
            aria-label="Pair results"
            onKeyDown={handleTabKeyDown}
          >
            {pairs.map(({ a, b }) => {
              const pk = pairKey(a, b);
              const isActive = visiblePair && pairKey(visiblePair.a, visiblePair.b) === pk;
              return (
                <button
                  key={pk}
                  type="button"
                  role="tab"
                  aria-selected={isActive ?? false}
                  aria-controls="pair-tabpanel"
                  id={`tab-${pk}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActivePairKey(pk)}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                    isActive
                      ? "bg-accent text-accent-fg shadow-sm shadow-accent/20"
                      : "bg-surface/80 text-text-muted hover:text-text hover:bg-surface"
                  }`}
                >
                  {displayName(a)} & {displayName(b)}
                </button>
              );
            })}
          </div>
        )}

        <div className="stagger" style={{ "--stagger-index": 4 } as React.CSSProperties}>
          {visiblePair &&
            (() => {
              // Single PairComparison instantiation — tabs/no-tabs branches
              // only differ in whether we wrap with a tabpanel role. Using
              // one source of truth for the element keeps props + key
              // symmetric and prevents asymmetric-key drift.
              const pair = (
                <PairComparison
                  key={`${visiblePair.a.id}-${visiblePair.b.id}`}
                  a={visiblePair.a}
                  b={visiblePair.b}
                  aDisplayName={displayName(visiblePair.a)}
                  bDisplayName={displayName(visiblePair.b)}
                  aIsViewer={visiblePair.a.id === viewerId}
                  showTiming={showTiming}
                  questions={questions}
                  categories={categories}
                  categoryOrder={categoryOrder}
                  questionOrder={questionOrder}
                  showHeading={!showTabs}
                />
              );
              return showTabs ? (
                <div
                  role="tabpanel"
                  id="pair-tabpanel"
                  aria-labelledby={`tab-${pairKey(visiblePair.a, visiblePair.b)}`}
                >
                  {pair}
                </div>
              ) : (
                pair
              );
            })()}
        </div>

        {onBack && (
          <div className="text-center pt-6">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-text-muted hover:text-accent transition-colors text-sm"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" role="presentation">
                <path
                  d="M11 3L13 5L5 13L2 14L3 11ZM9 5L11 7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Change my answers
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PairComparison({
  a,
  b,
  aDisplayName,
  bDisplayName,
  aIsViewer,
  showTiming,
  questions,
  categories,
  categoryOrder,
  questionOrder,
  showHeading = true,
}: PairComparisonProps) {
  const pairMatches = buildPairMatches(a.answers, b.answers, questions, {
    aName: aDisplayName,
    aIsViewer,
  });

  const groups = buildGroupedMatches(pairMatches, questions, categories, categoryOrder, questionOrder);

  // Headline: how many green-lights and total non-hidden matches. Gives the
  // user a one-glance sense of the page before they start reading. This is
  // the payoff moment of the app — announce it.
  const greenLightCount = pairMatches.filter((m) => m.matchType === "green-light").length;
  const totalMatches = pairMatches.length;

  return (
    <div className="space-y-8">
      {showHeading && (
        <h2 className="text-xl font-bold text-center">
          {aDisplayName} & {bDisplayName}
        </h2>
      )}

      {groups.length === 0 ? (
        <div className="py-16 text-center space-y-4">
          <p className="text-base text-text-muted italic">
            No overlaps this time — but that's part of the conversation too.
          </p>
        </div>
      ) : (
        <>
          {/* Summary strip — tabular-nums so the digits don't dance on resize.
              The `Go for it` column is hidden when timing mode is off,
              because the green-light tier requires both users to answer
              `now`, which is only collected in timing mode. Showing a
              permanent `0` in a non-timing group is just noise. */}
          <div
            className="flex items-baseline justify-center gap-6 py-4 px-6 bg-surface/50 rounded-[var(--radius-lg)] border border-border/40"
            data-testid="match-summary"
          >
            {showTiming && (
              <>
                <div className="text-center">
                  <div className="text-2xl font-bold text-accent tabular-nums" data-testid="green-light-count">
                    {greenLightCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">Go for it</div>
                </div>
                <div className="w-px h-10 bg-border/60" />
              </>
            )}
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums" data-testid="total-matches-count">
                {totalMatches}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">Total matches</div>
            </div>
          </div>

          {groups.map((group) => (
            <section key={group.categoryId} className="space-y-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">
                <span className="w-1 h-1 rounded-full bg-accent" />
                {group.label}
                <span className="flex-1 h-px bg-border/40 ml-1" />
                <span className="tabular-nums text-text-muted/60 normal-case tracking-normal text-[11px]">
                  {group.matches.length}
                </span>
              </h3>
              <div className="space-y-2">
                {group.matches.map((match) => {
                  const style = MATCH_STYLES[match.matchType];
                  return (
                    <div
                      key={`${match.questionId}-${match.displayText}`}
                      className={`px-4 py-3 rounded-[var(--radius-md)] transition-all ${style.container}`}
                      data-testid="match-row"
                      data-match-type={match.matchType}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`${style.labelStyle}`}>{match.displayText}</span>
                        <span
                          className={`text-[10px] uppercase tracking-wider font-semibold shrink-0 px-2 py-0.5 rounded-full ${style.badge}`}
                          data-testid="match-badge"
                        >
                          {style.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
