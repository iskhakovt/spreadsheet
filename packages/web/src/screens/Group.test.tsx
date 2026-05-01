/** @vitest-environment happy-dom */
import type { Group as GroupData, Member, Person } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      addPerson: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      status: { pathKey: () => ["groups", "status"] },
    },
  }),
}));

vi.mock("../lib/storage.js", () => ({
  useAnswers: () => ({}),
}));

vi.mock("../lib/use-copy.js", () => ({
  useCopy: () => ({ copiedIndex: undefined, copy: vi.fn() }),
}));

vi.mock("../components/copy-my-link.js", () => ({
  CopyMyLink: () => null,
}));

const { Group } = await import("./Group.js");

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  cleanup();
});

const baseGroup: Pick<
  GroupData,
  "encrypted" | "isReady" | "isAdminReady" | "questionMode" | "anatomyLabels" | "anatomyPicker"
> = {
  encrypted: false,
  isReady: false,
  isAdminReady: true,
  questionMode: "filtered",
  anatomyLabels: "anatomical",
  anatomyPicker: "self",
};

const adminMember: Member = { id: "p1", name: "Alice", anatomy: "afab", isAdmin: true, isCompleted: false };
const partnerMember: Member = { id: "p2", name: "Bob", anatomy: null, isAdmin: false, isCompleted: false };
const carolMember: Member = { id: "p3", name: "Carol", anatomy: null, isAdmin: false, isCompleted: false };

const adminPerson: Pick<Person, "isCompleted"> = { isCompleted: false };

const noop = () => {};

describe("Group screen — Add Person button visibility", () => {
  // Regression: client-side `isReady = isAdminReady && allAnatomySet` would
  // flip false when partners hadn't picked anatomy yet, rendering the "Add
  // person" button despite the server's addPerson rejecting any change once
  // setupAdmin has run. Branching on isAdminReady (server-truth) hides the
  // dead button.
  it("hides Add Person button when isAdminReady=true (server-finalized) even if isReady=false", () => {
    render(
      createElement(Group, {
        members: [adminMember, partnerMember, carolMember],
        person: adminPerson,
        group: { ...baseGroup, isAdminReady: true, isReady: false },
        token: "tok",
        onGroupReady: noop,
        onStartFilling: noop,
        onViewAnswers: noop,
        onBack: noop,
      }),
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: "Add person" })).toBeNull();
    // Title is "Your group" (server-finalized), not the plural invite copy.
    expect(screen.getByRole("heading", { name: "Your group" })).not.toBeNull();
  });

  it("shows Add Person button when isAdminReady=false (group not yet finalized)", () => {
    render(
      createElement(Group, {
        members: [adminMember, partnerMember],
        person: adminPerson,
        group: { ...baseGroup, isAdminReady: false, isReady: false },
        token: "tok",
        onGroupReady: noop,
        onStartFilling: noop,
        onViewAnswers: noop,
        onBack: noop,
      }),
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: "Add person" })).not.toBeNull();
  });

  it("renders plural title when isAdminReady=false with 2+ partners", () => {
    render(
      createElement(Group, {
        members: [adminMember, partnerMember, carolMember],
        person: adminPerson,
        group: { ...baseGroup, isAdminReady: false, isReady: false },
        token: "tok",
        onGroupReady: noop,
        onStartFilling: noop,
        onViewAnswers: noop,
        onBack: noop,
      }),
      { wrapper },
    );
    expect(screen.getByRole("heading", { name: "Invite your partners" })).not.toBeNull();
  });
});
