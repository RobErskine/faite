import { describe, expect, it } from "vitest";
import type { List, Tab, Todo } from "@/lib/schema";
import { dayGroupId, dayColumnId, overflowColumnId, listColumnId, listDragId, tabDragId } from "@/lib/board";
import { boardDragAnnouncements, type AnnounceEntities } from "./dnd-announcements";

function todo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    title: overrides.id,
    description: null,
    status: "open",
    priority: null,
    scheduledDate: null,
    scheduledAt: null,
    deadline: null,
    listId: null,
    projectId: null,
    labelIds: [],
    location: null,
    parentId: null,
    position: "a0",
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: null,
    placeId: null,
    source: null,
    ...overrides,
  };
}

function list(id: string, name: string): List {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    isBacklog: false,
    archivedAt: null,
    archivedWithTabId: null,
    position: "a0",
    tabId: null,
    defaultReminderPresetId: null,
    description: null,
    color: null,
    emoji: null,
    iconUrl: null,
  };
}

function tab(id: string, name: string): Tab {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    description: null,
    isDefault: false,
    archivedAt: null,
    position: "a0",
    color: null,
    emoji: null,
    iconUrl: null,
  };
}

const tuesdayTodo1 = todo({ id: "t1", title: "Buy milk" });
const tuesdayTodo2 = todo({ id: "t2", title: "Call dentist" });
const overflowTodo = todo({ id: "t3", title: "Overdue thing" });
const brainDumpList = list("l1", "Brain Dump");
const brainDumpTodo = todo({ id: "t4", title: "Brain dump item", listId: brainDumpList.id });

const board: AnnounceEntities["board"] = {
  days: [
    {
      id: dayColumnId("2026-08-11"),
      day: "2026-08-11",
      todos: [tuesdayTodo1, tuesdayTodo2],
      groups: [],
    },
  ],
  overflow: {
    id: overflowColumnId(),
    todos: [overflowTodo],
    groups: [],
  },
  lists: [{ id: listColumnId(brainDumpList.id), list: brainDumpList, todos: [brainDumpTodo] }],
};

const workTab = tab("tab-1", "Work");

const entities: AnnounceEntities = {
  board,
  todosById: new Map(
    [tuesdayTodo1, tuesdayTodo2, overflowTodo, brainDumpTodo].map((t) => [t.id, t]),
  ),
  listsById: new Map([[brainDumpList.id, brainDumpList]]),
  tabsById: new Map([[workTab.id, workTab]]),
};

const announcements = boardDragAnnouncements(entities);

describe("boardDragAnnouncements", () => {
  describe("onDragStart", () => {
    it("names the todo, its source column, and its position", () => {
      const message = announcements.onDragStart?.({
        active: { id: "t1" } as never,
      });
      expect(message).toBe("Buy milk. Picked up from Tuesday, position 1 of 2.");
    });

    it("resolves Overflow by name", () => {
      const message = announcements.onDragStart?.({ active: { id: "t3" } as never });
      expect(message).toBe("Overdue thing. Picked up from Overflow, position 1 of 1.");
    });

    it("resolves a list column by its name", () => {
      const message = announcements.onDragStart?.({ active: { id: "t4" } as never });
      expect(message).toBe("Brain dump item. Picked up from Brain Dump, position 1 of 1.");
    });

    it("falls back to a generic message for an unknown todo id", () => {
      const message = announcements.onDragStart?.({ active: { id: "ghost" } as never });
      expect(message).toBeUndefined();
    });
  });

  describe("onDragOver", () => {
    it("names the column when hovering a day column id", () => {
      const message = announcements.onDragOver?.({
        active: { id: "t3" } as never,
        over: { id: dayColumnId("2026-08-11") } as never,
      });
      expect(message).toBe("Overdue thing is over Tuesday.");
    });

    it("resolves a day-group id to that day", () => {
      const message = announcements.onDragOver?.({
        active: { id: "t3" } as never,
        over: { id: dayGroupId("2026-08-11", brainDumpList.id) } as never,
      });
      expect(message).toBe("Overdue thing is over Tuesday.");
    });

    it("resolves hovering another card to that card's column", () => {
      const message = announcements.onDragOver?.({
        active: { id: "t3" } as never,
        over: { id: "t4" } as never, // Brain Dump list column, ungrouped/sortable
      });
      expect(message).toBe("Overdue thing is over Brain Dump.");
    });

    it("announces leaving every droppable when over is null", () => {
      const message = announcements.onDragOver?.({
        active: { id: "t1" } as never,
        over: null,
      });
      expect(message).toBe("Buy milk is no longer over a droppable area.");
    });
  });

  describe("onDragEnd", () => {
    it("reports the resulting position after a cross-column move", () => {
      // t1 (Tuesday) dropped over t4 (Brain Dump) — Brain Dump had 1 card,
      // so t1 lands at position 1 of 2 once inserted ahead of it.
      const message = announcements.onDragEnd?.({
        active: { id: "t1" } as never,
        over: { id: "t4" } as never,
      });
      expect(message).toBe("Buy milk was dropped in Brain Dump, position 1 of 2.");
    });

    it("reports a same-column reorder position", () => {
      // t2 dropped onto t1 within Tuesday — still 2 cards total, t2 leads.
      const message = announcements.onDragEnd?.({
        active: { id: "t2" } as never,
        over: { id: "t1" } as never,
      });
      expect(message).toBe("Call dentist was dropped in Tuesday, position 1 of 2.");
    });

    it("reports dropping outside any droppable", () => {
      const message = announcements.onDragEnd?.({
        active: { id: "t1" } as never,
        over: null,
      });
      expect(message).toBe("Buy milk was dropped outside of any droppable area.");
    });
  });

  describe("onDragCancel", () => {
    it("names the todo and confirms it stayed in its column", () => {
      const message = announcements.onDragCancel?.({ active: { id: "t1" } as never, over: null });
      expect(message).toBe("Buy milk. Drag cancelled, still in Tuesday.");
    });
  });

  describe("list and tab reorder drags", () => {
    it("announces a list reorder lift and drop", () => {
      const start = announcements.onDragStart?.({
        active: { id: listDragId(brainDumpList.id) } as never,
      });
      expect(start).toBe("Brain Dump list. Picked up for reordering.");

      const end = announcements.onDragEnd?.({
        active: { id: listDragId(brainDumpList.id) } as never,
        over: null,
      });
      expect(end).toBe("Brain Dump list was dropped.");
    });

    it("announces a tab reorder lift and drop by the tab's name", () => {
      const start = announcements.onDragStart?.({
        active: { id: tabDragId(workTab.id) } as never,
      });
      expect(start).toBe("Work tab. Picked up for reordering.");

      const end = announcements.onDragEnd?.({
        active: { id: tabDragId(workTab.id) } as never,
        over: null,
      });
      expect(end).toBe("Work tab was dropped.");
    });

    it("has no over announcement for a reordering drag", () => {
      const message = announcements.onDragOver?.({
        active: { id: listDragId(brainDumpList.id) } as never,
        over: null,
      });
      expect(message).toBeUndefined();
    });
  });
});
