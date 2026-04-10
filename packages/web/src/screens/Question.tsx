import type { Answer, CategoryData, OperationPayload, QuestionData, Rating, Timing } from "@spreadsheet/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { buildScreens, filterQuestionScreens } from "../lib/build-screens.js";
import { encodeValue } from "../lib/crypto.js";
import {
  addPendingOp,
  getAnswers,
  getCurrentScreenKey,
  getPendingOps,
  getSelectedCategories,
  getSelectedTier,
  setAnswer,
  setCurrentScreenKey,
  setSelectedCategories,
} from "../lib/storage.js";
import { UI } from "../lib/strings.js";
import { useTRPC } from "../lib/trpc.js";
import { useSyncQueue } from "../lib/use-sync-queue.js";
import { QuestionCard } from "./QuestionCard.js";
import { WelcomeScreen } from "./WelcomeScreen.js";

interface QuestionProps {
  person: { id: string; anatomy: string | null };
  group: { questionMode: string; showTiming: boolean };
  members: { id: string; anatomy: string | null }[];
  onDone: () => void | Promise<void>;
  onSummary?: () => void;
  startKey?: string;
  onStartKeyConsumed?: () => void;
}

export function Question({ person, group, members, onDone, onSummary, startKey, onStartKeyConsumed }: QuestionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: questionsData } = useSuspenseQuery(trpc.questions.list.queryOptions());
  const questions = questionsData.questions as QuestionData[];
  const categoryMap = useMemo(() => {
    const map: Record<string, CategoryData> = {};
    for (const c of questionsData.categories as CategoryData[]) map[c.id] = c;
    return map;
  }, [questionsData.categories]);

  const [index, setIndex] = useState(0);
  const [showDescription, setShowDescription] = useState(false);
  const [showTiming, setShowTiming] = useState(false);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeading = useRef(false);
  const answers = getAnswers();
  const pendingOps = getPendingOps();

  const markCompleteMutation = useMutation(
    trpc.sync.markComplete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );

  const selectedCategories = getSelectedCategories() ?? [];
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
      console.error("Question screen reached with null anatomy in filtered mode");
    }
    return buildScreens(
      questions,
      selectedCategories,
      person.anatomy ?? "both",
      otherAnatomies,
      group.questionMode,
      categoryMap,
      maxTier,
    );
  }, [questions, selectedCategories, person.anatomy, otherAnatomies, group.questionMode, categoryMap, maxTier]);

  const qScreens = useMemo(() => filterQuestionScreens(screens), [screens]);

  // Debounced sync queue — owns the 3s timer, conflict retry, and sync indicator
  const { syncing, showSyncIndicator, handleSync, scheduleSync } = useSyncQueue(qScreens.length);

  // Auto-select all categories on first mount if the user hasn't chosen any.
  // Also flush any leftover pendingOps from a previous session after a short
  // delay so the sync machinery is ready.
  useEffect(() => {
    if (!getSelectedCategories()) {
      setSelectedCategories((questionsData.categories as CategoryData[]).map((c) => c.id));
    }
    if (getPendingOps().length > 0) {
      setTimeout(handleSync, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Keyboard navigation: arrows + number keys for ratings. The handlers
  // themselves are defined later in the function (they close over state
  // that changes per render), so we keep stable refs and update them on
  // every render to avoid tearing down the listener.
  const handleRatingRef = useRef<(rating: Rating) => void>(undefined);
  const handleTimingRef = useRef<(timing: Timing) => void>(undefined);
  const keyRatingMap: Record<string, Rating> = {
    "1": "yes",
    "2": "if-partner-wants",
    "3": "maybe",
    "4": "fantasy",
    "5": "no",
  };
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
        setShowTiming(false);
        setShowDescription(false);
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(screens.length, i + 1));
        setShowTiming(false);
        setShowDescription(false);
      } else if (showTiming && (e.key === "1" || e.key === "n")) {
        handleTimingRef.current?.("now");
      } else if (showTiming && (e.key === "2" || e.key === "l")) {
        handleTimingRef.current?.("later");
      } else if (!showTiming && keyRatingMap[e.key]) {
        handleRatingRef.current?.(keyRatingMap[e.key]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screens.length, showTiming]);

  // Auto-sync scheduled whenever the pending-ops count changes. The hook
  // owns the 3s debounce timer + the 5s indicator delay internally.
  useEffect(() => {
    scheduleSync(pendingOps.length);
  });

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
            <Button fullWidth onClick={handleMarkComplete}>
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
              <Button variant="ghost" fullWidth onClick={handleMarkComplete}>
                {UI.review.done}
              </Button>
            </>
          )}
        </div>
      </Card>
    );
  }

  // --- Mark complete: flush pending writes, mark, then navigate to /waiting ---
  // Explicit navigation is needed because /questions is in the free routes
  // list (so the guard doesn't kick marked-complete users out of editing),
  // which means it also won't auto-redirect from /questions to /waiting.
  async function handleMarkComplete() {
    await handleSync();
    await markCompleteMutation.mutateAsync();
    await onDone();
    navigate("/waiting");
  }

  // --- Answer handlers ---
  function handleRating(rating: Rating) {
    if (group.showTiming && (rating === "yes" || rating === "if-partner-wants")) {
      setPendingRating(rating);
      setShowTiming(true);
    } else {
      saveAnswer(rating, null);
    }
  }

  function handleTiming(timing: Timing) {
    if (pendingRating) saveAnswer(pendingRating, timing);
    setShowTiming(false);
    setPendingRating(null);
  }

  // Update the stable refs that the keyboard effect reads, so keystrokes
  // always dispatch against the latest closure (index, pendingRating, etc.)
  handleRatingRef.current = handleRating;
  handleTimingRef.current = handleTiming;

  async function saveAnswer(rating: Rating, timing: Timing | null) {
    const current = screens[Math.min(index, screens.length - 1)];
    if (current.type !== "question") return;
    const answer: Answer = { rating, timing };
    setAnswer(current.key, answer);
    const op = await encodeValue({ key: current.key, data: answer } satisfies OperationPayload);
    addPendingOp(op);
    setShowDescription(false);
    shouldFocusHeading.current = true;
    setIndex((i) => i + 1);
  }

  // --- Render current screen ---
  const current = screens[Math.min(index, screens.length - 1)];

  if (current.type === "welcome") {
    return (
      <WelcomeScreen
        screen={current}
        categoryMap={categoryMap}
        screens={screens}
        index={index}
        setIndex={setIndex}
        headingRef={headingRef}
        syncing={syncing}
        showSyncIndicator={showSyncIndicator}
        pendingCount={pendingOps.length}
        onSync={handleSync}
        onSummary={onSummary}
      />
    );
  }

  return (
    <QuestionCard
      screen={current}
      categoryMap={categoryMap}
      allQuestionScreens={qScreens}
      existingAnswer={answers[current.key]}
      index={index}
      totalAnswered={Object.keys(answers).length}
      totalQuestions={qScreens.length}
      showTiming={showTiming}
      showDescription={showDescription}
      syncing={syncing}
      showSyncIndicator={showSyncIndicator}
      pendingCount={pendingOps.length}
      onRating={handleRating}
      onTiming={handleTiming}
      onBack={() => {
        setIndex((i) => Math.max(0, i - 1));
        setShowTiming(false);
        setShowDescription(false);
      }}
      onSkip={() => {
        setIndex((i) => i + 1);
        setShowTiming(false);
        setShowDescription(false);
      }}
      onToggleDescription={() => setShowDescription((v) => !v)}
      onSync={handleSync}
      onSummary={onSummary}
      headingRef={headingRef}
    />
  );
}
