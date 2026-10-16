// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/lib/schema";

const moveTodoToList = vi.fn(async () => {});
vi.mock("@/lib/store/repositories", async (orig) => ({
  ...(await orig<typeof import("@/lib/store/repositories")>()),
  moveTodoToList: (...a: unknown[]) => (moveTodoToList as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { useBoardActions } from "./use-board-actions";

const todo = (id: string, listId: string): Todo =>
  ({ id, title: id, listId, scheduledDate: "2026-10-16", status: "open" }) as unknown as Todo;

afterEach(() => {
  cleanup();
  moveTodoToList.mockClear();
});

describe("handleSheetMoveBackToList", () => {
  it("moves only the open to-do, even when it is part of a multi-selection", () => {
    const a = todo("a", "l1");
    const b = todo("b", "l2");
    const clearSelection = vi.fn();
    const data = {
      lists: [{ id: "back", name: "Backlog", isBacklog: true }],
      listsById: new Map([
        ["l1", { id: "l1", name: "One" }],
        ["l2", { id: "l2", name: "Two" }],
      ]),
      tabs: [],
      tabsById: new Map(),
      todosById: new Map([[a.id, a], [b.id, b]]),
      rawTodoIds: new Set(["a", "b"]),
      selectedTodos: [a, b],
      settings: null,
    };
    const ui = { selectedIds: new Set(["a", "b"]), clearSelection, landingTodoIds: new Set(), setLandingTodoIds: vi.fn() };
    const { result } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useBoardActions(data as any, ui as any, false, "desktop"),
    );
    result.current.handleSheetMoveBackToList(a);
    return vi.waitFor(() => {
      expect(moveTodoToList).toHaveBeenCalledTimes(1);
      expect(moveTodoToList).toHaveBeenCalledWith("a", "l1");
      expect(clearSelection).not.toHaveBeenCalled();
    });
  });
});
