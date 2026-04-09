import type { Answer, CategoryData, OperationPayload, QuestionData, Rating, Timing } from "@spreadsheet/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { buildScreens, filterQuestionScreens } from "../lib/build-screens.js";
import { encodeValue } from "../lib/crypto.js";
import { mergeAfterRejection } from "../lib/journal.js";
import {
  addPendingOp,
  clearPendingOps,
  getAnswers,
  getPendingOps,
  getSelectedCategories,
  getSelectedTier,
  getStoken,
  setAnswer,
  setAnswers,
  setSelectedCategories,
  setStoken,
} from "../lib/storage.js";
import { UI } from "../lib/strings.js";
import { trpc } from "../lib/trpc.js";
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
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, CategoryData>>({});
  const [index, setIndex] = useState(0);
  const [showDescription, setShowDescription] = useState(false);
  const [showTiming, setShowTiming] = useState(false);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showSyncIndicator, setShowSyncIndicator] = useState(false);
  const syncingRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncIndicatorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSyncRef = useRef<() => Promise<void>>(undefined);
  const answers = getAnswers();
  const pendingOps = getPendingOps();

  // Load questions + auto-select categories + sync pending ops from previous session
  useEffect(() => {
    trpc.questions.list.query().then((data) => {
      setQuestions(data.questions as QuestionData[]);
      const map: Record<string, CategoryData> = {};
      for (const c of data.categories as CategoryData[]) map[c.id] = c;
      setCategoryMap(map);
      if (!getSelectedCategories()) {
        setSelectedCategories((data.categories as CategoryData[]).map((c) => c.id));
      }
      if (getPendingOps().length > 0) {
        setTimeout(() => handleSyncRef.current?.(), 500);
      }
    });
  }, []);

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
    return buildScreens(questions, selectedCategories, person.anatomy ?? "both", otherAnatomies, group.questionMode, categoryMap, maxTier);
  }, [questions, selectedCategories, person.anatomy, otherAnatomies, group.questionMode, categoryMap, maxTier]);

  const qScreens = useMemo(() => filterQuestionScreens(screens), [screens]);

  // Navigate to startKey or first unanswered
  useEffect(() => {
    if (screens.length > 0) {
      if (startKey) {
        const idx = screens.findIndex((s) => s.key === startKey);
        if (idx !== -1) setIndex(idx);
        onStartKeyConsumed?.();
      } else if (Object.keys(answers).length > 0) {
        const firstUnanswered = screens.findIndex((s) => s.type === "question" && !answers[s.key]);
        if (firstUnanswered !== -1) setIndex(firstUnanswered);
      }
    }
  }, [screens.length]);

  // Auto-sync 3s after last answer, show indicator after 5s
  useEffect(() => {
    clearTimeout(syncTimerRef.current);
    clearTimeout(syncIndicatorTimerRef.current);
    if (pendingOps.length === 0) {
      setShowSyncIndicator(false);
      return;
    }
    syncTimerRef.current = setTimeout(() => handleSyncRef.current?.(), 3000);
    syncIndicatorTimerRef.current = setTimeout(() => setShowSyncIndicator(true), 5000);
    return () => {
      clearTimeout(syncTimerRef.current);
      clearTimeout(syncIndicatorTimerRef.current);
    };
  });

  // --- Loading / empty states ---
  if (questions.length === 0) {
    return <Card><div className="pt-32 text-center text-text-muted">Loading questions...</div></Card>;
  }
  if (qScreens.length === 0) {
    return (
      <Card>
        <div className="pt-16 text-center space-y-4">
          <p className="text-text-muted">No questions for your selected categories.</p>
          <Button variant="ghost" onClick={onDone}>Go back</Button>
        </div>
      </Card>
    );
  }

  // --- All done ---
  const allAnswered = qScreens.every((s) => answers[s.key]);
  if (allAnswered && index >= screens.length) {
    return (
      <Card>
        <div className="pt-16 text-center space-y-6">
          <h1 className="text-2xl font-bold">All done!</h1>
          <p className="text-text-muted">{UI.review.answered(Object.keys(answers).length, qScreens.length)}</p>
          <Button fullWidth onClick={handleMarkComplete}>{UI.review.done}</Button>
        </div>
      </Card>
    );
  }

  // --- Sync logic ---
  async function pushOps(ops: string[], stoken: string | null) {
    const progress = await encodeValue({ answered: Object.keys(getAnswers()).length, total: qScreens.length });
    return trpc.sync.push.mutate({ stoken, operations: ops, progress });
  }

  async function handleConflict(ops: string[], serverStoken: string | null, serverEntries: string[]) {
    const merged = await mergeAfterRejection(getAnswers(), ops, serverEntries);
    setAnswers(merged);
    const retryProgress = await encodeValue({ answered: Object.keys(merged).length, total: qScreens.length });
    const retry = await trpc.sync.push.mutate({ stoken: serverStoken, operations: ops, progress: retryProgress });
    setStoken(retry.stoken);
    if (!retry.pushRejected) {
      clearPendingOps();
    } else {
      console.error("Sync retry also rejected — leaving ops pending for next manual sync.");
    }
  }

  async function handleSync() {
    const ops = getPendingOps();
    if (ops.length === 0 || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await pushOps(ops, getStoken());
      setStoken(result.stoken);
      if (!result.pushRejected) {
        clearPendingOps();
      } else {
        await handleConflict(ops, result.stoken, result.entries);
      }
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  }

  handleSyncRef.current = handleSync;

  async function handleMarkComplete() {
    await handleSync();
    await trpc.sync.markComplete.mutate();
    await onDone();
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

  async function saveAnswer(rating: Rating, timing: Timing | null) {
    const current = screens[Math.min(index, screens.length - 1)];
    if (current.type !== "question") return;
    const answer: Answer = { rating, timing };
    setAnswer(current.key, answer);
    const op = await encodeValue({ key: current.key, data: answer } satisfies OperationPayload);
    addPendingOp(op);
    setShowDescription(false);
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
      onBack={() => { setIndex((i) => Math.max(0, i - 1)); setShowTiming(false); setShowDescription(false); }}
      onSkip={() => { setIndex((i) => i + 1); setShowTiming(false); setShowDescription(false); }}
      onToggleDescription={() => setShowDescription((v) => !v)}
      onSync={handleSync}
      onSummary={onSummary}
    />
  );
}
