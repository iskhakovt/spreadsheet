/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupSetup } from "./GroupSetup.js";

// --- Module mocks ---

vi.mock("../lib/trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      setupAdmin: { mutationOptions: () => ({}) },
      status: { pathKey: () => ["groups", "status"] },
    },
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../lib/crypto.js", () => ({
  buildPersonLink: vi.fn((token: string) => `http://example.com/p/${token}`),
  wrapSensitive: vi.fn(async (value: string) => value),
}));

vi.mock("../lib/use-copy.js", () => ({
  useCopy: () => ({ copiedIndex: null, copy: vi.fn() }),
}));

// --- Helpers ---

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Props for a filtered group where the admin picks anatomy. */
const filteredAdminPicksProps = {
  adminToken: "test-admin-token",
  group: {
    questionMode: "filtered",
    anatomyLabels: "anatomical",
    anatomyPicker: "admin",
    encrypted: false,
  },
} as const;

/** Props for a filtered group where each person picks their own anatomy. */
const filteredSelfPicksProps = {
  adminToken: "test-admin-token",
  group: {
    questionMode: "filtered",
    anatomyLabels: "anatomical",
    anatomyPicker: "self",
    encrypted: false,
  },
} as const;

/** Props for a non-filtered (all-questions) group. */
const allQuestionsProps = {
  adminToken: "test-admin-token",
  group: {
    questionMode: "all",
    anatomyLabels: null,
    anatomyPicker: null,
    encrypted: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Admin anatomy picker helper text (new in this PR)
// ---------------------------------------------------------------------------

describe("GroupSetup — admin anatomy helper text", () => {
  it("shows helper text after admin anatomy picker when adminPicksAnatomy is true", () => {
    render(createElement(GroupSetup, filteredAdminPicksProps));

    expect(
      screen.getByText("So we can show only questions that apply to you."),
    ).not.toBeNull();
  });

  it("does NOT show admin anatomy helper text when questionMode is 'all'", () => {
    render(createElement(GroupSetup, allQuestionsProps));

    expect(
      screen.queryByText("So we can show only questions that apply to you."),
    ).toBeNull();
  });

  it("does NOT show admin anatomy helper text when anatomyPicker is 'self'", () => {
    render(createElement(GroupSetup, filteredSelfPicksProps));

    expect(
      screen.queryByText("So we can show only questions that apply to you."),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Partner anatomy picker helper text (new in this PR)
// ---------------------------------------------------------------------------

describe("GroupSetup — partner anatomy helper text", () => {
  it("shows helper text after partner anatomy picker when adminPicksAnatomy is true", () => {
    render(createElement(GroupSetup, filteredAdminPicksProps));

    expect(
      screen.getByText("So they see only questions that apply to them."),
    ).not.toBeNull();
  });

  it("does NOT show partner anatomy helper text when questionMode is 'all'", () => {
    render(createElement(GroupSetup, allQuestionsProps));

    expect(
      screen.queryByText("So they see only questions that apply to them."),
    ).toBeNull();
  });

  it("does NOT show partner anatomy helper text when anatomyPicker is 'self'", () => {
    render(createElement(GroupSetup, filteredSelfPicksProps));

    expect(
      screen.queryByText("So they see only questions that apply to them."),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Both helper texts together
// ---------------------------------------------------------------------------

describe("GroupSetup — both anatomy helper texts together", () => {
  it("shows both admin and partner helper texts simultaneously when adminPicksAnatomy is true", () => {
    render(createElement(GroupSetup, filteredAdminPicksProps));

    expect(
      screen.getByText("So we can show only questions that apply to you."),
    ).not.toBeNull();
    expect(
      screen.getByText("So they see only questions that apply to them."),
    ).not.toBeNull();
  });

  it("shows both helper texts for each partner when multiple partners are added", () => {
    render(createElement(GroupSetup, filteredAdminPicksProps));

    const addPartnerBtn = screen.getByRole("button", { name: /add another person/i });
    act(() => {
      fireEvent.click(addPartnerBtn);
    });

    // After adding a second partner there should be 2 instances of the partner helper text.
    const partnerTexts = screen.getAllByText("So they see only questions that apply to them.");
    expect(partnerTexts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Regression: helper texts are absent when anatomy pickers are not shown
// ---------------------------------------------------------------------------

describe("GroupSetup — regression: no anatomy helper texts without body pickers", () => {
  it("renders the form without any anatomy helper text when questionMode is 'all'", () => {
    render(createElement(GroupSetup, allQuestionsProps));

    expect(
      screen.queryByText(/so we can show only questions/i),
    ).toBeNull();
    expect(
      screen.queryByText(/so they see only questions/i),
    ).toBeNull();
  });

  it("renders the form without any anatomy helper text when anatomyPicker is 'self'", () => {
    render(createElement(GroupSetup, filteredSelfPicksProps));

    expect(
      screen.queryByText(/so we can show only questions/i),
    ).toBeNull();
    expect(
      screen.queryByText(/so they see only questions/i),
    ).toBeNull();
  });
});