// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("home", 350));
    expect(result.current).toBe("home");
  });

  it("does not emit before the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: "1" },
    });

    rerender({ value: "16" });
    act(() => void vi.advanceTimersByTime(349));

    expect(result.current).toBe("1");
  });

  it("emits once the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: "1" },
    });

    rerender({ value: "16" });
    act(() => void vi.advanceTimersByTime(350));

    expect(result.current).toBe("16");
  });

  it("REGRESSION: collapses a burst of changes into a single emission", () => {
    // This is the cost control for EI-83, not a polish detail — one emission
    // per pause is one billable Google Autocomplete request, and an
    // un-debounced field would bill per keystroke. See `use-place-search.ts`.
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ value }) => {
        seen.push(useDebouncedValue(value, 350));
      },
      { initialProps: { value: "1" } },
    );

    for (const value of ["16", "160", "1600", "1600 A", "1600 Am"]) {
      rerender({ value });
      act(() => void vi.advanceTimersByTime(50));
    }
    act(() => void vi.advanceTimersByTime(350));

    expect(new Set(seen)).toEqual(new Set(["1", "1600 Am"]));
  });

  it("restarts the timer on each change rather than emitting on a fixed schedule", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    act(() => void vi.advanceTimersByTime(300));
    rerender({ value: "abc" });
    act(() => void vi.advanceTimersByTime(300));

    // 600ms total, but never 350ms without a change — nothing has landed yet.
    expect(result.current).toBe("a");

    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toBe("abc");
  });

  it("clears a pending timer on unmount", () => {
    // Without the cleanup, this fires setState into an unmounted component.
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: "a" },
    });

    rerender({ value: "ab" });
    unmount();

    expect(() => act(() => void vi.advanceTimersByTime(1000))).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
