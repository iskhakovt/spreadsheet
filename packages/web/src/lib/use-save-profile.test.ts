/** @vitest-environment happy-dom */
import { Anatomy, fakeEncrypted, PersonName } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec, type GroupCodec } from "./codec.js";
import { generateGroupKey } from "./crypto.js";
import { adoptSession } from "./session.js";

const { setProfileFn, showBoundary } = vi.hoisted(() => ({
  setProfileFn: vi.fn(),
  showBoundary: vi.fn(),
}));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      setProfile: { mutationOptions: (opts?: object) => ({ mutationFn: setProfileFn, ...opts }) },
      status: { pathKey: () => ["groups", "status"] as const },
    },
  }),
}));

vi.mock("react-error-boundary", () => ({ useErrorBoundary: () => ({ showBoundary }) }));

const { useSaveProfile } = await import("./use-save-profile.js");

// A codec whose `seal` the tests control: its output names what was sealed,
// and a test can hold it open or make it fail. The hook only seals.
const seal = vi.fn();
const codec: GroupCodec = {
  encrypted: true,
  keyProven: true,
  markKeyProven: vi.fn(),
  seal,
  open: vi.fn(),
  openOrDrop: vi.fn(),
  tryOpen: vi.fn(),
  openLegacyPlaintext: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  setProfileFn.mockReset().mockResolvedValue({ ok: true });
  showBoundary.mockReset();
  seal.mockReset().mockImplementation(async (v: string) => fakeEncrypted(`sealed(${v})`));
});

describe("useSaveProfile", () => {
  it("seals name and anatomy before sending them", async () => {
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });
    await act(() => result.current.save({ name: "Alice", anatomy: "afab" }));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
    expect(setProfileFn.mock.calls[0][0]).toEqual({ name: "e:1:sealed(Alice)", anatomy: "e:1:sealed(afab)" });
  });

  it("sends null anatomy without sealing it", async () => {
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });
    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(setProfileFn.mock.calls[0][0]).toEqual({ name: "e:1:sealed(Alice)", anatomy: null });
  });

  for (const encrypted of [false, true]) {
    it(`seals in the group's mode, so the group's codec opens what was sent (encrypted: ${encrypted})`, async () => {
      const real = createGroupCodec(encrypted, encrypted ? await generateGroupKey() : null);
      const { result } = renderHook(() => useSaveProfile(real), { wrapper });
      await act(() => result.current.save({ name: "Alice", anatomy: "afab" }));

      const sent = setProfileFn.mock.calls[0][0];
      expect(sent.name.startsWith(encrypted ? "e:1:" : "p:1:")).toBe(true);
      expect(await real.open(sent.name, PersonName)).toBe("Alice");
      expect(await real.open(sent.anatomy, Anatomy)).toBe("afab");
    });
  }

  it("ignores a second save while the first is still sealing", async () => {
    // Hold the seal open: this is the window where the mutation isn't
    // pending yet, so a mutation-state guard alone would let both through.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    seal.mockImplementation(async (v: string) => {
      await gate;
      return fakeEncrypted(`sealed(${v})`);
    });
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });

    // Both clicks land in the same synchronous step, before any re-render,
    // so only a synchronous guard can stop the second.
    let saves!: Promise<void>[];
    act(() => {
      saves = [
        result.current.save({ name: "Alice", anatomy: "afab" }),
        result.current.save({ name: "Alice", anatomy: "amab" }),
      ];
    });
    expect(result.current.saving).toBe(true);

    release();
    await act(() => Promise.all(saves));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
    expect(setProfileFn.mock.calls[0][0].anatomy).toBe("e:1:sealed(afab)");
    expect(result.current.saving).toBe(false);
  });

  it("drops the save if the tab switches to another person's link while sealing", async () => {
    // The request would go out with the new session, writing this profile
    // to the wrong person.
    adoptSession("token-a");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    seal.mockImplementation(async (v: string) => {
      await gate;
      return fakeEncrypted(`sealed(${v})`);
    });
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.save({ name: "Alice", anatomy: "afab" });
    });
    adoptSession("token-b");
    release();
    await act(() => pending);

    expect(setProfileFn).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it("sends a seal failure to the error boundary and allows a retry", async () => {
    const failure = new Error("crypto unavailable");
    seal.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(showBoundary).toHaveBeenCalledWith(failure);
    expect(setProfileFn).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
  });

  it("sends a request failure to the error boundary", async () => {
    const failure = new Error("network down");
    setProfileFn.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSaveProfile(codec), { wrapper });

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(showBoundary).toHaveBeenCalledWith(failure);
    expect(result.current.saving).toBe(false);
  });
});
