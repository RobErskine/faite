// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useExitRetained } from "./use-exit-retained";

/**
 * The whole point of the hook is the closing render: `open` has to go false
 * while `value` is still the outgoing thing, because that render is the one
 * that has to draw the overlay on its way out. A test that only checks the
 * open and idle states would pass on a hook that returned `null` the moment
 * the prop cleared — which is the bug this exists to prevent.
 */
afterEach(cleanup);

describe("useExitRetained", () => {
  it("passes the value through while open", () => {
    const { result } = renderHook((v: string | null) => useExitRetained(v), {
      initialProps: "a" as string | null,
    });
    expect(result.current).toEqual({ value: "a", open: true });
  });

  it("keeps the outgoing value on the render that closes", () => {
    const { result, rerender } = renderHook((v: string | null) => useExitRetained(v), {
      initialProps: "a" as string | null,
    });
    rerender(null);
    expect(result.current.open).toBe(false);
    expect(result.current.value).toBe("a");
  });

  it("swaps to the new value when one overlay replaces another", () => {
    const { result, rerender } = renderHook((v: string | null) => useExitRetained(v), {
      initialProps: "a" as string | null,
    });
    rerender("b");
    expect(result.current).toEqual({ value: "b", open: true });
    // ...and that is what is held on the way out, not the first one.
    rerender(null);
    expect(result.current).toEqual({ value: "b", open: false });
  });

  it("reports null before anything has ever opened, so callers can bail", () => {
    const { result } = renderHook((v: string | null) => useExitRetained(v), {
      initialProps: null as string | null,
    });
    expect(result.current).toEqual({ value: null, open: false });
  });

  it("reopens after a close without losing the new value", () => {
    const { result, rerender } = renderHook((v: string | null) => useExitRetained(v), {
      initialProps: "a" as string | null,
    });
    rerender(null);
    rerender("c");
    expect(result.current).toEqual({ value: "c", open: true });
  });
});
