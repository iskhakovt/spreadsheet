import type { Answer, CategoryData, OperationPayload, QuestionData } from "@spreadsheet/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { buildCategoryAnswerStats, buildScreens, filterQuestionScreens } from "../lib/build-screens.js";
import { encodeValue } from "../lib/crypto.js";
import { usePersonApp } from "../lib/person-app-context.js";
import { useScrollReset } from "../lib/route-reset.js";
import {
  addPendingOpForKey,
  getCurrentScreenKey,
  getPendingOps,
  getSelectedCategories,
  getSelectedTier,
  setAnswer,
  setCurrentScreenKey,
  setSelectedCategories,
  useAnswers,
  usePendingOps,
} from "../lib/storage.js";
import { UI } from "../lib/strings.js";

import { useTRPC } from "../lib/trpc.js";
import { useMarkComplete } from "../lib/use-mark-complete.js";
import { useSyncQueue } from "../lib/use-sync-queue.js";
import { CategoryWelcomeScreen } from "./CategoryWelcomeScreen.js";
import { isEditableTarget, QuestionCard } from "./QuestionCard.js";

interface QuestionProps {
  person: { id: string; anatomy: string | null };
  group: { questionMode: string; showTiming: boolean };
  members: { id: string; anatomy: string | null }[];
  onDone: () => void | Promise<void>;
  onSummary?: () => void;
  startKey?: string;
  onStartKeyConsumed?: () => void;
}

export function Question({
  person,
  group,
  members,
  onDone,
  onSummary,
  startKey,
  onStartKeyConsumed,
}: Readonly<QuestionProps>) {
  const trpc = useTRPC();
  const { data: questionsData } = useSuspenseQuery(trpc.questions.list.queryOptions());
  const questions = questionsData.questions as QuestionData[];
  const categoryMap = useMemo(
    () => Object.fromEntries((questionsData.categories as CategoryData[]).map((c) => [c.id, c])),
    [questionsData.categories],
  );

  const [index, setIndex] = useState(0);
  useScrollReset(index);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  const answers = useAnswers();
  const pendingOps = usePendingOps();

  // Mark-complete is the unified hook — it always flushes pending ops
  // before calling sync.markComplete and then navigates to /waiting.
  // Do not roll your own; see lib/use-mark-complete.ts.
  const { token } = usePersonApp();
  const markComplete = useMarkComplete(token);

  // Selected categories are React state (not a plain localStorage read) so
  // the first-mount default propagates through a re-render. Prior pattern
  // read localStorage each render + wrote defaults in an effect — but
  // effects don't trigger re-renders by themselves, so a fresh user with
  // no stored categories would see an empty "No questions for your selected
  // categories" screen until something else re-rendered the component.
  //
  // Storage contract:
  //   null  → first-time user, default to all categories (and persist)
  //   []    → user explicitly unchecked everything via Summary; respect it
  //            (the empty-state Card below is the intended outcome)
  //   [...] → use the stored list as-is
  //
  // The lazy initializer both returns the value for the first render AND
  // persists the default to localStorage so the scoped storage contract
  // (cross-tab, survives reload) is unchanged.
  const [selectedCategories] = useState<string[]>(() => {
    const stored = getSelectedCategories();
    if (stored !== null) return stored;
    const all = (questionsData.categories as CategoryData[]).map((c) => c.id);
    setSelectedCategories(all);
    return all;
  });
  const maxTier = getSelectedTier();
  const otherAnatomies = useMemo(
    () =>
      members
        .filter((m) => m.id !== person.id)
        .map((m) => m.anatomy)
        .filter((a): a is string => a !== null),
    [members, person.id],
  );

  const screens = useMemo(() => {
    if (person.anatomy === null && group.questionMode === "filtered") {
      // Invariant: filtered mode requires the person to have picked their
      // anatomy first; the route guard at /p/$token sends users to the
      // anatomy picker before /questions. Throwing here surfaces the bug
      // instead of silently rendering the wrong question set.
      throw new Error("Question screen reached with null anatomy in filtered mode");
    }
    return buildScreens(
      questions,
      selectedCategories,
      person.anatomy ?? "both",
      otherAnatomies,
      group.questionMode,
      categoryMap,
      answers,
      maxTier,
    );
  }, [
    questions,
    selectedCategories,
    person.anatomy,
    otherAnatomies,
    group.questionMode,
    categoryMap,
    answers,
    maxTier,
  ]);

  const qScreens = useMemo(() => filterQuestionScreens(screens), [screens]);

  const categoryAnswerStats = useMemo(() => buildCategoryAnswerStats(screens, answers), [screens, answers]);

  // Debounced sync queue — owns the 3s timer, conflict retry, and sync indicator
  const { syncing, showSyncIndicator, handleSync, scheduleSync } = useSyncQueue(qScreens.length);

  // Flush any leftover pendingOps from a previous session after a short
  // delay so the sync machinery is ready. (Category default-selection is
  // handled by the useState initializer above.)
  useEffect(() => {
    if (getPendingOps().length > 0) {
      setTimeout(handleSync, 500);
    }
  }, []);

  // Navigate to startKey, saved position, or first unanswered
  useEffect(() => {
    if (screens.length > 0) {
      if (startKey) {
        const idx = screens.findIndex((s) => s.key === startKey);
        if (idx !== -1) setIndex(idx);
        onStartKeyConsumed?.();
      } else {
        const saved = getCurrentScreenKey();
        const savedIdx = saved ? screens.findIndex((s) => s.key === saved) : -1;
        if (savedIdx !== -1) {
          setIndex(savedIdx);
        } else if (Object.keys(answers).length > 0) {
          const firstUnanswered = screens.findIndex((s) => s.type === "question" && !answers[s.key]);
          if (firstUnanswered !== -1) setIndex(firstUnanswered);
        }
      }
    }
  }, [screens.length]);

  // Persist current screen key so position survives unmount (e.g. summary detour)
  useEffect(() => {
    const current = screens[Math.min(index, screens.length - 1)];
    if (current) setCurrentScreenKey(current.key);
  }, [index, screens]);

  // Focus heading on click/tap transitions (not keyboard — aria-live handles that)
  useEffect(() => {
    if (shouldFocusHeading.current) {
      headingRef.current?.focus();
      shouldFocusHeading.current = false;
    }
  }, [index]);

  // Page-level keyboard navigation — Arrow left/right only. Rating number
  // keys (1-5) and timing keys (1/n, 2/l) are owned by the RatingGroup and
  // TimingButtons components in QuestionCard, scoped to their mount.
  //
  // `e.defaultPrevented` check lets child handlers claim the event first:
  // RatingGroup's roving-tabindex onKeyDown calls `preventDefault()` on
  // ArrowLeft/Right to move radio focus between options; we must not ALSO
  // navigate between questions in that case. React's synthetic event runs
  // on the root container before bubbling reaches window, so by the time
  // this listener fires `defaultPrevented` reflects child-level intent.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      // Skip when the user is typing in the note textarea — Arrow keys
      // are for cursor movement there, not page navigation.
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(screens.length, i + 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screens.length]);

  // Auto-sync scheduled whenever the pending-ops count changes. The hook
  // owns the 3s debounce timer + the 5s indicator delay internally.
  //
  // Dep is `pendingOps.length` specifically (not just `pendingOps`, which
  // is a fresh localStorage read per render). Without a dep the effect
  // would re-run on every render, which could defer the debounce
  // indefinitely if an unrelated parent re-renders us more often than 3s.
  //
  // The prev-count ref deduplicates consecutive calls with the same
  // value, which saves us from re-scheduling when React re-runs the
  // effect for reasons unrelated to pendingOps (StrictMode double-mount,
  // sibling state changes forcing a re-render with the same count).
  const lastScheduledCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastScheduledCountRef.current === pendingOps.length) return;
    lastScheduledCountRef.current = pendingOps.length;
    scheduleSync(pendingOps.length);
  }, [pendingOps.length, scheduleSync]);

  // --- Empty state (no matching questions for selected categories) ---
  if (qScreens.length === 0) {
    return (
      <Card>
        <div className="pt-16 text-center space-y-4">
          <p className="text-text-muted">No questions for your selected categories.</p>
          <Button variant="ghost" onClick={onDone}>
            Go back
          </Button>
        </div>
      </Card>
    );
  }

  // --- End of screens ---
  const allAnswered = qScreens.every((s) => answers[s.key]);
  if (index >= screens.length) {
    const answeredCount = Object.keys(answers).length;
    return (
      <Card>
        <div className="pt-16 text-center space-y-6">
          <h1 className="text-2xl font-bold">{allAnswered ? "All done!" : "That's the last one"}</h1>
          <p className="text-text-muted">{UI.review.answered(answeredCount, qScreens.length)}</p>
          {allAnswered ? (
            <Button fullWidth onClick={markComplete}>
              {UI.review.done}
            </Button>
          ) : (
            <>
              <Button
                fullWidth
                onClick={() => {
                  const first = screens.findIndex((s) => s.type === "question" && !answers[s.key]);
                  setIndex(first !== -1 ? first : 0);
                }}
              >
                Answer remaining questions
              </Button>
              <Button variant="ghost" fullWidth onClick={markComplete}>
                {UI.review.done}
              </Button>
            </>
          )}
        </div>
      </Card>
    );
  }

  // QuestionCard owns the rating/timing/note interaction; Question.tsx just
  // persists and advances. Splitting commit from advance lets QuestionCard
  // suppress auto-advance when the note section is open (Layout B).
  async function commitAnswer(answer: Answer) {
    const current = screens[Math.min(index, screens.length - 1)];
    if (current.type !== "question") return;
    setAnswer(current.key, answer);
    const op = await encodeValue({ key: current.key, data: answer } satisfies OperationPayload);
    addPendingOpForKey(op, current.key);
  }

  function advance() {
    shouldFocusHeading.current = true;
    setIndex((i) => i + 1);
  }

  // --- Render current screen ---
  const current = screens[Math.min(index, screens.length - 1)];

  if (current.type === "welcome") {
    const stats = categoryAnswerStats.get(current.categoryId);
    const hasAnswersInCategory = stats?.hasAnswers ?? false;
    const firstUnansweredInCategoryIdx = stats?.firstUnansweredIdx ?? -1;
    return (
      <CategoryWelcomeScreen
        screen={current}
        categoryMap={categoryMap}
        screens={screens}
        index={index}
        setIndex={setIndex}
        headingRef={headingRef}
        syncing={syncing}
        showSyncIndicator={showSyncIndicator}
        pendingCount={pendingOps.length}
        hasAnswersInCategory={hasAnswersInCategory}
        firstUnansweredInCategoryIdx={firstUnansweredInCategoryIdx}
        onSync={handleSync}
        onSummary={onSummary}
      />
    );
  }

  return (
    <QuestionCard
      // Force remount per screen so per-question component state (note draft,
      // pill expansion, pending timing) starts fresh — sidesteps the brief
      // post-advance render where a useEffect-based reset would still see
      // the previous screen's draft.
      key={current.key}
      screen={current}
      categoryMap={categoryMap}
      allQuestionScreens={qScreens}
      existingAnswer={answers[current.key]}
      index={index}
      totalAnswered={Object.keys(answers).length}
      totalQuestions={qScreens.length}
      showTimingFlow={group.showTiming}
      syncing={syncing}
      showSyncIndicator={showSyncIndicator}
      pendingCount={pendingOps.length}
      onCommit={commitAnswer}
      onAdvance={advance}
      onBack={() => setIndex((i) => Math.max(0, i - 1))}
      onSync={handleSync}
      onSummary={onSummary}
      headingRef={headingRef}
    />
  );
}
