// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBoardData } from "./use-board-data";
import { getDb, resetDbForTests } from "@/lib/store/db";
import { serializeRule } from "@/lib/recurrence";
import { occurrenceId } from "@/lib/recurrence";
import { todayIn } from "@/lib/scheduling";
import type { Todo } from "@/lib/schema";

/**
 * EI-341's wiring, against a real Dexie.
 *
 * `collapseRecurringSeries` is unit-tested in `lib/search.test.ts` and the
 * palette's rendering of a collapsed set in `command-palette.test.tsx`. What
 * neither can see is the seam between them: that `searchableTodos` reads the
 * recurrence EXPANSION rather than the raw table, which is the whole bug —
 * the next occurrence of a weekly chore is virtual, so a `searchableTodos`
 * built from `useTodos()` would collapse correctly and still only ever offer
 * finished Wednesdays.
 */

const base = (overrides: Partial<Todo> & { id: string }): Todo => ({
  ownerId: "local-user",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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
});

const PARAMS = {
  activeTodo: null,
  overId: null,
  activeList: null,
  activeTab: null,
  infoListId: null,
  infoTabId: null,
  openTodoId: null,
  collapsedGroups: new Set<string>(),
  expandedWeekends: new Set<string>(),
  columnFilters: new Map<string, string>(),
  selectedIds: new Set<string>(),
  activeSelectionIds: null,
  horizon: 30,
  cap: 365,
  layout: "desktop" as const,
};

/**
 * Days from today, as a CivilDate, in the zone the board will actually use.
 *
 * Read from `Intl` rather than hardcoded to UTC because that is exactly what
 * `seedIfEmpty` writes into `settings.timezone`, and the board computes
 * "today" from that. Pinning this to UTC instead makes every date assertion
 * below wrong for the hours each day when the host's civil date and UTC's
 * disagree — a test that passes all morning and fails after dinner.
 */
function dayOffset(days: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = todayIn(zone);
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

afterEach(cleanup);
beforeEach(async () => {
  await resetDbForTests();
});

describe("useBoardData — searchableTodos (EI-341)", () => {
  /**
   * A weekly series that has been ticked off three times, with nothing
   * materialized for the occurrence still to come — the shape of the bug.
   *
   * `startOffset` is the series start relative to today, so the caller
   * chooses where the fourth (unsettled) occurrence lands: -21 puts it on
   * today, -20 puts it tomorrow.
   */
  async function seedWeeklyChore(startOffset = -21) {
    const templateId = "series-trash";
    const nextDate = dayOffset(startOffset + 21);

    await getDb().todos.bulkPut([
      base({
        id: templateId,
        title: "Take down trash",
        scheduledDate: dayOffset(startOffset),
        recurrenceRule: serializeRule({
          v: 1,
          freq: "weekly",
          interval: 1,
          byDay: [],
          anchor: "scheduled",
          until: null,
          count: null,
        }),
      }),
      ...[startOffset, startOffset + 7, startOffset + 14].map((offset) =>
        base({
          id: occurrenceId(templateId, dayOffset(offset)),
          title: "Take down trash",
          status: "done",
          scheduledDate: dayOffset(offset),
          recurrenceParentId: templateId,
          completedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
      base({ id: "one-off", title: "File taxes", status: "done" }),
    ]);

    return { templateId, nextDate };
  }

  it("offers the next occurrence, which has no row of its own, and none of the finished ones", async () => {
    const { templateId, nextDate } = await seedWeeklyChore(-20);

    const { result } = renderHook(() => useBoardData(PARAMS));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() =>
      expect(
        result.current.searchableTodos.filter((t) => t.recurrenceParentId === templateId),
      ).toHaveLength(1),
    );

    const [row] = result.current.searchableTodos.filter(
      (t) => t.recurrenceParentId === templateId,
    );
    expect(row.status).toBe("open");
    expect(row.scheduledDate).toBe(nextDate);
    expect(row.title).toBe("Take down trash");

    // The row it offers is virtual: nothing in Dexie carries that id.
    expect(await getDb().todos.get(row.id)).toBeUndefined();
  });

  it("never offers the template itself, which renders nowhere", async () => {
    const { templateId } = await seedWeeklyChore();

    const { result } = renderHook(() => useBoardData(PARAMS));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.searchableTodos.some((t) => t.id === templateId)).toBe(false);
  });

  it("offers the occurrence due TODAY, rather than skipping ahead to the next one", async () => {
    const { templateId } = await seedWeeklyChore(-21);

    const { result } = renderHook(() => useBoardData(PARAMS));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() =>
      expect(
        result.current.searchableTodos.filter((t) => t.recurrenceParentId === templateId),
      ).toHaveLength(1),
    );

    const [row] = result.current.searchableTodos.filter(
      (t) => t.recurrenceParentId === templateId,
    );
    expect(row.scheduledDate).toBe(dayOffset(0));
    expect(row.status).toBe("open");
  });

  it("leaves an ordinary completed to-do in place", async () => {
    await seedWeeklyChore();

    const { result } = renderHook(() => useBoardData(PARAMS));

    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() =>
      expect(result.current.searchableTodos.some((t) => t.id === "one-off")).toBe(true),
    );
  });
});
