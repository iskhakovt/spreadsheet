/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { Component, type ReactNode, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WrongKeyError } from "./codec.js";

const { query, decrypt } = vi.hoisted(() => ({ query: vi.fn(), decrypt: vi.fn() }));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      status: { queryKey: () => [["groups", "status"]] },
      onStatus: { subscriptionOptions: () => ({}) },
    },
  }),
  useTRPCClient: () => ({ groups: { status: { query } } }),
}));
vi.mock("@trpc/tanstack-react-query", () => ({ useSubscription: () => {} }));
vi.mock("./decrypt-status.js", () => ({ decryptStatus: decrypt }));

const { useLiveStatus } = await import("./use-live-status.js");

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error ? (
      <p>{this.state.error instanceof WrongKeyError ? "mismatch" : "other"}</p>
    ) : (
      this.props.children
    );
  }
}

let refresh: () => Promise<void> = async () => {};
function Probe() {
  const live = useLiveStatus();
  refresh = live.refresh;
  return <p>{live.status?.group.id}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe("useLiveStatus", () => {
  it("shows the key-mismatch boundary when a refetch's key check refutes the key, over cached data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockResolvedValue({ group: { id: "g1" } });
    decrypt.mockResolvedValueOnce({ person: null, group: { id: "g1" }, members: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Boundary>
          <Suspense fallback={<p>loading</p>}>
            <Probe />
          </Suspense>
        </Boundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("g1")).toBeTruthy();

    decrypt.mockRejectedValueOnce(new WrongKeyError());
    await act(() => refresh());
    expect(await screen.findByText("mismatch")).toBeTruthy();
  });
});
