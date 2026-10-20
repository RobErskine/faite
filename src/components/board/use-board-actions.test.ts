// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientRect } from "@dnd-kit/core";
import {
  dayColumnId,
  listColumnId,
  listDragId,
  overflowColumnId,
  tabDropId,
  dayGroupId,
  weekendColumnId,
} from "@/lib/board";
import { announceQuickAdd } from "./quick-add-toast";

const createTodo = vi.fn(async (_input: unknown) => "new-id");
vi.mock("@/lib/store/repositories", async (orig) => ({
  ...(await orig<typeof import("@/lib/store/repositories")>()),
  createTodo: (input: unknown) => createTodo(input),
}));
vi.mock("@/lib/smart-sort", async (orig) => ({
  ...(await orig<typeof import("@/lib/smart-sort")>()),
  proposeListForNewTodo: vi.fn(async () => {}),
}));
vi.mock("./quick-add-toast", () => ({ announceQuickAdd: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { collisionDetection, computeAutoScroll, useBoardActions } from "./use-board-actions";

describe("computeAutoScroll", () => {
  it("is off on phone — dnd-kit's incremental scroll fights the pager's scroll-snap", () => {
    expect(computeAutoScroll("phone")).toBe(false);
  });

  it("is on for tablet and desktop", () => {
    expect(computeAutoScroll("tablet")).toBe(true);
    expect(computeAutoScroll("desktop")).toBe(true);
  });
});

/**
 * EI-193 opened `collisionDetection`'s `listdrag:` branch to day columns. That
 * branch is a hard filter — anything it does not name is invisible to a list
 * drag, silently — so the precedence is worth pinning even though the rest of
 * dnd-kit's collision machinery is untestable without layout.
 *
 * A real pointer is simulated by handing every candidate the same rect and
 * putting `pointerCoordinates` inside it, so `pointerWithin` returns them all
 * and the branch's own `find` order is what decides the winner.
 */
describe("collisionDetection: what a list drag can land on", () => {
  const rect: ClientRect = {
    top: 0,
    left: 0,
    bottom: 100,
    right: 100,
    width: 100,
    height: 100,
  };

  const resolve = (ids: string[]) => {
    const containers = new Map(
      ids.map((id) => [id, { id, rect: { current: rect }, data: { current: {} }, disabled: false }]),
    );
    const result = collisionDetection({
      active: { id: listDragId("grocery"), rect: { current: { initial: rect, translated: rect } }, data: { current: {} } },
      collisionRect: rect,
      droppableRects: new Map(ids.map((id) => [id, rect])),
      droppableContainers: [...containers.values()],
      pointerCoordinates: { x: 50, y: 50 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return result.map((c) => String(c.id));
  };

  it("prefers a list column over everything else", () => {
    expect(resolve([dayColumnId("2026-08-14"), tabDropId("work"), listColumnId("brain")])).toEqual([
      listColumnId("brain"),
    ]);
  });

  it("falls back to a tab pill when no list column is under the pointer", () => {
    expect(resolve([dayColumnId("2026-08-14"), tabDropId("work")])).toEqual([tabDropId("work")]);
  });

  it("resolves a day column when neither a list column nor a pill is there", () => {
    expect(resolve([dayColumnId("2026-08-14")])).toEqual([dayColumnId("2026-08-14")]);
  });

  it("refuses Overflow — it parses as `overflow`, never `day`", () => {
    expect(resolve([overflowColumnId()])).toEqual([]);
  });

  it("resolves a day GROUP up to its containing day column", () => {
    // A group is a statement about a list, and a list is what's in flight —
    // so the day is the only meaningful answer here.
    const day = dayColumnId("2026-08-14");
    expect(resolve([dayGroupId("2026-08-14", "grocery"), day])).toEqual([day]);
  });

  it("refuses a collapsed weekend strip", () => {
    expect(resolve([weekendColumnId("2026-08-15")])).toEqual([]);
  });

  it("refuses a bare card id", () => {
    expect(resolve(["some-todo-uuid"])).toEqual([]);
  });
});

/**
 * EI-426: `handleQuickAdd` resolves the assignee the same way the preview
 * does, and a menu pick outranks whatever the text named.
 */
describe("handleQuickAdd: assignees (EI-426)", () => {
  afterEach(() => {
    cleanup();
    createTodo.mockClear();
    vi.mocked(announceQuickAdd).mockClear();
  });

  const assignees = [
    { id: "instinct", name: "Instinct", kind: "agent" },
    { id: "mom", name: "Mom", kind: "person" },
  ];

  const add = async (
    input: string,
    picked?: string,
    literals?: readonly string[],
  ) => {
    const back = { id: "back", name: "Backlog", isBacklog: true };
    const data = {
      lists: [back],
      listsById: new Map([["back", back]]),
      tabs: [],
      tabsById: new Map(),
      todosById: new Map(),
      rawTodoIds: new Set<string>(),
      selectedTodos: [],
      settings: null,
      assignees,
      reminderPresets: [],
      ctx: { today: "2026-10-20" },
    };
    const ui = { selectedIds: new Set<string>(), landingTodoIds: new Set(), setLandingTodoIds: vi.fn() };
    const { result } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useBoardActions(data as any, ui as any, false, "desktop"),
    );
    await result.current.handleQuickAdd(input, { listId: "back" }, undefined, [], literals, picked);
    return createTodo.mock.calls[0][0] as { title: string; assigneeId: string | null };
  };

  it("'for <agent>' assigns it and strips the words from the title", async () => {
    const created = await add("write email to daycare for Instinct");
    expect(created.title).toBe("write email to daycare");
    expect(created.assigneeId).toBe("instinct");
    expect(announceQuickAdd).toHaveBeenCalledWith("new-id", "write email to daycare", {
      message: "Added to Backlog · Instinct",
      note: null,
    });
  });

  it("'for <person>' stays in the title with no assignee", async () => {
    const created = await add("buy gift for Mom");
    expect(created.title).toBe("buy gift for Mom");
    expect(created.assigneeId).toBeNull();
  });

  it("a dismissed 'for <agent>' stays in the title", async () => {
    const created = await add("write email for Instinct", undefined, ["for Instinct"]);
    expect(created.title).toBe("write email for Instinct");
    expect(created.assigneeId).toBeNull();
  });

  it("a picked assignee sets assigneeId", async () => {
    const created = await add("call", "mom");
    expect(created.assigneeId).toBe("mom");
  });

  it("a picked assignee outranks a typed 'for <agent>'", async () => {
    const created = await add("write email for Instinct", "mom");
    expect(created.assigneeId).toBe("mom");
    expect(created.title).toBe("write email for Instinct");
  });
});
