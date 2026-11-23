/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { Component, createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WrongKeyError } from "./codec.js";
import { adoptSession } from "./session.js";

type OnData = (raw: unknown) => Promise<void>;
const { captured, decryptStatus } = vi.hoisted(() => ({
  captured: { onData: null as OnData | null },
  decryptStatus: vi.fn(),
}));

const rawStatus = { person: { id: "me" }, group: { encrypted: true }, members: [] };

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      status: { queryKey: () => [["groups", "status"], { type: "query" }] },
      onStatus: { subscriptionOptions: (_input: unknown, opts: object) => opts },
    },
  }),
  useTRPCClient: () => ({ groups: { status: { query: async () => rawStatus } } }),
}));
vi.mock("@trpc/tanstack-react-query", () => ({
  useSubscription: (opts: { onData: OnData }) => {
    captured.onData = opts.onData;
  },
}));
vi.mock("./decrypt-status.js", () => ({ decryptStatus }));

const { useLiveStatus } = await import("./use-live-status.js");

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

beforeEach(() => {
  adoptSession(`token-live-${Math.random().toString(36).slice(2)}`);
  captured.onData = null;
  decryptStatus.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useLiveStatus", () => {
  it("surfaces a WrongKeyError from a live status to the boundary, so open forms go away", async () => {
    // e.g. another device just saved this profile under the right key.
    decryptStatus.mockResolvedValueOnce({ ...rawStatus, members: [] }).mockRejectedValueOnce(new WrongKeyError());
    const onError = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, createElement(Boundary, { onError, children }));

    renderHook(() => useLiveStatus(), { wrapper });
    await vi.waitFor(() => expect(captured.onData).not.toBeNull());

    await act(async () => {
      await captured.onData?.(rawStatus);
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(WrongKeyError)));
  });
});
