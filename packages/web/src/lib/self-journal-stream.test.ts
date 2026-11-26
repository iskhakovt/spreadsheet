/** @vitest-environment happy-dom */
import type { OperationPayload } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { Component, createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec, WrongKeyError } from "./codec.js";
import { generateGroupKey } from "./crypto.js";
import { adoptSession } from "./session.js";
import { getSelfJournalCursor } from "./storage.js";

type OnData = (msg: { data: { entries: { id: string; personId: string; operation: string }[] } }) => void;
const { captured } = vi.hoisted(() => ({ captured: { onData: null as OnData | null } }));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    sync: { onSelfJournalChange: { subscriptionOptions: (_input: unknown, opts: object) => opts } },
  }),
  useTRPCClient: () => ({
    sync: { selfJournal: { query: async () => ({ entries: [], cursor: null, stoken: null }) } },
  }),
}));
vi.mock("@trpc/tanstack-react-query", () => ({
  useSubscription: (opts: { onData: OnData }) => {
    captured.onData = opts.onData;
  },
}));

const { useSelfJournal } = await import("./self-journal.js");

class Boundary extends Component<{ onError: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const entry = (id: string, operation: string) => ({ id, personId: "me", operation });
const op = { key: "kissing:mutual", data: { rating: "yes" as const, note: null } } satisfies OperationPayload;

beforeEach(() => {
  localStorage.clear();
  adoptSession(`token-stream-${Math.random().toString(36).slice(2)}`);
  captured.onData = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useSelfJournal live deltas under a wrong key", () => {
  it("stops at the rejected delta: a later delta that opens doesn't move the cursor past it", async () => {
    const mine = createGroupCodec(true, await generateGroupKey());
    const theirs = createGroupCodec(true, await generateGroupKey());
    const onError = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, createElement(Boundary, { onError, children }));

    renderHook(() => useSelfJournal(mine), { wrapper });
    await vi.waitFor(() => expect(captured.onData).not.toBeNull());

    // 1: written under a key this tab doesn't hold, and nothing has proven ours.
    await act(async () => {
      captured.onData?.({ data: { entries: [entry("AAAAAAAAAAAAAAAAAAAAAA", await theirs.seal(op))] } });
    });
    // 2: would open under this tab's key.
    await act(async () => {
      captured.onData?.({ data: { entries: [entry("BBBBBBBBBBBBBBBBBBBBBB", await mine.seal(op))] } });
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(WrongKeyError)));
    expect(getSelfJournalCursor()).toBeNull();
  });
});
