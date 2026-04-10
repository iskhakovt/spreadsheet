import type { Answer } from "@spreadsheet/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useMemo, useRef, useState } from "react";
import { buildPairMatches, type QuestionInfo } from "../lib/build-pair-matches.js";
import type { MatchType } from "../lib/classify-match.js";
import { unwrapSensitive } from "../lib/crypto.js";
import { replayJournal } from "../lib/journal.js";
import { type JournalEntry, mergeJournal } from "../lib/merge-journal.js";
import { useTRPC, useTRPCClient } from "../lib/trpc.js";

interface MemberAnswers {
  id: string;
  name: string;
  anatomy: string | null;
  answers: Record<string, Answer>;
}

/**
 * Shape stored in the TanStack cache for `sync.journal`.
 *
 * The queryFn decrypts + replays the raw server response into `members`
 * (with plaintext names + per-question answer state) so that Comparison
 * can render synchronously on first mount — no async useEffect cycle
 * between "data arrived" and "content visible", which was adding ~500ms
 * of latency on the critical render path under parallel E2E load.
 *
 * The raw `entries` are retained alongside the derived `members` so the
 * subscription can dedup incremental appends by `id` against the current
 * cache state before re-replaying.
 */
interface CachedJournal {
  members: MemberAnswers[];
  entries: JournalEntry[];
  cursor: number | null;
}

/** Decrypt + replay the raw journal response into MemberAnswers[]. */
async function replayMembers(
  members: { id: string; name: string; anatomy: string | null }[],
  entries: JournalEntry[],
): Promise<MemberAnswers[]> {
  return Promise.all(
    members.map(async (m) => {
      const memberEntries = entries.filter((e) => e.personId === m.id);
      return {
        id: m.id,
        name: await unwrapSensitive(m.name),
        anatomy: m.anatomy ? await unwrapSensitive(m.anatomy) : null,
        answers: await replayJournal(memberEntries),
      };
    }),
  );
}

const MATCH_STYLES: Record<MatchType, { bg: string; label: string }> = {
  "green-light": { bg: "bg-accent/15", label: "Go for it" },
  match: { bg: "bg-accent-light/15", label: "Match" },
  "both-maybe": { bg: "bg-surface", label: "Worth discussing" },
  possible: { bg: "bg-surface", label: "Possible" },
  fantasy: { bg: "bg-surface", label: "Shared fantasy" },
  hidden: { bg: "", label: "" },
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
export function Comparison({ onBack }: { onBack?: () => void }) {
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
  // Use the tRPC proxy's queryKey so cache lookups match, but write our own
  // queryFn that fetches via the vanilla client and decrypts + replays before
  // returning. The cache stores the derived shape (CachedJournal), so on the
  // first paint Comparison already has memberAnswers — no extra useEffect
  // cycle between "data arrived" and "content visible".
  const journalQueryKey = trpc.sync.journal.queryKey({ sinceId: null });
  const { data: journal } = useSuspenseQuery({
    queryKey: journalQueryKey,
    queryFn: async ({ signal }): Promise<CachedJournal> => {
      const raw = await trpcClient.sync.journal.query({ sinceId: null }, { signal });
      const members = await replayMembers(raw.members, raw.entries);
      return { members, entries: raw.entries, cursor: raw.cursor };
    },
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
            const current = queryClient.getQueryData<CachedJournal>(journalQueryKey);
            if (!current) return;
            // Dedup + append via the pure helper
            const mergedRaw = mergeJournal({ ...current }, entries);
            // Re-replay per member over the merged raw entries
            const members = await replayMembers(current.members, mergedRaw.entries);
            // Drop if a newer push already landed while we were replaying
            if (mySeq !== seqRef.current) return;
            queryClient.setQueryData(journalQueryKey, {
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

  const memberAnswers = journal.members;
  const [activePairKey, setActivePairKey] = useState<string | null>(null);

  // Build pairwise comparisons
  const pairs: { a: MemberAnswers; b: MemberAnswers }[] = [];
  for (let i = 0; i < memberAnswers.length; i++) {
    for (let j = i + 1; j < memberAnswers.length; j++) {
      pairs.push({ a: memberAnswers[i], b: memberAnswers[j] });
    }
  }

  const showTabs = pairs.length > 1;
  const pairKey = (a: MemberAnswers, b: MemberAnswers) => `${a.id}-${b.id}`;
  const visiblePair = pairs.find((p) => pairKey(p.a, p.b) === activePairKey) ?? pairs[0];

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center">Your results</h1>

        {showTabs && (
          <div className="flex gap-2 justify-center flex-wrap" role="tablist" aria-label="Pair results">
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
                  onClick={() => setActivePairKey(pk)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    isActive ? "bg-accent text-white" : "bg-surface text-text-muted hover:text-text"
                  }`}
                >
                  {a.name} & {b.name}
                </button>
              );
            })}
          </div>
        )}

        {visiblePair && showTabs && (
          <div role="tabpanel" id="pair-tabpanel" aria-labelledby={`tab-${pairKey(visiblePair.a, visiblePair.b)}`}>
            <PairComparison
              key={`${visiblePair.a.id}-${visiblePair.b.id}`}
              a={visiblePair.a}
              b={visiblePair.b}
              questions={questions}
              categories={categories}
              categoryOrder={categoryOrder}
              questionOrder={questionOrder}
              showHeading={false}
            />
          </div>
        )}
        {visiblePair && !showTabs && (
          <PairComparison
            a={visiblePair.a}
            b={visiblePair.b}
            questions={questions}
            categories={categories}
            categoryOrder={categoryOrder}
            questionOrder={questionOrder}
            showHeading
          />
        )}

        {onBack && (
          <div className="text-center pt-4">
            <button type="button" onClick={onBack} className="text-text-muted hover:text-text underline text-sm">
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
  questions,
  categories,
  categoryOrder,
  questionOrder,
  showHeading = true,
}: {
  a: MemberAnswers;
  b: MemberAnswers;
  questions: Record<string, QuestionInfo>;
  categories: Record<string, string>;
  categoryOrder: string[];
  questionOrder: Record<string, number>;
  showHeading?: boolean;
}) {
  const pairMatches = buildPairMatches(a.answers, b.answers, questions, a.name);

  // Group matches by category
  const grouped: Record<string, { label: string; matches: typeof pairMatches }> = {};
  for (const match of pairMatches) {
    const q = questions[match.questionId];
    if (!q) continue;
    const categoryId = q.categoryId;
    if (!grouped[categoryId]) {
      grouped[categoryId] = { label: categories[categoryId] ?? categoryId, matches: [] };
    }
    grouped[categoryId].matches.push(match);
  }

  // Sort categories and questions in the same order as the question flow
  const sortedCategories = categoryOrder.filter((id) => grouped[id]);

  return (
    <div className="space-y-6">
      {showHeading && (
        <h2 className="text-xl font-bold text-center">
          {a.name} & {b.name}
        </h2>
      )}

      {sortedCategories.length === 0 ? (
        <p className="text-center text-text-muted">No matches found — but that's OK.</p>
      ) : (
        sortedCategories.map((catId) => {
          const group = grouped[catId];
          return (
            <div key={catId}>
              <h3 className="text-sm font-medium text-text-muted mb-2">{group.label}</h3>
              <div className="space-y-2">
                {group.matches
                  .sort((x, y) => (questionOrder[x.questionId] ?? 0) - (questionOrder[y.questionId] ?? 0))
                  .map((match) => {
                    const style = MATCH_STYLES[match.matchType];
                    return (
                      <div
                        key={`${match.questionId}-${match.displayText}`}
                        className={`px-4 py-3 rounded-lg ${style.bg}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-medium ${match.matchType === "fantasy" ? "italic" : ""}`}>
                            {match.displayText}
                          </span>
                          <span className="text-sm text-text-muted shrink-0 ml-3">{style.label}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
