// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeModalOpen, useBoardUiState, type BoardOverlayState } from "./use-board-ui-state";

/**
 * EI-149: `?todo=<id>` / `?day=<date>` deep links. Follows
 * `use-viewport.test.ts`'s convention for exercising a query-param reader —
 * `window.history.pushState` to set the URL before mounting the hook, a
 * manual reset back to a bare `/board` between tests (this app has no
 * per-test jsdom reset).
 *
 * `board-guards.test.ts` already locks down `computeModalOpen`'s full
 * contract; the one test here that touches it ("an unresolvable id...")
 * exists only to prove the deep-link path composes with that contract
 * exactly like every other opener does, not to re-litigate it.
 */

const CLOSED: BoardOverlayState = {
  paletteOpen: false,
  openTodoExists: false,
  infoListId: null,
  infoTabId: null,
  archivedOpen: false,
  settingsOpen: false,
  openDay: null,
  overdriveOpen: false,
  helpSheetOpen: false,
  activityOpen: false,
};

describe("useBoardUiState deep links (EI-149)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/board");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/board");
  });

  it("opens the todo sheet from ?todo=<id> on mount", () => {
    window.history.pushState({}, "", "/board?todo=todo-1");

    const { result } = renderHook(() => useBoardUiState());

    expect(result.current.openTodoId).toBe("todo-1");
    expect(result.current.openDay).toBeNull();
  });

  it("opens the day view from ?day=<date> on mount", () => {
    window.history.pushState({}, "", "/board?day=2026-08-13");

    const { result } = renderHook(() => useBoardUiState());

    expect(result.current.openDay).toBe("2026-08-13");
    expect(result.current.openTodoId).toBeNull();
  });

  it("ignores a malformed ?day= value rather than crashing", () => {
    window.history.pushState({}, "", "/board?day=not-a-date");

    const { result } = renderHook(() => useBoardUiState());

    expect(result.current.openDay).toBeNull();
  });

  it("a ?todo= id wins over a simultaneous ?day= (matches board.tsx's own day-to-todo handoff)", () => {
    window.history.pushState({}, "", "/board?todo=todo-1&day=2026-08-13");

    const { result } = renderHook(() => useBoardUiState());

    expect(result.current.openTodoId).toBe("todo-1");
    expect(result.current.openDay).toBeNull();
  });

  it("an unresolvable ?todo= id mounts cleanly and leaves computeModalOpen false", () => {
    window.history.pushState({}, "", "/board?todo=does-not-exist");

    // The hook itself has no way to know the id is dead — resolving it is
    // `data.openTodo`'s job in board.tsx, wired as `openTodoExists: !!data.openTodo`.
    // Mounting must not throw or hang even though the id resolves to nothing.
    const { result } = renderHook(() => useBoardUiState());

    expect(result.current.openTodoId).toBe("does-not-exist");
    expect(computeModalOpen({ ...CLOSED, openTodoExists: false })).toBe(false);
  });

  it("writes ?todo= via replaceState, never pushState, when the todo sheet opens", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const lengthBefore = window.history.length;

    const { result } = renderHook(() => useBoardUiState());

    act(() => {
      result.current.openTodoSheet("todo-42");
    });

    expect(window.location.search).toBe("?todo=todo-42");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("clears ?todo= via replaceState, never pushState, when the todo sheet closes", () => {
    window.history.pushState({}, "", "/board?todo=todo-9");
    const { result } = renderHook(() => useBoardUiState());
    expect(result.current.openTodoId).toBe("todo-9");

    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const lengthBefore = window.history.length;

    act(() => {
      result.current.closeTodoSheet();
    });

    expect(window.location.search).toBe("");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("writes ?day= via replaceState, never pushState, when the day sheet opens", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    const { result } = renderHook(() => useBoardUiState());

    act(() => {
      result.current.setOpenDay("2026-08-14");
    });

    expect(window.location.search).toBe("?day=2026-08-14");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("preserves unrelated query params (e.g. ?layout=) when writing a deep link", () => {
    window.history.pushState({}, "", "/board?layout=phone");
    const { result } = renderHook(() => useBoardUiState());

    act(() => {
      result.current.openTodoSheet("todo-7");
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("layout")).toBe("phone");
    expect(params.get("todo")).toBe("todo-7");
  });

  it("responds to popstate by updating openTodoId/openDay from the restored URL", () => {
    const { result } = renderHook(() => useBoardUiState());

    act(() => {
      result.current.openTodoSheet("todo-1");
    });
    expect(result.current.openTodoId).toBe("todo-1");

    // Simulate the browser restoring an earlier/adjacent history entry —
    // real back/forward navigation changes `location` first and THEN fires
    // `popstate`, so the handler under test reads the URL fresh rather than
    // trusting the event.
    act(() => {
      window.history.replaceState({}, "", "/board?day=2026-08-15");
      window.dispatchEvent(new Event("popstate"));
    });

    expect(result.current.openTodoId).toBeNull();
    expect(result.current.openDay).toBe("2026-08-15");
  });

  it("popstate back to a bare URL closes both the todo and day sheets", () => {
    const { result } = renderHook(() => useBoardUiState());

    act(() => {
      result.current.setOpenDay("2026-08-15");
    });
    expect(result.current.openDay).toBe("2026-08-15");

    act(() => {
      window.history.replaceState({}, "", "/board");
      window.dispatchEvent(new Event("popstate"));
    });

    expect(result.current.openTodoId).toBeNull();
    expect(result.current.openDay).toBeNull();
  });
});
