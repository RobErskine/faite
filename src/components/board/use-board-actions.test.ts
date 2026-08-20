import { describe, expect, it } from "vitest";
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
import { collisionDetection, computeAutoScroll } from "./use-board-actions";

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
