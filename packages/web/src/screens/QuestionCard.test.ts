/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RatingGroup, TimingButtons } from "./QuestionCard.js";

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
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes");
  });

  it("each numeric key 1-5 maps to the correct rating", async () => {
    const cases: [string, string][] = [
      ["1", "yes"],
      ["2", "if-partner-wants"],
      ["3", "maybe"],
      ["4", "fantasy"],
      ["5", "no"],
    ];
    for (const [key, rating] of cases) {
      const onRating = vi.fn();
      const { unmount } = render(createElement(RatingGroup, { existingAnswer: undefined, onRating }));

      act(() => {
        fireEvent.keyDown(window, { key });
      });
      const committingBtn = document.querySelector(`.${COMMIT_ANIMATION_NAME}`);
      expect(committingBtn).not.toBeNull();
      act(() => {
        if (committingBtn) fireEvent.animationEnd(committingBtn, { animationName: COMMIT_ANIMATION_NAME });
      });
      expect(onRating).toHaveBeenCalledExactlyOnceWith(rating);
      unmount();
    }
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
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes");
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
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes");
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

    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes");
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
    expect(onRating).toHaveBeenCalledExactlyOnceWith("yes");
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
        existingAnswer: { rating: "maybe", timing: null },
        onRating: vi.fn(),
      }),
    );
    const maybeBtn = queryButton(/maybe/i);
    expect(maybeBtn.getAttribute("aria-checked")).toBe("true");

    const yesBtn = queryButton(/yes/i);
    expect(yesBtn.getAttribute("aria-checked")).toBe("false");
  });
});

describe("TimingButtons", () => {
  it("'1' and 'n' both commit 'now'", async () => {
    for (const key of ["1", "n"]) {
      const onTiming = vi.fn();
      const { unmount } = render(createElement(TimingButtons, { onTiming }));

      act(() => {
        fireEvent.keyDown(window, { key });
      });
      const nowBtn = document.querySelector(`.${COMMIT_ANIMATION_NAME}`);
      expect(nowBtn).not.toBeNull();
      act(() => {
        if (nowBtn) fireEvent.animationEnd(nowBtn, { animationName: COMMIT_ANIMATION_NAME });
      });
      expect(onTiming).toHaveBeenCalledExactlyOnceWith("now");
      unmount();
    }
  });

  it("'2' and 'l' both commit 'later'", async () => {
    for (const key of ["2", "l"]) {
      const onTiming = vi.fn();
      const { unmount } = render(createElement(TimingButtons, { onTiming }));

      act(() => {
        fireEvent.keyDown(window, { key });
      });
      const btn = document.querySelector(`.${COMMIT_ANIMATION_NAME}`);
      expect(btn).not.toBeNull();
      act(() => {
        if (btn) fireEvent.animationEnd(btn, { animationName: COMMIT_ANIMATION_NAME });
      });
      expect(onTiming).toHaveBeenCalledExactlyOnceWith("later");
      unmount();
    }
  });

  it("ignores further keypresses while committing", async () => {
    const onTiming = vi.fn();
    render(createElement(TimingButtons, { onTiming }));

    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "2" });
    });

    // Only one button should carry commit-alpha.
    const committing = document.querySelectorAll(`.${COMMIT_ANIMATION_NAME}`);
    expect(committing).toHaveLength(1);
  });
});
