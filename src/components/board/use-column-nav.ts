"use client";

import { useCallback, useRef } from "react";
import {
  resolveNavTarget,
  stopLocation,
  type LastVisited,
  type NavGrid,
  type NavKey,
} from "@/lib/column-nav";

/**
 * The DOM half of arrow-key navigation. The grid math is pure and lives in
 * `lib/column-nav.ts`; this only finds the target node and moves focus to it.
 */
interface UseColumnNavOptions {
  grid: NavGrid;
  /** Day column ids in track order, so a target day can be scrolled to. */
  dayIds: string[];
  /** A card, column or tab drag is in flight — dnd-kit owns the arrows. */
  dragging: boolean;
  /** From `useDayTrack`, so the day track keeps its own scroll arithmetic. */
  anchorIndex: number;
  visibleCount: number;
  jumpToIndex: (target: number) => void;
}

/** Moves focus, returning true when it actually went somewhere. */
export type NavigateFn = (fromStopId: string, key: NavKey) => boolean;

export function useColumnNav({
  grid,
  dayIds,
  dragging,
  anchorIndex,
  visibleCount,
  jumpToIndex,
}: UseColumnNavOptions): NavigateFn {
  /*
    Which column focus was last in, per row, so `↑`/`↓` across the halves
    returns to where you were rather than always to today or Backlog. A ref
    rather than state: nothing renders from it, and it is only ever read inside
    the callback below — never during render, per `react-hooks/refs`.
  */
  const lastVisitedRef = useRef<LastVisited>({ calendar: null, planning: null });

  return useCallback(
    (fromStopId, key) => {
      // dnd-kit owns the arrows mid-drag, and its cached droppable rects are
      // live — same reasoning as `railDisabled` in board.tsx.
      if (dragging) return false;

      const target = resolveNavTarget(grid, fromStopId, key, lastVisitedRef.current);
      if (!target) return false;

      /*
        No `CSS.escape`: a quoted attribute-selector value needs no escaping,
        and every stop id is a generated id, an ISO date or a `nav:` literal.
      */
      const el = document.querySelector<HTMLElement>(`[data-nav-stop="${target}"]`);
      if (!el) return false;

      const at = stopLocation(grid, target);
      if (at) lastVisitedRef.current = { ...lastVisitedRef.current, [at.row]: at.columnKey };

      /*
        Focus first without scrolling, then scroll deliberately. The day track
        owns its horizontal position through `useDayTrack`'s pitch math, and a
        native focus scroll would land it between columns and fight the anchor
        the next `jumpBy` reads.
      */
      el.focus({ preventScroll: true });

      const dayIndex = at ? dayIds.indexOf(at.columnKey) : -1;
      const offScreen =
        dayIndex >= 0 && (dayIndex < anchorIndex || dayIndex >= anchorIndex + visibleCount);
      if (offScreen) jumpToIndex(dayIndex);
      else el.scrollIntoView({ block: "nearest", inline: "nearest" });

      return true;
    },
    [grid, dayIds, dragging, anchorIndex, visibleCount, jumpToIndex],
  );
}
