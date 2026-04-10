import type { Answer } from "@spreadsheet/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card.js";
import { buildPairMatches, type QuestionInfo } from "../lib/build-pair-matches.js";
import type { MatchType } from "../lib/classify-match.js";
import { unwrapSensitive } from "../lib/crypto.js";
import { replayJournal } from "../lib/journal.js";
import { trpc, useTRPC } from "../lib/trpc.js";

interface MemberAnswers {
  id: string;
  name: string;
  anatomy: string | null;
  answers: Record<string, Answer>;
}

const MATCH_STYLES: Record<MatchType, { bg: string; label: string }> = {
  "green-light": { bg: "bg-accent/15", label: "Go for it" },
  match: { bg: "bg-accent-light/15", label: "Match" },
  "both-maybe": { bg: "bg-surface", label: "Worth discussing" },
  possible: { bg: "bg-surface", label: "Possible" },
  fantasy: { bg: "bg-surface", label: "Shared fantasy" },
  hidden: { bg: "", label: "" },
};

export function Comparison({ onBack }: { onBack?: () => void }) {
  const trpcProxy = useTRPC();
  // Questions list is cached globally with staleTime: Infinity — if PersonApp
  // has already loaded it, this returns from cache synchronously without a
  // refetch. First mount dedupes if Question.tsx hasn't triggered the load yet.
  const { data: questionsData } = useSuspenseQuery(trpcProxy.questions.list.queryOptions());

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

  const [memberAnswers, setMemberAnswers] = useState<MemberAnswers[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePairKey, setActivePairKey] = useState<string | null>(null);

  useEffect(() => {
    trpc.sync.journal
      .query({ sinceId: null })
      .then(async (compareData) => {
        // Replay each member's journal
        const members: MemberAnswers[] = await Promise.all(
          compareData.members.map(async (m) => {
            const memberEntries = compareData.entries.filter((e) => e.personId === m.id);
            return {
              id: m.id,
              name: await unwrapSensitive(m.name as string),
              anatomy: m.anatomy ? await unwrapSensitive(m.anatomy) : null,
              answers: await replayJournal(memberEntries),
            };
          }),
        );
        setMemberAnswers(members);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load comparison");
      });
  }, []);

  if (error) {
    return (
      <Card>
        <div className="pt-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Can't compare yet</h1>
          <p className="text-text-muted">{error}</p>
        </div>
      </Card>
    );
  }

  if (!memberAnswers) {
    return (
      <Card>
        <div className="pt-32 text-center text-text-muted">Loading results...</div>
      </Card>
    );
  }

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
