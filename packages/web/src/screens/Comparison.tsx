import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { Pencil } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CopyMyLink } from "../components/copy-my-link.js";
import { SourceLink } from "../components/source-link.js";
import { TipJarLink } from "../components/tip-jar-link.js";
import { buildGroupedMatches, buildPairMatches, type QuestionInfo } from "../lib/build-pair-matches.js";
import type { MatchType } from "../lib/classify-match.js";
import { cn } from "../lib/cn.js";
import {
  type CachedJournal,
  JOURNAL_QUERY_KEY,
  type MemberAnswers,
  makeJournalQueryFn,
  rebuildMemberAnswers,
} from "../lib/journal-query.js";
import { buildPairs, nextTabIndex, sortMembersViewerFirst, viewerDisplayName } from "../lib/member-display.js";
import { mergeJournal } from "../lib/merge-journal.js";
import { useScrollReset } from "../lib/route-reset.js";
import { useTRPC, useTRPCClient } from "../lib/trpc.js";

/**
 * Visual treatment per match type. "Go for it" is the celebratory tier:
 * warm gradient, bright label. Everything steps down in temperature so
 * the eye sorts the page at a glance.
 */
interface MatchStyle {
  container: string;
  badge: string;
  label: string;
  labelStyle: string;
}

interface ComparisonProps {
  viewerId: string;
  encrypted: boolean;
  token: string;
  onBack?: () => void;
}

interface PairComparisonProps {
  a: MemberAnswers;
  b: MemberAnswers;
  aDisplayName: string;
  bDisplayName: string;
  aIsViewer: boolean;
  bIsViewer: boolean;
  questions: Record<string, QuestionInfo>;
  categories: Record<string, string>;
  categoryOrder: string[];
  questionOrder: Record<string, number>;
  showHeading?: boolean;
}

/**
 * Per-match-type top-border for the notes block. Color-mixed with the
 * row's container tint so the divider sits inside the mood of the row
 * (peach hairline on accent rows, muted on neutrals, dashed on fantasy).
 */
function noteDividerClass(type: MatchType): string {
  switch (type) {
    case "match":
      return "border-accent/15";
    case "fantasy":
      return "border-dashed border-border/60";
    default:
      return "border-text-muted/15";
  }
}

/** One note line — attribution column on the left, italic body on the right. */
function NoteLine({ who, isViewer, text }: Readonly<{ who: string; isViewer: boolean; text: string }>) {
  const label = isViewer ? "You" : who;
  return (
    <p className="text-[13px] leading-[1.55] text-text/75 italic flex gap-2.5 items-baseline">
      <span
        className={cn(
          "shrink-0 not-italic font-medium text-[12px] min-w-[3rem] text-right",
          isViewer ? "text-accent-dark" : "text-text/75",
        )}
      >
        {label}
      </span>
      <span className="text-pretty">{text}</span>
    </p>
  );
}

const MATCH_STYLES: Record<MatchType, MatchStyle> = {
  match: {
    container: [
      "bg-gradient-to-br from-accent/15 via-accent-light/10 to-accent/[0.06]",
      "border border-accent/20",
      "shadow-accent-glow",
    ].join(" "),
    badge: "bg-gradient-to-b from-accent to-accent-dark text-accent-fg shadow-accent-md",
    label: "Match",
    labelStyle: "font-semibold",
  },
  "both-maybe": {
    container: "bg-surface/70 border border-border/40",
    badge: "bg-neutral/12 text-text-muted",
    label: "Worth discussing",
    labelStyle: "font-medium",
  },
  possible: {
    container: "bg-surface/50 border border-border/30",
    badge: "bg-neutral/8 text-text-muted/80",
    label: "Possible",
    labelStyle: "font-medium",
  },
  fantasy: {
    container: "bg-surface/40 border border-dashed border-border/50",
    badge: "bg-neutral/8 text-text-muted/80",
    label: "Shared fantasy",
    labelStyle: "font-medium italic",
  },
  hidden: { container: "", badge: "", label: "", labelStyle: "" },
};

/**
 * Compares answers between pairs of group members on /results.
 *
 * Data flow:
 * 1. `useSuspenseQuery(trpc.sync.journal)` fetches the initial backfill
 *    via HTTP and suspends until it lands.
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
export function Comparison({ viewerId, encrypted, token, onBack }: Readonly<ComparisonProps>) {
  // React Compiler reports a false-positive "Cannot access refs during render"
  // — `seqRef.current` is only touched inside the async `onData` callback. The
  // compiler can't prove the callback isn't synchronous, so it falls back to
  // the unmemoized form for THIS function. `PairComparison` and `NoteLine` in
  // the same file still compile normally. See facebook/react#35982.
  "use no memo";
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const queryClient = useQueryClient();

  // Questions list — cached session-wide, feeds the category/question lookup tables.
  const { data: questionsData } = useSuspenseQuery(trpc.questions.list.queryOptions());

  const questions = useMemo<Record<string, QuestionInfo>>(
    () =>
      Object.fromEntries(
        questionsData.questions.map((q) => [
          q.id,
          { text: q.text, categoryId: q.categoryId, giveText: q.giveText, receiveText: q.receiveText },
        ]),
      ),
    [questionsData.questions],
  );

  const categories = useMemo<Record<string, string>>(
    () => Object.fromEntries(questionsData.categories.map((c) => [c.id, c.label])),
    [questionsData.categories],
  );

  const categoryOrder = useMemo(() => questionsData.categories.map((c) => c.id), [questionsData.categories]);

  const questionOrder = useMemo<Record<string, number>>(
    () => Object.fromEntries(questionsData.questions.map((q, i) => [q.id, i])),
    [questionsData.questions],
  );

  const { data: journal } = useSuspenseQuery({
    queryKey: JOURNAL_QUERY_KEY,
    queryFn: makeJournalQueryFn(trpcClient),
  });

  const [initialLastEventId] = useState<string | undefined>(() => {
    const last = journal.entries[journal.entries.length - 1];
    return last ? String(last.id) : undefined;
  });

  const seqRef = useRef(0);

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
            const mergedRaw = mergeJournal({ ...current }, entries);
            const members = await rebuildMemberAnswers(current.members, mergedRaw.entries);
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

  const [activePairKey, setActivePairKey] = useState<string>();

  const pairs = useMemo(() => buildPairs(memberAnswers), [memberAnswers]);

  const showTabs = pairs.length > 1;
  const pairKey = (a: MemberAnswers, b: MemberAnswers) => `${a.id}-${b.id}`;
  const visiblePair = pairs.find((p) => pairKey(p.a, p.b) === activePairKey) ?? pairs[0];
  const displayName = (member: MemberAnswers) => viewerDisplayName(member, viewerId);

  const tabListRef = useRef<HTMLDivElement>(null);
  const activeIndex = visiblePair
    ? pairs.findIndex((p) => pairKey(p.a, p.b) === pairKey(visiblePair.a, visiblePair.b))
    : 0;
  // Scroll on pair switches only — activeIndex stays 0 on the undefined→firstKey
  // transition (user clicks the tab that's already shown), so no spurious scroll.
  useScrollReset(activeIndex);

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(e.key, activeIndex, pairs.length);
    if (next === null) return;
    e.preventDefault();
    const nextPair = pairs[next];
    setActivePairKey(pairKey(nextPair.a, nextPair.b));
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  return (
    <div className="relative min-h-dvh px-4 py-10 sm:py-14 overflow-hidden">
      {/* Atmospheric backdrop — softer than Landing, marking /results
          as a destination. */}
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

      <div className="max-w-2xl mx-auto space-y-10">
        <header className="text-center space-y-3">
          <p
            className="stagger text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/70"
            style={{ "--stagger-index": 0 } as React.CSSProperties}
          >
            Everyone's done
          </p>
          <h1
            className="stagger text-[2.75rem] sm:text-[3.25rem] font-bold leading-[0.92] tracking-[-0.03em]"
            style={{ "--stagger-index": 1 } as React.CSSProperties}
          >
            Your matches
          </h1>
          <div
            className="stagger inline-flex items-center gap-4 pt-1"
            style={{ "--stagger-index": 2 } as React.CSSProperties}
          >
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-accent/25" />
            <p className="text-sm text-text-muted italic">
              {memberAnswers.length > 2
                ? `${memberAnswers.length} people, one shared space`
                : "Two people, one shared space"}
            </p>
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-accent/25" />
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
                  className={cn(
                    "px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-gradient-to-b from-accent to-accent-dark text-accent-fg shadow-accent-md"
                      : "bg-surface/70 text-text-muted hover:text-text hover:bg-surface",
                  )}
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
              const pair = (
                <PairComparison
                  key={`${visiblePair.a.id}-${visiblePair.b.id}`}
                  a={visiblePair.a}
                  b={visiblePair.b}
                  aDisplayName={displayName(visiblePair.a)}
                  bDisplayName={displayName(visiblePair.b)}
                  aIsViewer={visiblePair.a.id === viewerId}
                  bIsViewer={visiblePair.b.id === viewerId}
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
              className="inline-flex items-center gap-1.5 text-text-muted/70 hover:text-accent transition-colors duration-200 text-sm"
            >
              <Pencil size={14} strokeWidth={1.5} />
              Change my answers
            </button>
          </div>
        )}

        <CopyMyLink encrypted={encrypted} token={token} />

        <div className="text-center pt-2 inline-flex items-center justify-center gap-4 w-full">
          <SourceLink placement="results" />
          <TipJarLink placement="results" />
        </div>
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
  bIsViewer,
  questions,
  categories,
  categoryOrder,
  questionOrder,
  showHeading = true,
}: Readonly<PairComparisonProps>) {
  const pairMatches = buildPairMatches(a.answers, b.answers, questions, {
    aName: aDisplayName,
    aIsViewer,
  });

  const groups = buildGroupedMatches(pairMatches, questions, categories, categoryOrder, questionOrder);

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
          {/* Summary strip */}
          <div
            className="flex items-baseline justify-center gap-6 py-5 px-6 bg-surface/40 rounded-[var(--radius-lg)] border border-border/30 shadow-warm-sm"
            data-testid="match-summary"
          >
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums" data-testid="total-matches-count">
                {totalMatches}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-text-muted/70 mt-0.5">Total matches</div>
            </div>
          </div>

          {groups.map((group) => (
            <section key={group.categoryId} className="space-y-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted/80">
                <span className="w-1 h-1 rounded-full bg-accent" />
                {group.label}
                <span className="flex-1 h-px bg-border/30 ml-1" />
                <span className="tabular-nums text-text-muted/50 normal-case tracking-normal text-[11px]">
                  {group.matches.length}
                </span>
              </h3>
              <div className="space-y-2">
                {group.matches.map((match) => {
                  const style = MATCH_STYLES[match.matchType];
                  // `replayJournal` and the storage layer normalize `note` to
                  // null when missing, but use a truthiness check anyway so
                  // legacy in-flight data never opens an empty notes block.
                  const noteA = match.answerA.note;
                  const noteB = match.answerB.note;
                  const showNotes = !!noteA || !!noteB;
                  return (
                    <div
                      key={`${match.questionId}-${match.displayText}`}
                      className={cn(
                        "px-4 py-3 rounded-[var(--radius-md)] transition-all duration-200",
                        style.container,
                      )}
                      data-testid="match-row"
                      data-match-type={match.matchType}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn(style.labelStyle)}>{match.displayText}</span>
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-[0.08em] font-semibold shrink-0 px-2.5 py-0.5 rounded-full",
                            style.badge,
                          )}
                          data-testid="match-badge"
                        >
                          {style.label}
                        </span>
                      </div>
                      {showNotes && (
                        <div
                          className={cn("mt-2.5 pt-2.5 space-y-1.5", "border-t", noteDividerClass(match.matchType))}
                          data-testid="match-notes"
                        >
                          {noteA && <NoteLine who={aDisplayName} isViewer={aIsViewer} text={noteA} />}
                          {noteB && <NoteLine who={bDisplayName} isViewer={bIsViewer} text={noteB} />}
                        </div>
                      )}
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
