/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    // PersonApp calls useParams() to get the token; supply a fixed value.
    useParams: () => ({ token: "test-person-token" }),
    // useLocation is called at the top of PersonApp; return a stable value.
    useLocation: () => ["/setup", vi.fn()],
  };
});

vi.mock("../lib/session.js", () => ({
  setSession: vi.fn(),
  getAuthToken: vi.fn(() => "test-token"),
}));

vi.mock("../lib/use-live-status.js", () => ({
  useLiveStatus: vi.fn(),
}));

vi.mock("../lib/trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      status: { pathKey: () => ["groups", "status"] },
      markReady: { mutationOptions: (_opts?: unknown) => ({}) },
      setProfile: { mutationOptions: (_opts?: unknown) => ({}) },
    },
    questions: {
      list: { queryOptions: () => ({}) },
    },
  }),
  useTRPCClient: () => ({}),
  wsClient: { close: vi.fn() },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      getQueryData: vi.fn(() => null),
    }),
    useSuspenseQuery: () => ({
      data: { questions: [], categories: [] },
    }),
  };
});

vi.mock("../lib/crypto.js", () => ({
  getGroupKeyFromUrl: vi.fn(() => null),
  buildPersonLink: vi.fn((t: string) => `http://example.com/p/${t}`),
  wrapSensitive: vi.fn(async (v: string) => v),
}));

vi.mock("../lib/storage.js", () => ({
  getHasSeenIntro: vi.fn(() => true),
  setHasSeenIntro: vi.fn(),
}));

vi.mock("../lib/journal-query.js", () => ({
  JOURNAL_QUERY_KEY: ["journal"],
  prefetchJournal: vi.fn(async () => {}),
}));

vi.mock("../lib/use-mark-complete.js", () => ({
  useMarkComplete: () => vi.fn(),
}));

vi.mock("../lib/member-display.js", () => ({
  sortMembersViewerFirst: vi.fn((members: unknown[]) => members),
}));

// Stub heavy child screens that won't be rendered on the /setup path.
vi.mock("./Comparison.js", () => ({ Comparison: () => null }));
vi.mock("./Group.js", () => ({ Group: () => null }));
vi.mock("./GroupSetup.js", () => ({ GroupSetup: () => null }));
vi.mock("./Intro.js", () => ({ Intro: () => null }));
vi.mock("./Question.js", () => ({ Question: () => null }));
vi.mock("./Review.js", () => ({ Review: () => null }));
vi.mock("./Summary.js", () => ({ Summary: () => null }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A minimal GroupStatus where the person has no name yet (→ /setup route). */
function makeStatus(overrides: { anatomyPicker?: string | null; questionMode?: string } = {}) {
  return {
    group: {
      questionMode: overrides.questionMode ?? "filtered",
      anatomyLabels: "anatomical",
      anatomyPicker: overrides.anatomyPicker ?? "self",
      encrypted: false,
      isAdminReady: true,
      isReady: true,
      showTiming: false,
    },
    person: {
      id: "person-1",
      name: "", // empty name causes resolveRoute → "/setup"
      isAdmin: false,
      isCompleted: false,
      anatomy: null,
    },
    members: [],
  };
}

async function renderPersonAppAtSetup(statusOverrides?: { anatomyPicker?: string | null; questionMode?: string }) {
  // Dynamically import AFTER mocks are registered so all vi.mock stubs are
  // in place before the module graph is evaluated.
  const { useLiveStatus } = await import("../lib/use-live-status.js");
  const { MemoryRouter } = await import("wouter");
  const { PersonApp } = await import("./PersonApp.js");

  vi.mocked(useLiveStatus).mockReturnValue({
    status: makeStatus(statusOverrides) as never,
    refresh: vi.fn(async () => {}),
  });

  await act(async () => {
    render(
      // MemoryRouter at "/setup" so wouter's Route path="/setup" matches.
      createElement(MemoryRouter, { initialPath: "/setup" }, createElement(PersonApp)),
    );
  });
}

// ---------------------------------------------------------------------------
// OnboardingForm — anatomy helper text (new in this PR)
// ---------------------------------------------------------------------------

describe("OnboardingForm (via PersonApp /setup route) — anatomy helper text", () => {
  it("shows helper text when group uses filtered mode and self-pick anatomy", async () => {
    // showAnatomy = questionMode==="filtered" && anatomyPicker==="self"
    await renderPersonAppAtSetup({ questionMode: "filtered", anatomyPicker: "self" });

    expect(
      screen.getByText("So we can show only questions that apply to you."),
    ).not.toBeNull();
  });

  it("does NOT show helper text when anatomyPicker is 'admin'", async () => {
    // anatomyPicker="admin" means showAnatomy=false in NonAdminOnboarding.
    await renderPersonAppAtSetup({ questionMode: "filtered", anatomyPicker: "admin" });

    expect(
      screen.queryByText("So we can show only questions that apply to you."),
    ).toBeNull();
  });

  it("does NOT show helper text when questionMode is 'all'", async () => {
    await renderPersonAppAtSetup({ questionMode: "all", anatomyPicker: "self" });

    expect(
      screen.queryByText("So we can show only questions that apply to you."),
    ).toBeNull();
  });

  it("does NOT show the anatomy picker or helper text when anatomyPicker is null", async () => {
    await renderPersonAppAtSetup({ questionMode: "all", anatomyPicker: null });

    expect(
      screen.queryByText("So we can show only questions that apply to you."),
    ).toBeNull();
  });
});