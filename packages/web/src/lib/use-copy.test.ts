/** @vitest-environment happy-dom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopy } from "./use-copy.js";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCopy", () => {
  it("sets copiedIndex after a successful clipboard write", async () => {
    const { result } = renderHook(() => useCopy());
    expect(result.current.copiedIndex).toBeUndefined();

    await act(async () => {
      await result.current.copy("hello", 3);
    });

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copiedIndex).toBe(3);
  });

  it("defaults index to 0 when none is passed", async () => {
    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.copiedIndex).toBe(0);
  });

  it("resets copiedIndex to undefined after resetMs", async () => {
    const { result } = renderHook(() => useCopy(2000));

    await act(async () => {
      await result.current.copy("x", 1);
    });
    expect(result.current.copiedIndex).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.copiedIndex).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copiedIndex).toBeUndefined();
  });

  it("uses a custom resetMs", async () => {
    const { result } = renderHook(() => useCopy(500));

    await act(async () => {
      await result.current.copy("x");
    });
    expect(result.current.copiedIndex).toBe(0);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copiedIndex).toBeUndefined();
  });

  it("restarts the reset timer on a second copy — earlier reset is cancelled", async () => {
    const { result } = renderHook(() => useCopy(1000));

    await act(async () => {
      await result.current.copy("a", 1);
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.copiedIndex).toBe(1);

    // Second copy 200ms before the first would have reset. The first timer
    // must be cancelled — otherwise copiedIndex would flicker to undefined at
    // t=1000 despite the newer copy being in progress.
    await act(async () => {
      await result.current.copy("b", 2);
    });
    expect(result.current.copiedIndex).toBe(2);

    // Advance to where the original timer would have fired.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.copiedIndex).toBe(2);

    // Now advance through the rest of the fresh 1000ms window.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.copiedIndex).toBeUndefined();
  });

  it("clears the pending reset timer on unmount", async () => {
    const { result, unmount } = renderHook(() => useCopy(1000));

    await act(async () => {
      await result.current.copy("x");
    });
    expect(result.current.copiedIndex).toBe(0);

    unmount();

    // If the timer leaked past unmount it would try to setState on an
    // unmounted component. vi.runAllTimers() flushes any pending timers;
    // the test passes if no warnings/errors surface.
    expect(() => {
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
  });
});
