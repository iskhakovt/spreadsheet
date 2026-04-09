import type { Answer } from "@spreadsheet/shared";
import { useEffect, useState } from "react";
import { Card } from "../components/Card.js";
import { classifyMatch, type MatchType } from "../lib/classify-match.js";
import { unwrapSensitive } from "../lib/crypto.js";
import { replayJournal } from "../lib/journal.js";
import { trpc } from "../lib/trpc.js";

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

export function Comparison() {
  const [memberAnswers, setMemberAnswers] = useState<MemberAnswers[] | null>(null);
  const [questions, setQuestions] = useState<
    Record<string, { text: string; categoryId: string; giveText: string | null; receiveText: string | null }>
  >({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([trpc.sync.compare.query(), trpc.questions.list.query()])
      .then(async ([compareData, questionsData]) => {
        // Build question lookup
        const qMap: typeof questions = {};
        for (const q of questionsData.questions) {
          qMap[q.id] = { text: q.text, categoryId: q.categoryId, giveText: q.giveText, receiveText: q.receiveText };
        }
        setQuestions(qMap);

        const cMap: Record<string, string> = {};
        for (const c of questionsData.categories) {
          cMap[c.id] = c.label;
        }
        setCategories(cMap);

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

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center">Your results</h1>

        {pairs.map(({ a, b }) => (
          <PairComparison key={`${a.id}-${b.id}`} a={a} b={b} questions={questions} categories={categories} />
        ))}
      </div>
    </div>
  );
}

function PairComparison({
  a,
  b,
  questions,
  categories,
}: {
  a: MemberAnswers;
  b: MemberAnswers;
  questions: Record<string, { text: string; categoryId: string; giveText: string | null; receiveText: string | null }>;
  categories: Record<string, string>;
}) {
  // Collect all keys from both members
  const allKeys = new Set([...Object.keys(a.answers), ...Object.keys(b.answers)]);

  // Group matches by category
  const grouped: Record<
    string,
    {
      label: string;
      matches: { key: string; displayText: string; matchType: MatchType; aRating: Answer; bRating: Answer }[];
    }
  > = {};

  for (const key of allKeys) {
    const answerA = a.answers[key];
    const answerB = b.answers[key];
    if (!answerA || !answerB) continue;

    const [questionId, role] = key.split(":");
    const q = questions[questionId];
    if (!q) continue;

    const matchType = classifyMatch(answerA, answerB);
    if (matchType === "hidden") continue;

    const categoryId = q.categoryId;
    if (!grouped[categoryId]) {
      grouped[categoryId] = { label: categories[categoryId] ?? categoryId, matches: [] };
    }

    let displayText = q.text;
    if (role === "give" && q.giveText) displayText = `${q.text} (${a.name} giving)`;
    if (role === "receive" && q.receiveText) displayText = `${q.text} (${a.name} receiving)`;

    grouped[categoryId].matches.push({
      key,
      displayText,
      matchType,
      aRating: answerA,
      bRating: answerB,
    });
  }

  // Sort matches: green-light first, then match, then maybe, then possible, then fantasy
  const matchOrder: MatchType[] = ["green-light", "match", "both-maybe", "possible", "fantasy"];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-center">
        {a.name} & {b.name}
      </h2>

      {Object.entries(grouped).length === 0 ? (
        <p className="text-center text-text-muted">No matches found — but that's OK.</p>
      ) : (
        Object.entries(grouped).map(([catId, group]) => (
          <div key={catId}>
            <h3 className="text-sm font-medium text-text-muted mb-2">{group.label}</h3>
            <div className="space-y-2">
              {group.matches
                .sort((x, y) => matchOrder.indexOf(x.matchType) - matchOrder.indexOf(y.matchType))
                .map((match) => {
                  const style = MATCH_STYLES[match.matchType];
                  return (
                    <div key={match.key} className={`px-4 py-3 rounded-lg ${style.bg}`}>
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
        ))
      )}
    </div>
  );
}
