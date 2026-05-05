/** @vitest-environment happy-dom */
import type { Answer, CategoryData, QuestionData } from "@spreadsheet/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionScreen } from "../lib/build-screens.js";
import { QuestionCard, RatingGroup } from "./QuestionCard.js";

// Must stay in sync with the COMMIT_ANIMATION_NAME constant in QuestionCard.tsx.
// If that name ever changes, these tests break loudly (good).
const COMMIT_ANIMATION_NAME = "commit-alpha";

function queryButton(name: string | RegExp) {
  return screen.getByRole("radio", { name });
}

// @testing-library/react's auto-cleanup only runs when vitest globals are
// enabled (afterEach is picked up automatically). The project doesn't
// enable globals, so we wire it up explicitly.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RatingGroup — keyboard → commit-animation → onRating", () => {
  it("keydown '1' triggers the commit animation on the yes button", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });

    const yesBtn = queryButton(/yes/i);
    expect(yesBtn.className).toContain(COMMIT_ANIMATION_NAME);
    // onRating must NOT fire yet — it waits for the animation to end.
    expect(onRating).not.toHaveBeenCalled();

    // Simulate the CSS animation finishing.
    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes", "keyboard");
  });

  it.each([
    ["1", "yes"],
    ["2", "if-partner-wants"],
    ["3", "maybe"],
    ["4", "fantasy"],
    ["5", "no"],
  ])("keydown '%s' commits rating '%s' after the commit animation", async (key, rating) => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    act(() => {
      fireEvent.keyDown(window, { key });
    });
    const committingBtn = document.querySelector(`.${COMMIT_ANIMATION_NAME}`);
    expect(committingBtn).not.toBeNull();
    act(() => {
      if (committingBtn) fireEvent.animationEnd(committingBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    expect(onRating).toHaveBeenCalledExactlyOnceWith(rating, "keyboard");
  });

  it("ignores animationend events with a non-matching animationName", async () => {
    // Guards against the ambient ring-transition on the selected radio
    // firing the commit handler. Reproduces the filter at
    // QuestionCard.tsx:310 (animationName !== COMMIT_ANIMATION_NAME → return).
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
    const yesBtn = queryButton(/yes/i);

    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: "ring-pulse" });
    });
    expect(onRating).not.toHaveBeenCalled();

    // The real commit animation still works.
    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes", "keyboard");
  });

  it("ignores further keypresses while committing is already set", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
    // Second keypress while '1' is still mid-animation — dropped by the
    // `if (committing) return` gate on the useEffect.
    act(() => {
      fireEvent.keyDown(window, { key: "3" });
    });

    const yesBtn = queryButton(/yes/i);
    const maybeBtn = queryButton(/maybe/i);
    expect(yesBtn.className).toContain(COMMIT_ANIMATION_NAME);
    expect(maybeBtn.className).not.toContain(COMMIT_ANIMATION_NAME);

    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes", "keyboard");
  });
});

describe("RatingGroup — mouse click vs keyboard activation", () => {
  it("mouse click (detail >= 1) fires onRating instantly — no animation", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    const yesBtn = queryButton(/yes/i);
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });

    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes", "mouse");
    expect(yesBtn.className).not.toContain(COMMIT_ANIMATION_NAME);
  });

  it("keyboard activation (click with detail === 0) takes the animation path", async () => {
    // Enter/Space on a focused button synthesizes a click with detail === 0.
    // This should trigger the commit animation, not fire onRating directly.
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    const yesBtn = queryButton(/yes/i);
    act(() => {
      fireEvent.click(yesBtn, { detail: 0 });
    });

    expect(onRating).not.toHaveBeenCalled();
    expect(yesBtn.className).toContain(COMMIT_ANIMATION_NAME);

    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes", "keyboard");
  });

  it("while committing, a second click is ignored", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    const yesBtn = queryButton(/yes/i);
    const maybeBtn = queryButton(/maybe/i);

    act(() => {
      fireEvent.click(yesBtn, { detail: 0 }); // keyboard-style → starts animation
    });
    act(() => {
      fireEvent.click(maybeBtn, { detail: 1 }); // mouse — should still be blocked
    });
    expect(onRating).not.toHaveBeenCalled();
  });
});

describe("RatingGroup — roving tabindex arrow keys", () => {
  it("ArrowDown/ArrowRight cycles focus forward, ArrowUp/ArrowLeft cycles backward", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    const group = screen.getByRole("radiogroup");
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(buttons).toHaveLength(5);

    // Initial focus index is 0 → yes button gets tabIndex=0, rest get -1.
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);

    act(() => {
      fireEvent.keyDown(group, { key: "ArrowDown" });
    });
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);

    act(() => {
      fireEvent.keyDown(group, { key: "ArrowLeft" });
    });
    expect(buttons[0].tabIndex).toBe(0);

    // Arrow keys must NOT commit.
    expect(onRating).not.toHaveBeenCalled();
  });

  it("wraps around at both ends", async () => {
    const onRating = vi.fn();
    render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

    const group = screen.getByRole("radiogroup");
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

    // Walk from 0 → 5 via ArrowDown: 0 → 1 → 2 → 3 → 4 → 0.
    for (let i = 0; i < 5; i++) {
      act(() => {
        fireEvent.keyDown(group, { key: "ArrowRight" });
      });
    }
    expect(buttons[0].tabIndex).toBe(0);

    // Walk backward: 0 → 4 (wrap).
    act(() => {
      fireEvent.keyDown(group, { key: "ArrowUp" });
    });
    expect(buttons[4].tabIndex).toBe(0);
  });
});

describe("RatingGroup — existing answer highlights the checked radio", () => {
  it("sets aria-checked on the matching button", () => {
    render(
      createElement(RatingGroup, {
        existingAnswer: { rating: "maybe", note: null },
        onRating: vi.fn(),
      }),
    );
    const maybeBtn = queryButton(/maybe/i);
    expect(maybeBtn.getAttribute("aria-checked")).toBe("true");

    const yesBtn = queryButton(/yes/i);
    expect(yesBtn.getAttribute("aria-checked")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Note-section behavior on the QuestionCard wrapper.
// ---------------------------------------------------------------------------

const CATEGORY: CategoryData = {
  id: "affection",
  label: "Affection",
  description: "",
  sortOrder: 1,
};

function makeQuestion(overrides: Partial<QuestionData> = {}): QuestionData {
  return {
    id: "massage",
    categoryId: "affection",
    text: "Massage",
    giveText: null,
    receiveText: null,
    description: null,
    notePrompt: null,
    targetGive: "all",
    targetReceive: "all",
    requiresGroupAnatomy: [],
    tier: 1,
    requires: [],
    ...overrides,
  };
}

function makeScreen(question: QuestionData): QuestionScreen {
  return {
    type: "question",
    question,
    role: "mutual",
    displayText: question.text,
    key: `${question.id}:mutual`,
    categoryId: question.categoryId,
  };
}

interface CardOpts {
  question?: QuestionData;
  existingAnswer?: Answer;
  onCommit?: (a: Answer) => void;
  onAdvance?: () => void;
  onBack?: () => void;
  index?: number;
  totalAnswered?: number;
  totalQuestions?: number;
}

function renderCard(opts: CardOpts = {}) {
  const question = opts.question ?? makeQuestion();
  const screenObj = makeScreen(question);
  const onCommit = opts.onCommit ?? vi.fn();
  const onAdvance = opts.onAdvance ?? vi.fn();
  const onBack = opts.onBack ?? vi.fn();
  const result = render(
    createElement(QuestionCard, {
      screen: screenObj,
      categoryMap: { [CATEGORY.id]: CATEGORY },
      allQuestionScreens: [screenObj],
      existingAnswer: opts.existingAnswer,
      index: opts.index ?? 0,
      totalAnswered: opts.totalAnswered ?? 0,
      totalQuestions: opts.totalQuestions ?? 1,
      syncing: false,
      showSyncIndicator: false,
      pendingCount: 0,
      onCommit,
      onAdvance,
      onBack,
      onSync: vi.fn(),
    }),
  );
  return { ...result, onCommit, onAdvance, onBack };
}

describe("QuestionCard — note section visibility", () => {
  it("ordinary question with no note shows '+ Add a note' link, not the textarea", () => {
    renderCard();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: /add a note/i })).toBeTruthy();
  });

  it("notePrompt question reveals the textarea from first paint", () => {
    renderCard({ question: makeQuestion({ notePrompt: "depths, positions, prep" }) });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.placeholder).toBe("depths, positions, prep");
    // No "+ Add a note" link — note section already open.
    expect(screen.queryByRole("button", { name: /add a note/i })).toBeNull();
  });

  it("returning to a question with an existing note pre-fills the textarea", () => {
    renderCard({
      existingAnswer: { rating: "yes", note: "low light, sandalwood" },
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("low light, sandalwood");
  });

  it("tapping '+ Add a note' opens the textarea inline", () => {
    renderCard();
    const link = screen.getByRole("button", { name: /add a note/i });
    act(() => {
      fireEvent.click(link);
    });
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});

describe("QuestionCard — auto-advance vs Layout B", () => {
  it("ordinary question + rating click auto-advances", async () => {
    const { onCommit, onAdvance } = renderCard();
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    // handleRating awaits onCommit before calling onAdvance; both land
    // after the click handler's microtask resolves.
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({ rating: "yes", note: null });
  });

  it("notePrompt question + rating click commits without advancing", async () => {
    const { onCommit, onAdvance } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ rating: "yes", note: null }));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("Layout B 'Next' button is disabled until a rating is set", () => {
    renderCard({ question: makeQuestion({ notePrompt: "what works" }) });
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("Layout B 'Next' fires onAdvance after rating + note", () => {
    const { onCommit, onAdvance } = renderCard({
      existingAnswer: { rating: "yes", note: "draft note" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    // Draft equals saved note → label reads "Next" and clicking is a no-op
    // commit (only an advance).
    expect(next.textContent).toBe("Next");
    act(() => {
      fireEvent.click(next);
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("QuestionCard — note commit", () => {
  it("typing in the textarea debounces a commit with the new note", async () => {
    vi.useFakeTimers();
    try {
      const { onCommit } = renderCard({
        existingAnswer: { rating: "yes", note: null },
        question: makeQuestion({ notePrompt: "what works" }),
      });
      const textarea = screen.getByRole("textbox");
      act(() => {
        fireEvent.change(textarea, { target: { value: "a quick note" } });
      });
      // Debounce hasn't fired yet.
      expect(onCommit).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith({
        rating: "yes",
        note: "a quick note",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("whitespace-only notes persist as null, not ''", async () => {
    vi.useFakeTimers();
    try {
      const { onCommit } = renderCard({
        existingAnswer: { rating: "yes", note: "kept" },
        question: makeQuestion({ notePrompt: "what works" }),
      });
      const textarea = screen.getByRole("textbox");
      act(() => {
        fireEvent.change(textarea, { target: { value: "   " } });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith({
        rating: "yes",
        note: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rating commit on a notePrompt question carries the typed-but-uncommitted note", async () => {
    const { onCommit } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "before rating" } });
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      rating: "yes",
      note: "before rating",
    });
  });
});

describe("QuestionCard — keyboard interaction with the note textarea", () => {
  it("typing '1' inside the textarea does NOT hijack-commit a rating", () => {
    const onCommit = vi.fn();
    renderCard({
      existingAnswer: { rating: "maybe", note: null },
      question: makeQuestion({ notePrompt: "what works" }),
      onCommit,
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.focus();
    // Window-level keydown with the textarea as target. Without the
    // editable-target guard, RatingGroup would preventDefault + commit "yes".
    act(() => {
      fireEvent.keyDown(textarea, { key: "1" });
    });
    // The maybe radio should NOT have flipped to committing.
    const maybeBtn = screen.getByRole("radio", { name: /maybe/i });
    expect(maybeBtn.className).not.toContain(COMMIT_ANIMATION_NAME);
    // No commit fired from the keystroke.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Cmd+Enter inside the textarea triggers Save & next when rated", async () => {
    const { onAdvance } = renderCard({
      existingAnswer: { rating: "yes", note: "i wrote a thing" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
  });

  it("Ctrl+Enter inside the textarea also triggers Save & next", async () => {
    const { onAdvance } = renderCard({
      existingAnswer: { rating: "yes", note: "another thing" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    });
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
  });

  it("Cmd+Enter pre-rating focuses the first rating button instead of being silent", () => {
    const { onAdvance } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
      // no existingAnswer — primary Next is disabled, no commit yet.
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });
    expect(onAdvance).not.toHaveBeenCalled();
    // Focus moved to the yes button so the user has a clear next step.
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /yes/i }));
  });

  it("plain Enter inside the textarea does not advance — it's reserved for newlines", () => {
    const { onAdvance } = renderCard({
      existingAnswer: { rating: "yes", note: "draft" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase / state-machine: rating ↔ timing transitions, mid-flow nav, idempotency.
// These guard the "two-phase form" invariants in advanceFromRating /
// advanceFromTiming. Each one targets a regression that is easy to introduce
// when refactoring the handlers.
// ---------------------------------------------------------------------------

describe("QuestionCard — phase transitions and resets", () => {
  it("re-mounting on a new screen.key resets draft and pillExpanded together", async () => {
    // The useEffect on screen.key reseeds local state. Drive a draft
    // change, then re-render with a new screen and verify reset.
    const onCommit = vi.fn();
    const onAdvance = vi.fn();
    const onBack = vi.fn();
    const q1 = makeQuestion({ id: "q1" });
    const q2 = makeQuestion({ id: "q2" });
    const screen1 = makeScreen(q1);
    const screen2 = makeScreen(q2);
    const { rerender } = render(
      createElement(QuestionCard, {
        screen: screen1,
        categoryMap: { [CATEGORY.id]: CATEGORY },
        allQuestionScreens: [screen1, screen2],
        existingAnswer: undefined,
        index: 0,
        totalAnswered: 0,
        totalQuestions: 2,
        syncing: false,
        showSyncIndicator: false,
        pendingCount: 0,
        onCommit,
        onAdvance,
        onBack,
        onSync: vi.fn(),
      }),
    );
    // Open Layout B via "+ Add a note".
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    });
    expect(screen.getByRole("textbox")).toBeTruthy();
    // Re-render on a new screen — local state should reset.
    rerender(
      createElement(QuestionCard, {
        screen: screen2,
        categoryMap: { [CATEGORY.id]: CATEGORY },
        allQuestionScreens: [screen1, screen2],
        existingAnswer: undefined,
        index: 1,
        totalAnswered: 0,
        totalQuestions: 2,
        syncing: false,
        showSyncIndicator: false,
        pendingCount: 0,
        onCommit,
        onAdvance,
        onBack,
        onSync: vi.fn(),
      }),
    );
    // No textarea (pillExpanded reset). Inline "+ Add a note" link is back.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: /add a note/i })).toBeTruthy();
  });

  it("returning to an answered notePrompt question shows the rating ring + filled note + 'Next' label", () => {
    renderCard({
      existingAnswer: { rating: "if-partner-wants", note: "saved earlier" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const willingBtn = screen.getByRole("radio", { name: /if partner wants/i });
    expect(willingBtn.getAttribute("aria-checked")).toBe("true");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("saved earlier");
    // Draft equals saved note → "Next", not "Save & next".
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(next.textContent).toBe("Next");
  });

  it("primary Next label transitions: 'Rate to continue' → 'Next' → 'Save & next'", () => {
    // No rating yet — disabled, "Rate to continue".
    const { rerender } = render(
      createElement(QuestionCard, {
        screen: makeScreen(makeQuestion({ notePrompt: "what works" })),
        categoryMap: { [CATEGORY.id]: CATEGORY },
        allQuestionScreens: [makeScreen(makeQuestion({ notePrompt: "what works" }))],
        existingAnswer: undefined,
        index: 0,
        totalAnswered: 0,
        totalQuestions: 1,
        syncing: false,
        showSyncIndicator: false,
        pendingCount: 0,
        onCommit: vi.fn(),
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onSync: vi.fn(),
      }),
    );
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.textContent).toMatch(/Rate to continue/);
    expect(next.disabled).toBe(true);

    // Rated, no draft typed, no saved note → "Next".
    rerender(
      createElement(QuestionCard, {
        screen: makeScreen(makeQuestion({ notePrompt: "what works" })),
        categoryMap: { [CATEGORY.id]: CATEGORY },
        allQuestionScreens: [makeScreen(makeQuestion({ notePrompt: "what works" }))],
        existingAnswer: { rating: "yes", note: null },
        index: 0,
        totalAnswered: 0,
        totalQuestions: 1,
        syncing: false,
        showSyncIndicator: false,
        pendingCount: 0,
        onCommit: vi.fn(),
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onSync: vi.fn(),
      }),
    );
    expect(next.textContent).toMatch(/^Next$/);

    // Type into the textarea so draft diverges from saved (null) → "Save & next".
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "fresh draft" } });
    });
    expect(next.textContent).toMatch(/Save & next/);

    // Erase the draft back to the saved value (null) → "Next" again.
    act(() => {
      fireEvent.change(textarea, { target: { value: "" } });
    });
    expect(next.textContent).toMatch(/^Next$/);
  });

  it("editing a saved note then reverting to the original value flips the label back to 'Next'", () => {
    renderCard({
      existingAnswer: { rating: "yes", note: "original text" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.textContent).toBe("Next");

    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "original text edited" } });
    });
    expect(next.textContent).toMatch(/Save & next/);

    act(() => {
      fireEvent.change(textarea, { target: { value: "original text" } });
    });
    expect(next.textContent).toBe("Next");
  });

  it("typing whitespace-only into a textarea with a null saved note keeps the label at 'Next'", () => {
    // trimNote("") and trimNote("   ") both return null. existingAnswer.note
    // is null. null === null → noteDirty is false → "Next".
    renderCard({
      existingAnswer: { rating: "yes", note: null },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const next = screen.getByTestId("note-next") as HTMLButtonElement;
    expect(next.textContent).toBe("Next");
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "   " } });
    });
    expect(next.textContent).toBe("Next");
  });

  it("re-rating after typing a note carries the typed draft into the new commit", async () => {
    // Pre-rating draft typing must travel with whatever rating the user
    // commits. Covers both the first-rating and the change-rating paths.
    const onCommit = vi.fn();
    renderCard({
      onCommit,
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "i'm into it" } });
    });
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /yes/i }), { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ rating: "yes", note: "i'm into it" }));

    // Rerate: change to maybe — draft should still be attached.
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /maybe/i }), { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit.mock.calls[1]?.[0]).toEqual({ rating: "maybe", note: "i'm into it" });
  });

  it("Skip is hidden once the user types a draft and reappears when the draft is erased", () => {
    renderCard({
      existingAnswer: { rating: "yes", note: null },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    // Initially no draft (note is null) → Skip visible.
    expect(screen.getByRole("button", { name: /skip question/i })).toBeTruthy();
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "draft" } });
    });
    expect(screen.queryByRole("button", { name: /skip question/i })).toBeNull();
    // Erase the draft → Skip reappears.
    act(() => {
      fireEvent.change(textarea, { target: { value: "" } });
    });
    expect(screen.getByRole("button", { name: /skip question/i })).toBeTruthy();
  });

  it("'+ Add a note' opens the textarea and it stays open after typing then erasing", () => {
    renderCard();
    expect(screen.queryByRole("textbox")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    });
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeTruthy();
    // pillExpanded is sticky — typing then erasing doesn't collapse.
    act(() => {
      fireEvent.change(textarea, { target: { value: "tap" } });
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: "" } });
    });
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("pre-rating typing in the textarea does NOT fire onCommit (no answer to attach)", async () => {
    vi.useFakeTimers();
    try {
      const { onCommit } = renderCard({ question: makeQuestion({ notePrompt: "what works" }) });
      const textarea = screen.getByRole("textbox");
      act(() => {
        fireEvent.change(textarea, { target: { value: "thinking out loud" } });
      });
      // Past the debounce window — still no commit (existingAnswer is undefined).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Layout regressions: shared Back / Add-a-note / Skip row, Back disabled at
// index 0, Add-a-note absent in Layout B.
// ---------------------------------------------------------------------------

describe("QuestionCard — Layout A vs Layout B regressions", () => {
  it("Back is disabled at index 0 in Layout A", () => {
    renderCard({ index: 0 });
    const back = screen.getByRole("button", { name: /previous question/i }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it("Back is disabled at index 0 in Layout B", () => {
    renderCard({ index: 0, question: makeQuestion({ notePrompt: "what works" }) });
    const back = screen.getByRole("button", { name: /previous question/i }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it("Back is enabled when index > 0", () => {
    renderCard({ index: 3 });
    const back = screen.getByRole("button", { name: /previous question/i }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
  });

  it("'+ Add a note' is rendered in Layout A but NOT in Layout B", () => {
    renderCard();
    expect(screen.getByRole("button", { name: /add a note/i })).toBeTruthy();
    cleanup();
    renderCard({ question: makeQuestion({ notePrompt: "what works" }) });
    expect(screen.queryByRole("button", { name: /add a note/i })).toBeNull();
  });

  it("Back/Skip in Layout B share the same icon-styled treatment as Layout A", () => {
    // Regression for the unified styling: both layouts must produce
    // `text-sm` Back/Skip buttons with chevron icons. Catches a drift back
    // to the old `text-xs` text-only treatment.
    renderCard({ question: makeQuestion({ notePrompt: "what works" }) });
    const back = screen.getByRole("button", { name: /previous question/i });
    const skip = screen.getByRole("button", { name: /skip question/i });
    expect(back.className).toMatch(/text-sm|gap-1/);
    expect(skip.className).toMatch(/text-sm|gap-1/);
    // Each icon-styled button contains an SVG chevron child.
    expect(back.querySelector("svg")).not.toBeNull();
    expect(skip.querySelector("svg")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Help popover behavior — open/close, mode swap, focus management.
// ---------------------------------------------------------------------------

describe("QuestionCard — help popover", () => {
  it("opens on trigger click, closes on Escape", () => {
    renderCard();
    const helpBtn = screen.getByRole("button", { name: /what do these ratings mean/i });
    act(() => {
      fireEvent.click(helpBtn);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when a pointerdown lands outside the popover", () => {
    renderCard();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /what do these ratings mean/i }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard discoverability — auto-focus textarea on keyboard rating commit,
// type-first → rate → advance, etc. The advance rule lives in
// advanceFromRating; the source flag is plumbed through RatingGroup.
// ---------------------------------------------------------------------------

describe("QuestionCard — keyboard rating commit auto-focuses the textarea", () => {
  it("keyboard-source rating commit on a notePrompt question moves focus to the textarea", async () => {
    const { onCommit } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    // Keyboard activation path: click with detail === 0 → animation → commit.
    act(() => {
      fireEvent.click(yesBtn, { detail: 0 });
    });
    act(() => {
      fireEvent.animationEnd(yesBtn, { animationName: COMMIT_ANIMATION_NAME });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("mouse-source rating commit does NOT yank focus to the textarea", async () => {
    const { onCommit } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    // Touch / mouse users get the keyboard pop-up dodge — focus stays put.
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
  });
});

describe("QuestionCard — type-first → rate → advance", () => {
  it("typing in the textarea then pressing a rating advances immediately (no manual Save & next)", async () => {
    const { onCommit, onAdvance } = renderCard({
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const textarea = screen.getByRole("textbox");
    act(() => {
      fireEvent.change(textarea, { target: { value: "before rating" } });
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    // The user typed first — they're done. Advance.
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("rehydrated note (no fresh typing) + rating change still suppresses advance", async () => {
    const { onCommit, onAdvance } = renderCard({
      existingAnswer: { rating: "maybe", note: "saved earlier" },
      question: makeQuestion({ notePrompt: "what works" }),
    });
    const yesBtn = screen.getByRole("radio", { name: /yes/i });
    act(() => {
      fireEvent.click(yesBtn, { detail: 1 });
    });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    // Draft equals existing note — no fresh typing — give the user space to edit.
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
