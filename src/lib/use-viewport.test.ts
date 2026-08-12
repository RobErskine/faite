// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLayout, useViewport } from "./use-viewport";

describe("resolveLayout", () => {
  it("is phone below the 640px floor — the two-half board's arithmetic breaks under it (mobile plan Decision 1)", () => {
    expect(resolveLayout(0)).toBe("phone");
    expect(resolveLayout(639)).toBe("phone");
  });

  it("is tablet from 640 up to (not including) 1024", () => {
    expect(resolveLayout(640)).toBe("tablet");
    expect(resolveLayout(1023)).toBe("tablet");
  });

  it("is desktop at 1024 and above", () => {
    expect(resolveLayout(1024)).toBe("desktop");
    expect(resolveLayout(2560)).toBe("desktop");
  });
});

/**
 * A minimal fake `matchMedia`: listeners are keyed by query string and
 * shared across every `matchMedia(query)` call for that string — matching
 * real browsers, where distinct `MediaQueryList` objects for the same query
 * all observe the same underlying state. `useViewport` calls
 * `window.matchMedia(query)` more than once for the same query (once in
 * `getSnapshot`, once in `subscribe`) precisely because real browsers permit
 * that; a fake that handed back a fresh, disconnected listener set per call
 * would silently orphan whichever registration happened first.
 */
function fakeMatchMedia(initial: Record<string, boolean>) {
  const state = { ...initial };
  const listeners = new Map<string, Set<() => void>>();
  const listenersFor = (query: string) => {
    let set = listeners.get(query);
    if (!set) {
      set = new Set();
      listeners.set(query, set);
    }
    return set;
  };
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return state[query] ?? false;
    },
    media: query,
    addEventListener: (_type: string, cb: () => void) => listenersFor(query).add(cb),
    removeEventListener: (_type: string, cb: () => void) => listenersFor(query).delete(cb),
  }));
  return {
    matchMedia,
    set(query: string, matches: boolean) {
      state[query] = matches;
      listenersFor(query).forEach((cb) => cb());
    },
  };
}

const COARSE = "(pointer: coarse)";
const HOVER = "(hover: hover)";

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

describe("useViewport", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("classifies layout from width, and reads coarse/hover from matchMedia", () => {
    setInnerWidth(1440);
    const media = fakeMatchMedia({ [COARSE]: false, [HOVER]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);

    const { result } = renderHook(() => useViewport());

    expect(result.current).toEqual({ layout: "desktop", coarse: false, hover: true });
  });

  it("re-renders when the viewport is resized", () => {
    setInnerWidth(1440);
    const media = fakeMatchMedia({ [COARSE]: false, [HOVER]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);

    const { result } = renderHook(() => useViewport());
    expect(result.current.layout).toBe("desktop");

    act(() => {
      setInnerWidth(390);
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.layout).toBe("phone");
  });

  it("re-renders when pointer/hover capability changes (e.g. a touchscreen is docked)", () => {
    setInnerWidth(1440);
    const media = fakeMatchMedia({ [COARSE]: false, [HOVER]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);

    const { result } = renderHook(() => useViewport());
    expect(result.current.coarse).toBe(false);

    act(() => {
      media.set(COARSE, true);
    });

    expect(result.current.coarse).toBe(true);
    // Width didn't change, so layout — a separate axis — shouldn't either.
    expect(result.current.layout).toBe("desktop");
  });

  it("a `?layout=` override wins over the measured width", () => {
    window.history.pushState({}, "", "/board?layout=phone");
    setInnerWidth(1440);
    const media = fakeMatchMedia({ [COARSE]: false, [HOVER]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);

    const { result } = renderHook(() => useViewport());

    expect(result.current.layout).toBe("phone");

    window.history.pushState({}, "", "/board");
  });

  it("ignores an unrecognized `?layout=` value and falls back to measured width", () => {
    window.history.pushState({}, "", "/board?layout=huge");
    setInnerWidth(1440);
    const media = fakeMatchMedia({ [COARSE]: false, [HOVER]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);

    const { result } = renderHook(() => useViewport());

    expect(result.current.layout).toBe("desktop");

    window.history.pushState({}, "", "/board");
  });
});
