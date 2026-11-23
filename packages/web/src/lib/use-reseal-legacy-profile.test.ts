/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { save, appState } = vi.hoisted(() => ({
  save: vi.fn(),
  appState: {
    current: {
      profileNeedsReseal: undefined as true | undefined,
      person: { name: "Alice", anatomy: "afab" as string | null },
    },
  },
}));

vi.mock("./person-app-context.js", () => ({
  usePersonApp: () => ({ authedStatus: appState.current, codec: {} }),
}));
vi.mock("./use-save-profile.js", () => ({ useSaveProfile: () => ({ save, saving: false }) }));

const { useResealLegacyProfile } = await import("./use-reseal-legacy-profile.js");

beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined);
  appState.current = { profileNeedsReseal: undefined, person: { name: "Alice", anatomy: "afab" } };
});

describe("useResealLegacyProfile", () => {
  it("re-saves (and so re-seals) your own profile when it was read as legacy plaintext", () => {
    appState.current.profileNeedsReseal = true;
    renderHook(() => useResealLegacyProfile());
    expect(save).toHaveBeenCalledExactlyOnceWith({ name: "Alice", anatomy: "afab" });
  });

  it("does nothing when the profile is already sealed properly", () => {
    renderHook(() => useResealLegacyProfile());
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once per mount, however often it re-renders", () => {
    appState.current.profileNeedsReseal = true;
    const { rerender } = renderHook(() => useResealLegacyProfile());
    rerender();
    rerender();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("leaves an empty name to /setup instead of saving it", () => {
    appState.current = { profileNeedsReseal: true, person: { name: "", anatomy: "afab" } };
    renderHook(() => useResealLegacyProfile());
    expect(save).not.toHaveBeenCalled();
  });
});
