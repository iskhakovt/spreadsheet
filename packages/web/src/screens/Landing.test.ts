/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing.js";

// --- Module mocks (hoisted before imports by Vitest's transform) ---

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("../lib/trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      create: { mutationOptions: () => ({}) },
    },
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock("../lib/crypto.js", () => ({
  generateGroupKey: vi.fn(async () => "mock-key"),
}));

// Stub SourceLink so it doesn't pull in extra dependencies.
vi.mock("../components/source-link.js", () => ({
  SourceLink: () => null,
}));

// --- Helpers ---

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Renders the Landing component, clicks "Get started" to transition to the
 * CreateGroup form, and returns the render result.
 */
function renderCreateGroup() {
  const result = render(createElement(Landing));

  const getStartedBtn = screen.getByRole("button", { name: /get started/i });
  act(() => {
    fireEvent.click(getStartedBtn);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Question mode helper text (new in this PR)
// ---------------------------------------------------------------------------

describe("CreateGroup — question mode helper text", () => {
  it("renders the helper text below the question mode toggle", () => {
    renderCreateGroup();

    expect(
      screen.getByText("Filter shows each person only the questions that apply to their body."),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Label style ToggleGroup (replaced custom radio buttons in this PR)
// ---------------------------------------------------------------------------

describe("CreateGroup — label style ToggleGroup", () => {
  it("renders the label style toggle group with exactly 3 options (short removed)", () => {
    renderCreateGroup();

    const labelStyleGroup = screen.getByRole("radiogroup", { name: /label style/i });
    const options = Array.from(labelStyleGroup.querySelectorAll('[role="radio"]'));

    expect(options).toHaveLength(3);
  });

  it("does NOT include the 'short' preset option", () => {
    renderCreateGroup();

    const labelStyleGroup = screen.getByRole("radiogroup", { name: /label style/i });
    const optionLabels = Array.from(labelStyleGroup.querySelectorAll('[role="radio"]')).map(
      (el) => el.textContent,
    );

    // The short preset would produce "M / F" — ensure it's absent.
    expect(optionLabels).not.toContain("M / F");
  });

  it("includes anatomical, gendered, and amab options", () => {
    renderCreateGroup();

    const labelStyleGroup = screen.getByRole("radiogroup", { name: /label style/i });
    const optionLabels = Array.from(labelStyleGroup.querySelectorAll('[role="radio"]')).map(
      (el) => el.textContent,
    );

    expect(optionLabels).toContain("Penis / Vulva"); // anatomical
    expect(optionLabels).toContain("Male / Female"); // gendered
    expect(optionLabels).toContain("AMAB / AFAB"); // amab
  });

  it("renders helper text below the label style toggle", () => {
    renderCreateGroup();

    expect(
      screen.getByText("Affects how questions describe bodies, not which ones you see."),
    ).not.toBeNull();
  });

  it("defaults to 'anatomical' (Penis / Vulva) selected", () => {
    renderCreateGroup();

    const labelStyleGroup = screen.getByRole("radiogroup", { name: /label style/i });
    const anatomicalBtn = Array.from(labelStyleGroup.querySelectorAll('[role="radio"]')).find(
      (el) => el.textContent === "Penis / Vulva",
    );
    expect(anatomicalBtn?.getAttribute("aria-checked")).toBe("true");
  });

  it("changes selected label style when an option is clicked", () => {
    renderCreateGroup();

    const labelStyleGroup = screen.getByRole("radiogroup", { name: /label style/i });
    const genderedBtn = Array.from(labelStyleGroup.querySelectorAll('[role="radio"]')).find(
      (el) => el.textContent === "Male / Female",
    );

    act(() => {
      fireEvent.click(genderedBtn as Element);
    });

    expect(genderedBtn?.getAttribute("aria-checked")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Who picks body type helper text (new in this PR)
// ---------------------------------------------------------------------------

describe("CreateGroup — who picks body type helper text", () => {
  it("renders the helper text below the who-picks toggle", () => {
    renderCreateGroup();

    expect(
      screen.getByText("Fill in everyone's body now, or let each person pick their own on arrival."),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filtered settings visibility (label style and who-picks sections)
// ---------------------------------------------------------------------------

describe("CreateGroup — filtered settings section visibility", () => {
  it("shows filtered settings by default (questionMode defaults to 'filtered')", () => {
    renderCreateGroup();

    expect(screen.queryByRole("radiogroup", { name: /label style/i })).not.toBeNull();
    expect(screen.queryByRole("radiogroup", { name: /who picks body type/i })).not.toBeNull();
  });

  it("hides filtered settings when 'All questions' mode is selected", () => {
    renderCreateGroup();

    const questionModeGroup = screen.getByRole("radiogroup", { name: /question mode/i });
    const allQuestionsBtn = Array.from(
      questionModeGroup.querySelectorAll('[role="radio"]'),
    ).find((el) => el.textContent === "All questions");

    act(() => {
      fireEvent.click(allQuestionsBtn as Element);
    });

    expect(screen.queryByRole("radiogroup", { name: /label style/i })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: /who picks body type/i })).toBeNull();
  });

  it("re-shows filtered settings when switching back to 'Filter by body'", () => {
    renderCreateGroup();

    const questionModeGroup = screen.getByRole("radiogroup", { name: /question mode/i });
    const allQuestionsBtn = Array.from(
      questionModeGroup.querySelectorAll('[role="radio"]'),
    ).find((el) => el.textContent === "All questions");
    const filterBtn = Array.from(questionModeGroup.querySelectorAll('[role="radio"]')).find(
      (el) => el.textContent === "Filter by body",
    );

    act(() => {
      fireEvent.click(allQuestionsBtn as Element);
    });
    act(() => {
      fireEvent.click(filterBtn as Element);
    });

    expect(screen.queryByRole("radiogroup", { name: /label style/i })).not.toBeNull();
  });

  it("hides the label style helper text when 'All questions' is selected", () => {
    renderCreateGroup();

    const questionModeGroup = screen.getByRole("radiogroup", { name: /question mode/i });
    const allQuestionsBtn = Array.from(
      questionModeGroup.querySelectorAll('[role="radio"]'),
    ).find((el) => el.textContent === "All questions");

    act(() => {
      fireEvent.click(allQuestionsBtn as Element);
    });

    expect(
      screen.queryByText("Affects how questions describe bodies, not which ones you see."),
    ).toBeNull();
  });
});