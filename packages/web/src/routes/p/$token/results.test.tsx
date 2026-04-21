/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const { trackFn } = vi.hoisted(() => ({ trackFn: vi.fn() }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useMutation: () => ({ mutate: trackFn }) };
});

vi.mock("../../../lib/person-app-context.js", () => ({
  usePersonApp: () => ({
    token: "test-token",
    authedStatus: {
      person: { id: "p1" },
      group: { showTiming: true, encrypted: false },
    },
  }),
}));

vi.mock("../../../lib/trpc.js", () => ({
  useTRPC: () => ({
    analytics: { track: { mutationOptions: () => ({}) } },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../screens/Comparison.js", () => ({
  Comparison: () => null,
}));

const { ResultsRoute } = await import("./results.js");

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  trackFn.mockReset();
});

it("calls analytics.track with results_viewed on mount", () => {
  render(createElement(ResultsRoute), { wrapper });
  expect(trackFn).toHaveBeenCalledOnce();
  expect(trackFn).toHaveBeenCalledWith({ event: "results_viewed" });
});

it("does not call analytics.track again on re-render", () => {
  const { rerender } = render(createElement(ResultsRoute), { wrapper });
  trackFn.mockReset();
  rerender(createElement(ResultsRoute));
  expect(trackFn).not.toHaveBeenCalled();
});
