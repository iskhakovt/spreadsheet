/** @vitest-environment happy-dom */
import { fakeEncrypted, KEY_CHECK } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fillFn, seal, appState } = vi.hoisted(() => ({
  fillFn: vi.fn(),
  seal: vi.fn(),
  appState: { current: { keyCheckFillable: true as true | undefined, person: { isAdmin: true } } },
}));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      fillKeyCheck: { mutationOptions: (opts?: object) => ({ mutationFn: fillFn, ...opts }) },
      status: { pathKey: () => ["groups", "status"] as const },
    },
  }),
}));
vi.mock("./person-app-context.js", () => ({
  usePersonApp: () => ({ authedStatus: appState.current, codec: { seal } }),
}));

const { useFillKeyCheck } = await import("./use-fill-key-check.js");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  fillFn.mockReset().mockResolvedValue({ filled: true });
  seal.mockReset().mockImplementation(async (v: string) => fakeEncrypted(`sealed(${v})`));
  appState.current = { keyCheckFillable: true, person: { isAdmin: true } };
});
afterEach(() => vi.restoreAllMocks());

describe("useFillKeyCheck", () => {
  it("seals the key check and fills it in once per mount", async () => {
    const { rerender } = renderHook(() => useFillKeyCheck(), { wrapper });
    await waitFor(() => expect(fillFn).toHaveBeenCalledTimes(1));
    expect(seal).toHaveBeenCalledWith(KEY_CHECK);
    expect(fillFn.mock.calls[0][0]).toEqual({ keyCheck: `e:1:sealed(${KEY_CHECK})` });
    rerender();
    rerender();
    expect(fillFn).toHaveBeenCalledTimes(1);
  });

  it("leaves it to an admin", async () => {
    appState.current.person.isAdmin = false;
    renderHook(() => useFillKeyCheck(), { wrapper });
    await Promise.resolve();
    expect(seal).not.toHaveBeenCalled();
  });

  it("does nothing unless the status flagged the group fillable", async () => {
    appState.current.keyCheckFillable = undefined;
    renderHook(() => useFillKeyCheck(), { wrapper });
    await Promise.resolve();
    expect(seal).not.toHaveBeenCalled();
  });

  it("logs a failure instead of breaking the page", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fillFn.mockRejectedValue(new Error("offline"));
    renderHook(() => useFillKeyCheck(), { wrapper });
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't fill in the group's key check:", expect.any(Error)),
    );
  });
});
