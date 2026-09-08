// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMenuOpenCount,
  setMenuOpen,
  useAnyMenuOpen,
  useMenuOpenRegistration,
} from "./menu-open-store";

/**
 * Module state is shared across tests in a file, so every test here leaves the
 * count at zero and the first assertion below proves it started there. A test
 * that inherited a stuck count would otherwise pass or fail for reasons having
 * nothing to do with what it claims to check.
 */
beforeEach(() => {
  expect(getMenuOpenCount()).toBe(0);
});

afterEach(cleanup);

describe("setMenuOpen", () => {
  it("counts overlapping menus", () => {
    setMenuOpen(true);
    setMenuOpen(true);
    expect(getMenuOpenCount()).toBe(2);
    setMenuOpen(false);
    setMenuOpen(false);
    expect(getMenuOpenCount()).toBe(0);
  });

  /**
   * A negative count would report "nothing open" while a menu is genuinely
   * open — the silent form of the exact bug this module exists to prevent.
   */
  it("never goes negative on an unbalanced close", () => {
    setMenuOpen(false);
    setMenuOpen(false);
    expect(getMenuOpenCount()).toBe(0);
  });
});

describe("useAnyMenuOpen", () => {
  it("is false with nothing open", () => {
    const { result } = renderHook(() => useAnyMenuOpen());
    expect(result.current).toBe(false);
  });

  it("tracks the zero crossing in both directions", () => {
    const { result } = renderHook(() => useAnyMenuOpen());
    act(() => setMenuOpen(true));
    expect(result.current).toBe(true);
    act(() => setMenuOpen(false));
    expect(result.current).toBe(false);
  });

  /**
   * The reason the store counts instead of holding a boolean. A submenu
   * opening over its parent, or one menu replacing another, must not re-render
   * the board shell — and must never report "closed" while something is still
   * open.
   */
  it("notifies only when the count crosses zero", () => {
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useAnyMenuOpen();
    });
    const initial = renders.mock.calls.length;

    act(() => setMenuOpen(true)); // 0 -> 1, a real transition
    const afterOpen = renders.mock.calls.length;
    expect(afterOpen).toBeGreaterThan(initial);
    expect(result.current).toBe(true);

    act(() => setMenuOpen(true)); // 1 -> 2, interior
    act(() => setMenuOpen(false)); // 2 -> 1, interior
    expect(renders.mock.calls.length).toBe(afterOpen);
    expect(result.current).toBe(true);

    act(() => setMenuOpen(false)); // 1 -> 0, a real transition
    expect(result.current).toBe(false);
    expect(renders.mock.calls.length).toBeGreaterThan(afterOpen);
  });
});

describe("useMenuOpenRegistration", () => {
  it("ignores a repeated report of the state it is already in", () => {
    const { result } = renderHook(() => useMenuOpenRegistration());
    act(() => result.current(true));
    act(() => result.current(true));
    expect(getMenuOpenCount()).toBe(1);
    act(() => result.current(false));
    act(() => result.current(false));
    expect(getMenuOpenCount()).toBe(0);
  });

  /**
   * The ordinary case, not an edge one: a menu item that deletes its own
   * to-do unmounts the row hosting the menu. Without this, the count stays
   * stuck above zero and board hotkeys stay dead for the rest of the session.
   */
  it("pops on unmount if it was still open", () => {
    const { result, unmount } = renderHook(() => useMenuOpenRegistration());
    act(() => result.current(true));
    expect(getMenuOpenCount()).toBe(1);
    unmount();
    expect(getMenuOpenCount()).toBe(0);
  });

  it("does not pop on unmount if it was already closed", () => {
    setMenuOpen(true); // a second, unrelated menu holds the count up
    const { result, unmount } = renderHook(() => useMenuOpenRegistration());
    act(() => result.current(true));
    act(() => result.current(false));
    expect(getMenuOpenCount()).toBe(1);
    unmount();
    expect(getMenuOpenCount()).toBe(1);
    setMenuOpen(false);
  });
});
