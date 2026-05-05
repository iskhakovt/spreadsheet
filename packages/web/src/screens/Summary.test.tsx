/** @vitest-environment happy-dom */
import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Summary } from "./Summary.js";

function withQueryClient(ui: ReactElement): ReactElement {
  // Summary calls useAnswers, which subscribes to a TanStack query cache
  // slot via useQueryClient. Wrap in a Provider so the hook resolves.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, ui);
}

afterEach(() => {
  cleanup();
});

const noop = () => {};

const categories: CategoryData[] = [
  { id: "touch", label: "Touch", description: "", sortOrder: 1 },
  { id: "reproductive", label: "Reproductive", description: "", sortOrder: 2 },
];

function q(overrides: Partial<QuestionData> & { id: string; categoryId: string }): QuestionData {
  return {
    text: overrides.id,
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

describe("Summary picker — empty-category hiding", () => {
  it("hides a category whose questions are all anatomy-filtered out for this group", () => {
    // Reproductive contains afab-receiver-only questions. An all-amab group
    // (anatomy + others all amab, filtered mode) should not see Reproductive
    // listed at all — the latent bug this PR fixed.
    const questions: QuestionData[] = [
      q({ id: "kissing", categoryId: "touch" }),
      q({
        id: "pregnancy",
        categoryId: "reproductive",
        giveText: "g",
        receiveText: "r",
        targetGive: "amab",
        targetReceive: "afab",
      }),
    ];

    render(
      withQueryClient(
        createElement(Summary, {
          questions,
          categories,
          isAdmin: false,
          anatomy: "amab",
          otherAnatomies: ["amab"],
          questionMode: "filtered",
          onNavigateToCategory: noop,
          onBack: noop,
          onReview: noop,
        }),
      ),
    );

    expect(screen.queryByLabelText("Include Touch")).not.toBeNull();
    expect(screen.queryByLabelText("Include Reproductive")).toBeNull();
  });

  it("renders a category that has at least one anatomy-applicable question", () => {
    // Same Reproductive question, but the group now contains an afab partner
    // — the receive side becomes applicable, so Reproductive must show up.
    const questions: QuestionData[] = [
      q({ id: "kissing", categoryId: "touch" }),
      q({
        id: "pregnancy",
        categoryId: "reproductive",
        giveText: "g",
        receiveText: "r",
        targetGive: "amab",
        targetReceive: "afab",
      }),
    ];

    render(
      withQueryClient(
        createElement(Summary, {
          questions,
          categories,
          isAdmin: false,
          anatomy: "amab",
          otherAnatomies: ["afab"],
          questionMode: "filtered",
          onNavigateToCategory: noop,
          onBack: noop,
          onReview: noop,
        }),
      ),
    );

    expect(screen.queryByLabelText("Include Touch")).not.toBeNull();
    expect(screen.queryByLabelText("Include Reproductive")).not.toBeNull();
  });
});

// Silence the act-warning chatter when the component reads localStorage on mount.
// Other tests in this file don't trigger any state updates after render.
vi.spyOn(console, "error").mockImplementation(() => {});
