"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DropAnimationFunctionArguments,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import type { List, Tab, Todo } from "@/lib/schema";
import { celebrate, type ConfettiOrigin } from "@/lib/celebrate";
import { effectiveListColor } from "@/lib/colors";
import {
  parseColumnId,
  parseDayGroupId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  parseWeekendColumnId,
  planListDayDrop,
  rangeSelectionIds,
  planListDrop,
  planListTabDrop,
  planTabDrop,
  preferPreciseTarget,
} from "@/lib/board";
import {
  FLIGHT_MS,
  readLandingRect,
  runLandingDropAnimation,
} from "@/lib/drop-animation";
import {
  positionForDropOnItem,
  positionForIndex,
  positionsForDropOnItem,
} from "@/lib/ordering";
import { OVERFLOW, addDays, formatShortDate } from "@/lib/scheduling";
import { parseQuickAdd } from "@/lib/quick-add";
import {
  nextOccurrenceAfter,
  parseOccurrenceId,
  parseRule,
  summarizeRule,
  type RecurrenceRule,
} from "@/lib/recurrence";
import {
  createSeriesFromTodo,
  createSubtask,
  createTodo,
  deleteSeries,
  deleteTodo,
  dayGroupPatch,
  listPatch,
  materializeOccurrence,
  moveTodoToDayGroup,
  moveTodoToList,
  retargetSeries,
  schedulePatch,
  scheduleTodo,
  setSeriesUntil,
  setTodoStatus,
  statusPatch,
  toggleTodoLabel,
  updateList,
  updateTab,
  updateTodo,
} from "@/lib/store/repositories";
import { now } from "@/lib/store/mutate";
import type { Verdict } from "@/lib/overdrive";
import {
  appendUndoSteps,
  attachEventIds,
  createUndoStep,
  inversePatch,
  pushUndo,
  undoById,
} from "@/lib/undo";
import type { ListPatch } from "./list-info-dialog";
import {
  archiveListWithUndo,
  deleteListWithUndo,
  updateListWithUndo,
} from "./list-actions";
import type { TabPatch } from "./tab-info-dialog";
import {
  archiveTabWithUndo,
  createTabWithUndo,
  deleteTabWithUndo,
  updateTabWithUndo,
} from "./tab-actions";
import type { BoardData } from "./use-board-data";
import { EMPTY_LANDING, type BoardUiState } from "./use-board-ui-state";

/**
 * How long a card must hover a tab before it focuses.
 *
 * Long enough that sweeping across the strip on the way somewhere else does
 * not cycle through every tab, short enough that it does not feel stuck. The
 * gesture is only discoverable once it fires, so erring long would hide it.
 */
const TAB_FOCUS_DWELL_MS = 600;

/**
 * How long a card must hover a collapsed weekend strip before it opens.
 *
 * Deliberately the same number as the tab dwell above, and for the same
 * reason: both are "hovering here reveals somewhere else to drop", and two
 * different delays for one idea would teach the hand two timings.
 */
const WEEKEND_EXPAND_DWELL_MS = TAB_FOCUS_DWELL_MS;

/**
 * Resolve the drop target from the POINTER, not the dragged element's box.
 *
 * closestCorners measures the dragged rect's corners against each droppable's
 * corners. The drag overlay is far wider than a column gutter, so when it
 * straddles a boundary its corners can be equidistant from two columns and the
 * winner flip-flops — or resolves to a column the cursor was never over. The
 * item then appears to hover between two zones, droppable in neither.
 *
 * pointerWithin asks the only question that matches the user's intent: what is
 * under the cursor? Columns fill their half's full height, so any point inside
 * one resolves to it.
 *
 * closestCorners stays as the fallback for two cases where there is no pointer
 * to consult: the few pixels of container padding that belong to no column,
 * and keyboard drags, which have no pointer coordinates at all. Without the
 * fallback, dragging with the keyboard would find no target whatsoever.
 */
export const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  const hasRealPointer = underPointer.length > 0;

  /**
   * No real pointer: a keyboard drag, or the initial frame before any
   * pointer/keyboard event. Simulate one at the CENTER of the virtual drag
   * position rather than falling straight to `closestCorners`'s averaged
   * corner-distance.
   *
   * `closestCorners` structurally favors a small card's rect over a large,
   * empty column's rect even when the column is the nearer of the two — its
   * far corners drag the average up, and a nearby card's corners cluster
   * tight around a point regardless of which column is genuinely closest.
   * That is EI-114: arrow-key navigation cannot land on an empty column
   * sitting between two populated ones, and cannot cross from the pinned
   * Backlog rail into the calendar half, because the corner-averaged winner
   * is not the geometric neighbor. `pointerWithin`'s own "what actually
   * contains this point" test has no such bias, and — for free — already
   * nests card > group > column correctly when more than one rect contains
   * the point, exactly as it does for a real pointer. `keyboardCoordinates`
   * below places the virtual position at a column's CENTER specifically so
   * this containment test lands unambiguously inside it rather than near an
   * edge shared with a neighbor.
   */
  const centerX = (args.collisionRect.left + args.collisionRect.right) / 2;
  const centerY = (args.collisionRect.top + args.collisionRect.bottom) / 2;
  const virtual = hasRealPointer
    ? []
    : pointerWithin({ ...args, pointerCoordinates: { x: centerX, y: centerY } });
  const hasVirtualPointer = virtual.length > 0;

  const collisions = hasRealPointer
    ? underPointer
    : hasVirtualPointer
      ? virtual
      : closestCorners(args); // the few px of container padding no droppable covers

  /**
   * A column drag wants the opposite answer to a card drag. The pointer is
   * inside a column *and* the cards within it, and for reordering columns the
   * cards are noise — only the column is a meaningful reference point.
   *
   * A tab pill is also a valid target here, unlike for a card (EI-115):
   * hovering one focuses that tab, mirroring §4.10b's card gesture, so a
   * dragged list can be carried to another tab and dropped among its columns
   * — or directly on the pill itself, which lands it at the end of that
   * tab's track. Preferring the column over the pill when both are under the
   * pointer keeps ordinary reordering (pointer over a column, pill nowhere
   * near it) unaffected.
   */
  if (parseListDragId(String(args.active.id))) {
    const column = collisions.find((c) => parseColumnId(String(c.id))?.kind === "list");
    if (column) return [column];
    const pill = collisions.find((c) => parseTabDropId(String(c.id)));
    if (pill) return [pill];
    /*
     * A day column schedules the list's unscheduled to-dos onto it (EI-193,
     * §4.10e). Appended LAST on purpose: a list column and a day column live
     * in different halves and can never both be under the pointer, so every
     * case that resolved before this shipped still resolves identically.
     *
     * `kind === "day"` also decides three things by omission, and each is the
     * behaviour we want rather than an oversight:
     *   - Overflow parses as `{kind:"overflow"}`, so it refuses a list drop
     *     exactly as it refuses a card drop (§5.1).
     *   - A day GROUP is a `daygroup:` id, outside `parseColumnId` entirely,
     *     so hovering one resolves to the day column containing it. The
     *     arriving to-dos then group under their own list, which is right —
     *     a group is a statement about a list, and the list is what is in
     *     flight.
     *   - A collapsed weekend strip is a `weekend:` id, also outside
     *     `parseColumnId`, so nothing highlights and nothing writes. The
     *     hover-to-expand dwell is gated on `activeTodo`; extending it to
     *     list drags is deliberately left for later (§7).
     */
    const day = collisions.find((c) => parseColumnId(String(c.id))?.kind === "day");
    return day ? [day] : [];
  }

  /**
   * A tab drag only ever means something over another tab. Filtering to the
   * strip is what keeps dragging a tab down across the columns a no-op instead
   * of resolving to whichever column happens to be under the pointer.
   */
  if (parseTabDragId(String(args.active.id))) {
    const pill = collisions.find((c) => parseTabDropId(String(c.id)));
    return pill ? [pill] : [];
  }

  /**
   * A card can never usefully collide with itself. Its own droppable stays
   * registered at its ORIGINAL position for the whole drag — a keyboard drag
   * never moves the source node, only the overlay — so once the virtual
   * position lands back near it, `closestCorners`'s fallback would otherwise
   * find it: `preferPreciseTarget` treats any card as more precise than a
   * column, and the dragged card is a card. `over` would then silently
   * resolve back to the item being dragged, which reads as nothing having
   * happened — the root cause of EI-114 (arrow-key drag stalling at a
   * column boundary instead of crossing it).
   */
  const withoutSelf = collisions.filter((c) => String(c.id) !== String(args.active.id));

  /**
   * `preferPreciseTarget`'s "a card always beats a column" precedence (§4.3)
   * is safe whenever the collisions came from an actual containment test —
   * real pointer or the synthetic one above — because containment is what
   * makes "prefer the more precise one" a meaningful question in the first
   * place. It is NOT safe over a raw `closestCorners` ranking (the padding
   * fallback just below): that list is sorted by distance to a point
   * nothing actually contains, so "the first card anywhere in it" is not
   * "the nearest thing", and applying the precedence there would resurrect
   * the same bias this function exists to avoid.
   */
  if (!hasRealPointer && !hasVirtualPointer) {
    return withoutSelf.length > 0 ? [withoutSelf[0]] : withoutSelf;
  }

  const target = preferPreciseTarget(withoutSelf);
  return target ? [target] : withoutSelf;
};

/**
 * `sortableKeyboardCoordinates`, corrected for a column it skips over.
 *
 * That function (and dnd-kit's `closestCorners` fallback it delegates to)
 * scores every candidate by AVERAGING the distance across all 4 corners. An
 * empty column is a real, full-height droppable — `BoardColumn` registers
 * `useDroppable` unconditionally (§ board-column.tsx) — but it has no card
 * inside to pull that average down, so a *populated* column one track farther
 * away routinely wins: its first card is a small, tightly-cornered rect, and
 * a small rect near a point can out-score a large rect whose far corners drag
 * its average up, even when the large rect's near edge is the closer of the
 * two. That is EI-114: arrow-key navigation silently steps over an empty
 * list column, or never crosses from the pinned Backlog rail into a day
 * column, because the corner-averaged winner is not the geometric neighbor.
 *
 * `Left`/`Right` is column-to-column movement in this board — every track
 * (day or list) lays its columns out in one horizontal row — so this wrapper
 * takes over there entirely rather than conditionally patching the stock
 * result: scoring candidates by the LEADING EDGE in the pressed direction
 * instead of the 4-corner average (exactly "how far is this column's near
 * edge", immune to a big rect's far corners), restricted to whole-column
 * droppables in the SAME row as the current position, excluding whichever
 * one already contains it. That always identifies the true geometric
 * neighbor, independent of whatever the stock algorithm's own internal
 * state (its `over`-repeat escape hatch, see the source) would have done on
 * this press — deferring to it even conditionally let its corner-distance
 * bias leak back in a few columns later, once the position was no longer
 * sitting exactly where the last override left it (see EI-114 for the
 * repro that caught this: overriding only when the stock pick fell outside
 * the target column reliably fixed press 1 and then wandered into an
 * unrelated day column by press 3). It also lands at the target's CENTER,
 * not its top-left corner: `collisionRect` keeps the dragged CARD's own
 * (small) size after the move — dnd-kit translates the active element, it
 * does not resize it to match the target — and a card-sized rect sitting at
 * a column's corner can have an edge only a few px from a neighboring
 * column's first card, which is exactly the corner-distance trap this
 * function exists to avoid, except now inside `collisionDetection`'s own
 * synthetic-pointer test one layer downstream. Landing precision on a
 * specific sibling card (rather than "append to this column") is given up
 * for `Left`/`Right`'s cross-column case — no currently-relied-on keyboard
 * path needs it, per the manual checklist in docs/DRAG-AND-DROP.md.
 *
 * `Up`/`Down` (in-column reorder, and crossing from the pinned Backlog rail
 * into the calendar half) is untouched — that gap is closed by
 * `collisionDetection` excluding self-collision above, not by this — and
 * still needs sibling-card precision for in-column reordering, which this
 * function does not provide.
 *
 * Column *reorder* (`listdrag:`) and tab *reorder* (`tabdrag:`) keyboard
 * drags fall straight through to the stock getter: neither is exercised by
 * this fix (see docs/DRAG-AND-DROP.md §7 item 7), and this wrapper's
 * "column-level droppable" reasoning does not apply to them.
 */
export const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") {
    return sortableKeyboardCoordinates(event, args);
  }

  const { active, collisionRect, droppableRects, droppableContainers } = args.context;
  if (!active || !collisionRect) return sortableKeyboardCoordinates(event, args);
  if (parseListDragId(String(active.id)) || parseTabDragId(String(active.id))) {
    return sortableKeyboardCoordinates(event, args);
  }

  const centerX = (collisionRect.left + collisionRect.right) / 2;
  const centerY = (collisionRect.top + collisionRect.bottom) / 2;

  let best: { left: number; top: number; right: number; bottom: number; gap: number } | null = null;
  for (const entry of droppableContainers.getEnabled()) {
    if (!entry || entry.disabled) continue;
    if (!parseColumnId(String(entry.id))) continue; // whole-column droppables only
    const rect = droppableRects.get(entry.id);
    if (!rect) continue;

    // Same track only: a day column and a list column never share a row.
    if (rect.top >= collisionRect.bottom || rect.bottom <= collisionRect.top) continue;

    // The column already containing the virtual position is not a move.
    if (rect.left <= centerX && rect.right >= centerX && rect.top <= centerY && rect.bottom >= centerY) continue;

    /**
     * CENTER, not edge, decides which side a candidate is on. The drag
     * overlay is tilted and scaled (§4.7/EI-114's own `LIFTED` styling), so
     * its edges land a few px past the real card's — an edge-to-edge gap can
     * go negative for the very next column over, wrongly reading as "behind"
     * the drag position rather than "immediately adjacent". Center comparison
     * is unaffected by that few-px overhang.
     */
    const rectCenterX = (rect.left + rect.right) / 2;
    if (event.code === "ArrowRight" ? rectCenterX <= centerX : rectCenterX >= centerX) continue;

    // Still scored by leading-edge gap (may be slightly negative from the
    // overlay overhang above) — closest edge wins among same-side candidates.
    const gap = event.code === "ArrowRight" ? rect.left - collisionRect.right : collisionRect.left - rect.right;
    if (!best || gap < best.gap) {
      best = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, gap };
    }
  }

  // No column at all in the pressed direction on this track — end of row.
  if (!best) return sortableKeyboardCoordinates(event, args);

  const width = collisionRect.right - collisionRect.left;
  const height = collisionRect.bottom - collisionRect.top;
  return {
    x: (best.left + best.right) / 2 - width / 2,
    y: (best.top + best.bottom) / 2 - height / 2,
  };
};

const STATUS_VERB: Record<Todo["status"], string> = {
  open: "Reopened",
  done: "Completed",
  dropped: "Dropped",
};

/**
 * Off on phone, on everywhere else. Incremental auto-scroll (dnd-kit's
 * default) nudges the track a few pixels per frame as a drag nears the
 * edge — fine against ordinary `overflow-x: auto`, but fighting a
 * `scroll-snap-type: mandatory` pager it judders, since the snap engine
 * keeps trying to pull the fractional scroll position back to a page
 * boundary every frame the auto-scroll moves it away from one. Dragging
 * a card to a day/list off the current page happens through the row `⋯`
 * action sheet on phone instead (P4) — a more reliable interaction than
 * blind-dragging toward a page you can't see, not just a workaround for
 * this.
 *
 * Exported as a pure function (docs/DRAG-AND-DROP.md §7 item 2, EI-81) so
 * this one-line rule is unit-testable without rendering the rest of
 * `useBoardActions`'s dnd-kit/store wiring.
 */
export function computeAutoScroll(layout: "phone" | "tablet" | "desktop"): boolean {
  return layout !== "phone";
}

/**
 * Titles are free text and can be a paragraph. Truncate before quoting one
 * into a toast or an undo label, so a long todo cannot push the Undo button
 * off the card.
 */
function short(title: string, max = 40): string {
  const trimmed = title.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Locate which column currently holds a todo. */
function findColumn(board: NonNullable<BoardData["board"]>, todoId: string) {
  for (const day of board.days) {
    // The group the card RENDERS in, which is not always the group its `listId`
    // names: a dangling listId renders under Backlog. The no-op test in
    // handleDragEnd needs the rendered answer.
    const group = day.groups.find((g) => g.todos.some((t) => t.id === todoId));
    if (group) {
      return {
        target: { kind: "day" as const, day: day.day },
        todos: day.todos,
        groupKey: group.key,
      };
    }
    // Degenerate no-lists path, where a column falls back to a flat array.
    if (day.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "day" as const, day: day.day },
        todos: day.todos,
        groupKey: null,
      };
    }
  }
  if (board.overflow.todos.some((t) => t.id === todoId)) {
    return {
      target: { kind: "overflow" as const },
      todos: board.overflow.todos,
      groupKey: null,
    };
  }
  for (const column of board.lists) {
    if (column.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "list" as const, listId: column.list.id },
        todos: column.todos,
        groupKey: null,
      };
    }
  }
  return null;
}

/** The todos currently in a given drop target. */
function columnByTarget(
  board: NonNullable<BoardData["board"]>,
  target: NonNullable<ReturnType<typeof parseColumnId>>,
): Todo[] | null {
  if (target.kind === "day") {
    return board.days.find((d) => d.day === target.day)?.todos ?? null;
  }
  if (target.kind === "overflow") return board.overflow.todos;
  return board.lists.find((c) => c.list.id === target.listId)?.todos ?? null;
}

/**
 * Pass C of the `board.tsx` extraction (docs/ARCHITECTURE.md, mobile plan
 * P2) — every handler, the dnd-kit sensor/collision wiring, and the two
 * hover-dwell effects. Takes both `data` and `ui` (plus `coarse`, a viewport
 * concern neither hook owns) because a handler's whole job is combining
 * "what's true right now" with "what the user just did."
 */
export function useBoardActions(
  data: BoardData,
  ui: BoardUiState,
  coarse: boolean,
  layout: "phone" | "tablet" | "desktop",
) {
  const sensors = useSensors(
    /*
      MouseSensor rather than PointerSensor, and the split is load bearing.

      PointerSensor claims touch too, and `pointerdown` fires before
      `touchstart` — so it activates first, `activeRef` is then non-null, and
      dnd-kit's activator binding bails out of every later sensor. A TouchSensor
      added *alongside* a PointerSensor is unreachable code. Splitting them is
      the only way touch gets an activation rule of its own.

      4px keeps a mouse click distinguishable from a drag. Since the whole row
      is a drag surface (DRAG-AND-DROP §4.9), that threshold is what separates a
      click on a checkbox or a title from a lift.
    */
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    /*
      Long-press to lift on touch. Under the delay, or a move of more than the
      tolerance inside it, the browser keeps the gesture and the column
      scrolls exactly as before — which is why nothing needs
      `touch-action: none` any more. TouchSensor.setup registers a
      non-passive `touchmove` so the sensor can preventDefault scrolling once
      it *does* activate; that listener is what the grip's `touch-none` used
      to stand in for, and it applies to the whole row rather than to one
      12px control.

      250/8 undersells real touch: it's shorter than iOS's own long-press
      (~500ms) and Android's (~400ms), so a slow, deliberate finger-plant to
      START a scroll reads as "lift the card" more often than it should — the
      most likely "this app grabbed my card" complaint. `coarse` (P1,
      useViewport) tightens both numbers on an actual touch-primary device:
      400ms sits comfortably inside platform long-press muscle memory, and a
      tighter 5px tolerance means less accidental cancellation from a hand
      that isn't perfectly still while holding. A device that's merely
      capable of touch but not primarily touch (a mouse-driven laptop with a
      touchscreen) keeps the original, snappier values.
    */
    useSensor(TouchSensor, {
      activationConstraint: coarse ? { delay: 400, tolerance: 5 } : { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const {
    activeTodo,
    setActiveTodo,
    activeList,
    overId,
    setOverId,
    setActiveList,
    setActiveTab,
    landingTodoIds,
    setLandingTodoIds,
    selectedIds,
    selectionAnchorId,
    toggleSelected,
    selectRange,
    clearSelection,
    activeSelectionIds,
    setActiveSelectionIds,
    landingRectRef,
    setInfoListId,
    setInfoTabId,
    closeTodoSheet,
    selectTab,
    expandWeekend,
  } = ui;

  const {
    board,
    todosById,
    lists,
    tabs,
    rawTodoIds,
    activeTabId,
    listsById,
    tabsById,
    settings,
    ctx,
    openTodo,
    recurrenceExpansion,
    reminderPresets,
    selectedTodos,
  } = data;

  /*
   * Extracted to a boolean rather than depending on `settings` itself: that
   * object is rewritten by every rail resize, tab switch and split drag, and
   * three completion handlers rebuilding on a column drag would be churn for
   * nothing. `useSettings()` is not called again here — `use-board-data`
   * already subscribes to the singleton row, and a second liveQuery on it
   * would just be a second re-render source.
   */
  const goodJob = settings?.goodJobMode ?? false;

  /**
   * GOOD JOB mode's one gate (see `settingsSchema.goodJobMode`).
   *
   * Only `done` reaches here — `dropped` is an abandonment and reopening is
   * not a completion, so neither celebrates. Callers measure `origin`
   * themselves, at the control the user actually actuated, because the same
   * to-do can be on screen more than once: `day-sheet.tsx` renders a second
   * `TodoCard` for a to-do the board is already showing, and
   * `command-palette.tsx` renders a third row for it. Looking the card up by
   * id would find whichever came first in the document and throw confetti
   * from behind an overlay — and a sub-task has no card to find at all.
   *
   * The color is `effectiveListColor`, not the tab's: a to-do in a red list
   * under a blue tab RENDERS red, and the burst has to match what the user is
   * looking at.
   */
  const celebrateDone = useCallback(
    (todo: Pick<Todo, "listId">, origin: ConfettiOrigin | null | undefined) => {
      if (!goodJob || !origin) return;
      const list = todo.listId ? listsById.get(todo.listId) : null;
      void celebrate(origin, effectiveListColor(list, tabsById));
    },
    [goodJob, listsById, tabsById],
  );

  /**
   * Materialize a virtual (or already-real) todo before writing to it.
   *
   * `mutate()` throws on a missing row by design (see `lib/store/mutate.ts`)
   * — a virtual recurrence occurrence has no row yet, and writing to it via
   * the ordinary path would otherwise reach the server as a partial create.
   * A no-op when `todo` already has a real row (the common case).
   */
  const materializeIfNeeded = useCallback(
    async (todo: Todo): Promise<Todo> => {
      if (rawTodoIds.has(todo.id)) return todo;
      return materializeOccurrence(todo);
    },
    [rawTodoIds],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      // A lift is the one moment worth a haptic nudge — everything after it
      // (hover, drop) already has strong visual feedback. Android honors
      // `vibrate()`; iOS Safari silently ignores it (no permission prompt,
      // no error) — a free enhancement rather than something to feature-test
      // for. Gated on `coarse`, not on this being a touch event specifically:
      // the point is confirming a touch-primary user's own finger did what
      // they meant, which a mouse/trackpad drag never needs.
      if (coarse) navigator.vibrate?.(10);

      // Three gestures share one DndContext. `active.id` is what tells them
      // apart: reorder handles carry the `listdrag:` and `tabdrag:` prefixes,
      // everything else is a card.
      const id = String(event.active.id);

      const tabId = parseTabDragId(id);
      if (tabId) {
        setActiveTab(tabs.find((t) => t.id === tabId) ?? null);
        return;
      }

      const listId = parseListDragId(id);
      if (listId) {
        setActiveList(lists.find((l) => l.id === listId) ?? null);
        return;
      }

      // `todosById`, not `todos.find`: a virtual or force-overflowed
      // recurrence occurrence must still show a drag overlay.
      setActiveTodo(todosById.get(id) ?? null);

      /*
       * Snapshot the multi-selection at lift (EI-194), in board order.
       *
       * Taken from `selectedTodos` — the DERIVED list, so an id whose to-do
       * has since been deleted or filtered out can never enter the write
       * path — and frozen here rather than re-read in `handleDragEnd`,
       * because `selectedIds` can change mid-flight and the gesture must
       * commit exactly what was picked up.
       *
       * Lifting a card that is NOT in the selection means the selection is no
       * longer what this gesture is about, so it is cleared rather than
       * silently ignored — otherwise the highlighted cards would sit there
       * looking armed while a different card moved.
       */
      if (selectedIds.has(id) && selectedIds.size > 1) {
        setActiveSelectionIds(selectedTodos.map((t) => t.id));
      } else {
        setActiveSelectionIds(null);
        if (selectedIds.size > 0) clearSelection();
      }
    },
    [
      todosById,
      lists,
      tabs,
      coarse,
      setActiveTab,
      setActiveList,
      setActiveTodo,
      selectedIds,
      selectedTodos,
      setActiveSelectionIds,
      clearSelection,
    ],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      setOverId(event.over ? String(event.over.id) : null);
    },
    [setOverId],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTodo(null);
    setActiveList(null);
    setActiveTab(null);
    setOverId(null);
    // The snapshot goes; the SELECTION deliberately stays. Escape cancelled
    // the lift, not the picking — a second Escape clears the selection via
    // the document listener in `use-board-ui-state.ts`.
    setActiveSelectionIds(null);
    landingRectRef.current = null;
  }, [
    setActiveTodo,
    setActiveList,
    setActiveTab,
    setOverId,
    setActiveSelectionIds,
    landingRectRef,
  ]);

  /**
   * Hovering a tab with a card OR a list column in hand focuses that tab.
   *
   * For a card, this is what makes moving a to-do to another tab one gesture
   * rather than a drop, a click, and a second drag. For a list column
   * (EI-115), it's what makes carrying a whole list — and everything filed
   * under it — to another tab a single continuous drag: switch, then drop
   * among the columns that just appeared. The dwell exists because the strip
   * sits between the two halves: without it, dragging upward across the bar
   * would flip through every tab it passed over.
   *
   * The timer is keyed on `overId`, so leaving the pill before it fires
   * cancels — React tears down the effect on every change of target.
   */
  useEffect(() => {
    if ((!activeTodo && !activeList) || !overId) return;
    const hovered = parseTabDropId(overId);
    if (!hovered || hovered === activeTabId) return;

    const timer = window.setTimeout(() => selectTab(hovered), TAB_FOCUS_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [activeTodo, activeList, overId, activeTabId, selectTab]);

  /**
   * Hovering a collapsed weekend strip with a card in hand opens it.
   *
   * Without this, scheduling something for Saturday while weekends are hidden
   * means dropping the card somewhere, toggling weekends, dragging again, and
   * toggling back. The strip cannot simply accept the drop itself: it spans
   * two days and "the weekend" is not a date, so it reveals the real columns
   * and lets the user say which.
   *
   * Mounting a droppable mid-drag is only safe because `DndContext` measures
   * with `MeasuringStrategy.Always` (board.tsx) — dnd-kit re-measures on every
   * move, so the two day columns that appear here are immediately valid
   * targets for the card already in flight. Same dwell, and the same
   * cancel-on-leave teardown, as the tab effect above.
   */
  useEffect(() => {
    if (!activeTodo || !overId) return;
    if (parseWeekendColumnId(overId) === null) return;
    const timer = window.setTimeout(
      () => expandWeekend(overId),
      WEEKEND_EXPAND_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeTodo, overId, expandWeekend]);

  const dropAnimation = useCallback(
    (args: DropAnimationFunctionArguments) => {
      // The ref is read here, when dnd-kit invokes the animation — not during
      // render. Handing a ref-reading closure to a factory at render time is what
      // the React Compiler warns about, and it is right to.
      return runLandingDropAnimation(args, {
        landingRect: landingRectRef.current,
        // Only the flown card is cleared here; the rest of a multi-row
        // landing is released by the write loop's `finally`.
        onLand: (id) =>
          setLandingTodoIds((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next.size === 0 ? EMPTY_LANDING : next;
          }),
      });
    },
    [landingRectRef, setLandingTodoIds],
  );

  /**
   * Backstop. `onLand` is what normally reveals the row, but it only runs if
   * dnd-kit gets as far as invoking the drop animation — it bails early if the
   * overlay cannot be measured. A row stuck at zero opacity would look like
   * data loss, so time out well past the flight and reveal it regardless.
   */
  useEffect(() => {
    if (landingTodoIds.size === 0) return;
    const timer = window.setTimeout(
      // Clears whatever set is current rather than diffing against the one
      // this effect closed over: a second drag landing mid-flight replaces the
      // set, and reviving the old one would strand its rows invisible.
      () => setLandingTodoIds(EMPTY_LANDING),
      FLIGHT_MS + 250,
    );
    return () => window.clearTimeout(timer);
  }, [landingTodoIds, setLandingTodoIds]);

  /**
   * Cmd/Ctrl+click and Shift+click on a card (EI-194).
   *
   * A range that crosses columns re-anchors instead of selecting: the two
   * halves of the board are ordered by different rules entirely (§4.13), so
   * "everything between a card in Tuesday and a card in Backlog" has no answer
   * a user would predict. `rangeSelectionIds` returns null for that, and
   * falling through to a plain toggle is the behaviour that needs no
   * explaining.
   */
  const handleSelect = useCallback(
    (todoId: string, modifiers: { additive: boolean; range: boolean }) => {
      if (modifiers.range && selectionAnchorId && board) {
        const ids = rangeSelectionIds(board, selectionAnchorId, todoId);
        if (ids) {
          selectRange(ids, selectionAnchorId);
          return;
        }
      }
      toggleSelected(todoId);
    },
    [board, selectionAnchorId, selectRange, toggleSelected],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      /**
       * Measure the drop indicator before anything else. dnd-kit calls this
       * handler inside `unstable_batchedUpdates` after its own dispatch, so
       * React has not committed yet and the indicator is still on screen — but
       * it will be gone after the first `await`.
       */
      const landingRect = readLandingRect();
      landingRectRef.current = null;

      const draggedListId = parseListDragId(String(active.id));
      const draggedTabId = parseTabDragId(String(active.id));
      // Captured before the state below is cleared — same pattern as the two
      // ids above, and for the same reason: this handler needs it after the
      // reset.
      const draggedSelectionIds = activeSelectionIds;

      setActiveTodo(null);
      setActiveList(null);
      setActiveTab(null);
      setOverId(null);
      setActiveSelectionIds(null);
      if (!over) return;

      // Reordering a tab. Writes one tab's position and touches nothing else.
      if (draggedTabId) {
        const overTabId = parseTabDropId(String(over.id));
        if (!overTabId) return; // released off the strip
        const plan = planTabDrop(tabs, draggedTabId, overTabId);
        if (!plan) return; // dropped on itself
        landingRectRef.current = landingRect;

        const tab = tabs.find((t) => t.id === draggedTabId);
        if (tab) {
          pushUndo(`Moved “${short(tab.name)}”`, [
            {
              kind: "tab",
              entityId: tab.id,
              patch: inversePatch(tab, { position: plan.position }),
            },
          ]);
        }
        await updateTab(draggedTabId, { position: plan.position });
        return;
      }

      // Reordering — or, since EI-115, re-homing — a list column. Separate
      // from the card path below: it writes one list's fields and never
      // touches a todo, since a todo carries `listId`, never `tabId`.
      if (draggedListId) {
        const dragged = lists.find((l) => l.id === draggedListId);
        if (!dragged) return;

        /**
         * Dropped directly ON a tab pill: unlike a card (below), this is not
         * a no-op. It's the only way to reach the LAST slot of another tab's
         * track — there is no column past it to drag rightwards onto — so it
         * lands the list at the end of that tab. Dropping on the pill of the
         * tab the list is already on is a no-op; there is nowhere to go.
         */
        const overTabId = parseTabDropId(String(over.id));
        if (overTabId) {
          if (dragged.tabId === overTabId) return;
          const plan = planListTabDrop(lists, draggedListId, overTabId, null);
          if (!plan) return;
          landingRectRef.current = landingRect;

          pushUndo(`Moved “${short(dragged.name)}” to another tab`, [
            {
              kind: "list",
              entityId: dragged.id,
              patch: inversePatch(dragged, { tabId: plan.tabId, position: plan.position }),
            },
          ]);
          await updateList(draggedListId, { tabId: plan.tabId, position: plan.position });
          return;
        }

        const target = parseColumnId(String(over.id));

        /*
         * Dropped on a DAY (EI-193, §4.10e): schedule every to-do in the list
         * that has not already been assigned a day, and leave the list column
         * itself exactly where it is. Note what is NOT here — no `updateList`
         * call is reachable past this branch's `return`, so "the column does
         * not move" is structural rather than a guard someone can simplify
         * away, and no `position` is written because order in the calendar
         * half is computed, not hand-arranged (§4.13).
         */
        if (target?.kind === "day" && board) {
          const plan = planListDayDrop(board.lists, draggedListId, target.day);
          if (!plan) return;

          if (plan.todos.length === 0) {
            /*
             * Nothing to move, and the user cannot see why: the column is
             * visibly full of cards that all already have a day. Leaving the
             * landing rect null flies the chip home, so the toast explains a
             * refusal they already watched rather than arriving from nowhere.
             */
            toast("Nothing to schedule", {
              description: `Every to-do in “${short(dragged.name)}” already has a day.`,
            });
            return;
          }

          // A virtual recurrence occurrence has to become a real row before it
          // can be scheduled. Awaits, so it happens before the undo entry is
          // built — the inverse patches must describe the rows we actually write.
          const movers: Todo[] = [];
          for (const t of plan.todos) movers.push(await materializeIfNeeded(t));

          landingRectRef.current = landingRect;
          setLandingTodoIds(new Set(movers.map((t) => t.id)));

          pushUndo(
            movers.length === 1
              ? `Scheduled “${short(movers[0].title)}”`
              : `Scheduled ${movers.length} from “${short(dragged.name)}”`,
            movers.map((t) => ({
              kind: "todo" as const,
              entityId: t.id,
              // Each mover's own previous date — never the list's, and never
              // another mover's.
              patch: inversePatch(t, schedulePatch(target.day, t.scheduledDate)),
            })),
          );

          try {
            for (const t of movers) await scheduleTodo(t.id, target.day, t.scheduledDate);
          } finally {
            // N sequential Dexie transactions can outlast the flight's
            // backstop. Clearing here as well as in `onLand` keeps a row from
            // being revealed before its write has landed.
            setLandingTodoIds(EMPTY_LANDING);
          }
          return;
        }

        if (target?.kind !== "list") return; // dropped outside the planning half

        /**
         * Backlog carries no `tabId` of its own — it rides along on every
         * tab — so "dropped on Backlog" means "the tab currently on screen",
         * exactly as it always has. Any other column names its own tab
         * directly. Comparing that against the dragged list's CURRENT tab is
         * what tells an ordinary same-track reorder (still `planListDrop`,
         * untouched) apart from a drop that arrived after the dwell already
         * switched tabs (`planListTabDrop`, tab-scoped — `planListDrop`'s
         * left/right direction rule has nothing to compare against once the
         * two columns never shared a track).
         */
        const targetList = lists.find((l) => l.id === target.listId);
        const destinationTabId = targetList?.isBacklog ? activeTabId : targetList?.tabId;

        if (destinationTabId && dragged.tabId !== destinationTabId) {
          const plan = planListTabDrop(lists, draggedListId, destinationTabId, target.listId);
          if (!plan) return; // dropped on an unknown column
          landingRectRef.current = landingRect;

          pushUndo(`Moved “${short(dragged.name)}” to another tab`, [
            {
              kind: "list",
              entityId: dragged.id,
              patch: inversePatch(dragged, { tabId: plan.tabId, position: plan.position }),
            },
          ]);
          await updateList(draggedListId, { tabId: plan.tabId, position: plan.position });
          return;
        }

        const plan = planListDrop(lists, draggedListId, target.listId);
        if (!plan) return; // dropped on itself, or an unknown column
        landingRectRef.current = landingRect;

        pushUndo(`Moved “${short(dragged.name)}”`, [
          {
            kind: "list",
            entityId: dragged.id,
            patch: inversePatch(dragged, { position: plan.position }),
          },
        ]);
        await updateList(draggedListId, { position: plan.position });
        return;
      }

      /**
       * A card released ON a tab pill writes nothing.
       *
       * Hovering one is a focus gesture — by the time the pointer comes up the
       * tab has already switched, and the card is meant to land in one of the
       * columns now showing. Falling through would look up the pill's id in
       * `todos`, find nothing, and return anyway; refusing here says so out
       * loud, and leaves the landing rect null so the card visibly returns
       * home rather than flying to the strip.
       */
      if (parseTabDropId(String(over.id))) return;

      if (!board) return;

      // `todosById`, not `todos.find`: a card in flight may be a virtual or
      // force-overflowed recurrence occurrence, neither of which has a real
      // row yet. Materializing it here — a no-op if it already has one —
      // gives every write below a row to land on.
      const draggedCard = todosById.get(String(active.id));
      if (!draggedCard) return;
      const todo = await materializeIfNeeded(draggedCard);

      /**
       * A MULTI-SELECTION was lifted (EI-194): every selected card lands, not
       * just the one under the cursor.
       *
       * Deliberately a separate branch rather than a generalisation of the
       * single-card path below, which is left byte-identical. That path is the
       * most-used code in the app and every bug in it has been invisible to
       * typecheck, lint and unit tests (§8) — duplicating ~40 lines is the
       * cheaper trade.
       *
       * `movers` resolves through `todosById` and drops anything missing, so a
       * row deleted between lift and release cannot reach `mutate()` (which
       * throws on a missing key, by design).
       */
      if (draggedSelectionIds && draggedSelectionIds.length > 1) {
        const picked = draggedSelectionIds
          .map((id) => todosById.get(id))
          .filter((t): t is Todo => Boolean(t));
        if (picked.length === 0) return;

        // Overflow refuses the whole selection at once — one toast, not N
        // (§5.1). Checked before materializing, so a refused drop writes
        // nothing at all.
        const overflowTarget = parseColumnId(String(over.id))?.kind === "overflow";
        const overflowGroup = parseDayGroupId(String(over.id))?.day === OVERFLOW;
        if (overflowTarget || overflowGroup) {
          toast(`Can’t put ${picked.length} to-dos off any longer`, {
            description: "Reschedule, complete, or move them to a list.",
          });
          return;
        }

        /*
         * Materialize FIRST, then build the undo entry, then write. The single
         * path can push undo before its one await; here the inverse patches
         * have to describe rows that already exist, so the ordering differs.
         */
        const movers: Todo[] = [];
        for (const t of picked) movers.push(await materializeIfNeeded(t));
        const moverIds = new Set(movers.map((t) => t.id));

        // Resolve the target the same way the single path does, one line down.
        let multiTarget = parseColumnId(String(over.id));
        let multiSiblings: Todo[] = [];
        let multiOverCardId: string | null = null;
        const droppedGroup = parseDayGroupId(String(over.id));

        if (droppedGroup) {
          const column = board.days.find((d) => d.day === droppedGroup.day);
          const group = column?.groups.find((g) => g.key === droppedGroup.key);
          if (!group) return;
          multiSiblings = group.todos;
        } else if (!multiTarget) {
          const overTodo = todosById.get(String(over.id));
          if (!overTodo) return;
          const column = findColumn(board, overTodo.id);
          if (!column) return;
          multiTarget = column.target;
          multiSiblings = column.todos;
          multiOverCardId = overTodo.id;
        } else {
          multiSiblings = columnByTarget(board, multiTarget) ?? [];
        }

        /*
         * One key per mover, all inside the same gap, ascending in board
         * order — so the run lands in the order it was picked in. A single
         * `positionForIndex` reused N times would give N identical keys.
         *
         * Only the list and day-group branches use them: a day column writes
         * no position at all, because order there is computed (§4.13).
         */
        const positions = positionsForDropOnItem(
          multiSiblings,
          moverIds,
          multiOverCardId,
          movers.length,
        );

        /*
         * One pair of closures per target kind, chosen once. Narrowing the
         * target into locals up front is what keeps the day case from having
         * to assert past `{kind: "overflow"}` — which is unreachable here
         * (refused above) but not provably so to the type checker.
         *
         * `label` differs too: moving into a list and scheduling onto a day
         * are different verbs, and undo's toast says which happened.
         */
        let forwardFor: (t: Todo, i: number) => Record<string, unknown>;
        let write: (t: Todo, i: number) => Promise<void>;
        let label: string;

        if (droppedGroup) {
          const { key, day } = droppedGroup;
          forwardFor = (t, i) => dayGroupPatch(key, day, t.scheduledDate, positions[i]);
          write = (t, i) => moveTodoToDayGroup(t.id, key, day, t.scheduledDate, positions[i]);
          label = `Moved ${movers.length} to-dos`;
        } else if (multiTarget?.kind === "list") {
          const { listId } = multiTarget;
          forwardFor = (_t, i) => listPatch(listId, positions[i]);
          write = (t, i) => moveTodoToList(t.id, listId, positions[i]);
          label = `Moved ${movers.length} to-dos`;
        } else if (multiTarget?.kind === "day") {
          const { day } = multiTarget;
          // Each mover's OWN previous date. Reusing the dragged card's would
          // restore the wrong dates on undo. No position: order in the
          // calendar half is computed (§4.13).
          forwardFor = (t) => schedulePatch(day, t.scheduledDate);
          write = (t) => scheduleTodo(t.id, day, t.scheduledDate);
          label = `Scheduled ${movers.length} to-dos`;
        } else {
          return; // released over something with no meaning for a selection
        }

        const steps = movers.map((t, i) => ({
          kind: "todo" as const,
          entityId: t.id,
          patch: inversePatch(t, forwardFor(t, i)),
        }));

        landingRectRef.current = landingRect;
        setLandingTodoIds(moverIds);

        pushUndo(label, steps);

        try {
          for (let i = 0; i < movers.length; i++) await write(movers[i], i);
        } finally {
          // N sequential Dexie transactions can outlast the flight's backstop;
          // clearing here as well as in `onLand` keeps a row from being
          // revealed before its write has landed.
          setLandingTodoIds(EMPTY_LANDING);
          clearSelection();
        }
        return;
      }

      /**
       * DROPPED ON A GROUP: "this belongs to list X, still scheduled for D."
       *
       * Resolved before `parseColumnId` because a group is not a column. Falling
       * through would take the append-to-a-day path and write only a date.
       */
      const dropped = parseDayGroupId(String(over.id));
      if (dropped) {
        // Overflow's groups register no droppable, so this is a guard rather than
        // a live case: Overflow refuses drops (see the `else` branch below).
        if (dropped.day === OVERFLOW) return;

        const column = board.days.find((d) => d.day === dropped.day);
        const group = column?.groups.find((g) => g.key === dropped.key);
        if (!group) return;

        /**
         * A card already in this group, already on this date, has nowhere to go:
         * order inside a group is COMPUTED, so there is no "move it up" for the
         * gesture to mean. Returning leaves the landing rect null and dnd-kit
         * flies the card home, which is the honest read for a no-op.
         *
         * `todo.scheduledDate === dropped.day` is the second half of the test and
         * is NOT redundant: a rolled-over todo renders in today's column while
         * still carrying last Friday's date, so dropping it on its own group there
         * is exactly how a user commits it to today. Comparing the RENDERED group
         * rather than `todo.listId` also handles a dangling listId, which renders
         * under Backlog while pointing at a list that is gone.
         */
        const current = findColumn(board, todo.id);
        if (
          current?.groupKey === dropped.key &&
          current.target.kind === "day" &&
          current.target.day === dropped.day &&
          todo.scheduledDate === dropped.day
        ) {
          return;
        }

        /*
          Last within the group. `position` is only a TIEBREAKER in this half —
          priority decides the band — but writing one keeps a dropped card off the
          middle of its band and gives the flight an end-of-group indicator to
          land on rather than a group rect it does not fill.
        */
        const ordered = group.todos.filter((t) => t.id !== todo.id);
        const groupPosition = positionForIndex(ordered, ordered.length);

        landingRectRef.current = landingRect;
        setLandingTodoIds(new Set([todo.id]));

        const forward = dayGroupPatch(dropped.key, dropped.day, todo.scheduledDate, groupPosition);
        pushUndo(`Moved “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await moveTodoToDayGroup(todo.id, dropped.key, dropped.day, todo.scheduledDate, groupPosition);
        return;
      }

      // `over` may be a column or another todo. Resolve the owning column.
      let target = parseColumnId(String(over.id));
      let siblings: Todo[] = [];
      // null means "no specific card was hovered" — append to the end.
      let overCardId: string | null = null;

      if (!target) {
        const overTodo = todosById.get(String(over.id));
        if (!overTodo) return;
        const column = findColumn(board, overTodo.id);
        if (!column) return;
        target = column.target;
        siblings = column.todos;
        overCardId = overTodo.id;
      } else {
        const column = columnByTarget(board, target);
        siblings = column ?? [];
      }

      /*
       * Excludes the dragged item so it cannot become its own neighbour, and
       * reads the target's index from that same filtered list — the two must
       * agree or a card dragged downward past its target lands one slot below
       * the insertion line that was just drawn above it (EI-191).
       */
      const position = positionForDropOnItem(siblings, todo.id, overCardId);

      if (target.kind === "list" || target.kind === "day") {
        // Only a committed move gets a landing. Everything else — a refusal, a
        // cancel, a release over nothing — leaves the rect null, and dnd-kit's
        // return-to-source animation stands. For a refusal that is the right
        // read: the item visibly goes back where it came from.
        landingRectRef.current = landingRect;
        setLandingTodoIds(new Set([todo.id]));
      }

      /**
       * Record before awaiting, so entry order matches the order the user
       * acted in even if two handlers overlap.
       *
       * Silent by design — no toast. The card visibly flies into its new slot,
       * so a notification would only restate what was just watched. ⌘Z still
       * reverses it.
       */
      if (target.kind === "list") {
        const forward = listPatch(target.listId, position);
        pushUndo(`Moved “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await moveTodoToList(todo.id, target.listId, position);
      } else if (target.kind === "day") {
        /*
          Empty space in a day column: schedule it here, keep its list, and write
          NO position. A day column's order is computed from priority, and the
          card's existing key still serves as its tiebreaker within whichever band
          it lands in. `positionForIndex` over a grouped array would be arithmetic
          on a sequence nothing orders by — meaningless, and it would silently
          reshuffle the card's tiebreaker for no visible effect.
        */
        const forward = schedulePatch(target.day, todo.scheduledDate);
        pushUndo(`Scheduled “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await scheduleTodo(todo.id, target.day, todo.scheduledDate);
      } else {
        // Dropping into Overflow is a triage gesture, not a schedule. Leave the
        // date alone so the item stays overdue rather than silently becoming
        // "due today" — the user still has to decide what to do with it.
        toast("Reschedule, complete, or move it to a list", {
          description: "Overflow is for deciding, not parking.",
        });
      }
    },
    [
      board,
      todosById,
      materializeIfNeeded,
      lists,
      tabs,
      activeTabId,
      landingRectRef,
      setActiveTodo,
      setActiveList,
      setActiveTab,
      setOverId,
      setLandingTodoIds,
      activeSelectionIds,
      setActiveSelectionIds,
      clearSelection,
    ],
  );

  const handleQuickAdd = useCallback(
    async (
      input: string,
      target: { listId?: string; day?: string },
      /** Set when the quick-add row's "@list" mention resolved one — see
       * `board-column.tsx`. Overrides `target.listId` the same way a parsed
       * date token overrides `target.day` below: what the user explicitly
       * named beats the column they happened to be typing in. */
      mentionedListId?: string,
      /** Every "#label" mention picked, in pick order — see `board-column.tsx`. */
      mentionedLabelIds?: string[],
    ) => {
      // Quick-add rows only render once `ctx` is loaded (the `!ctx` early
      // return below gates the whole board), so this never actually fires
      // null — the guard is here purely so the closure typechecks.
      if (!ctx) return;
      const parsed = parseQuickAdd(input, ctx.today, reminderPresets);
      const listId = mentionedListId ?? target.listId ?? null;
      // An explicit date token beats the column it was typed into — the user
      // said Friday. Only falls back to `target.day` (a day column drop) when
      // nothing was parsed.
      const scheduledDate = parsed.scheduledDate ?? target.day ?? null;
      // The only action that has to record AFTER the write, because the id it
      // needs to undo does not exist until then.
      const id = await createTodo({
        title: parsed.title,
        listId,
        scheduledDate,
        deadline: parsed.deadline,
        priority: parsed.priority,
        reminderTime: parsed.reminderTime,
        labelIds: mentionedLabelIds,
      });
      // Name where it landed whenever a token or mention moved it off the
      // column it was typed into — a card leaving its column is otherwise silent.
      const parts: string[] = [];
      if (scheduledDate && scheduledDate !== target.day) parts.push(formatShortDate(scheduledDate));
      if (mentionedListId && mentionedListId !== (target.listId ?? null)) {
        parts.push(listsById.get(mentionedListId)?.name ?? "another list");
      }
      const label = parts.length
        ? `Added “${short(parsed.title)}” · ${parts.join(" · ")}`
        : `Added “${short(parsed.title)}”`;
      pushUndo(label, [createUndoStep("todo", id)]);
    },
    [ctx, listsById, reminderPresets],
  );

  /**
   * Only open todos render as cards, so this is always a completion.
   *
   * Completing removes the card from the board entirely — buildBoard keeps
   * only `open` — and that invisibility is exactly what earns a toast. A change
   * the user can still see does not get one.
   */
  const handleToggle = useCallback(
    (todo: Todo, origin?: ConfettiOrigin | null) => {
      /*
       * A real toggle, reading the current status (EI-197).
       *
       * This was hardcoded to `"done"` — a Complete handler wearing a
       * Toggle's name. Clicking a finished to-do's checkbox wrote `done` over
       * `done`, `setTodoStatus` correctly reported "nothing changed" and
       * returned null, and the card sat there unmoved while its own
       * `aria-label` promised "Mark X not done".
       *
       * It was invisible for as long as it was unreachable: with the default
       * `visibleStatuses` of `["open"]`, completing a to-do removes it from
       * the board, so there was no done checkbox left to click. The completed
       * view (EI-90) and then the completion stamp (EI-192) put one back.
       *
       * `dropped` reopens too — the checkbox is binary, and the only sensible
       * meaning of ticking a won't-do item is "actually, it's back on".
       */
      const next: Todo["status"] = todo.status === "open" ? "done" : "open";
      const forward = statusPatch(next);
      const entryId = pushUndo(`${STATUS_VERB[next]} “${short(todo.title)}”`, [
        { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
      ]);
      // `todo` may be a virtual recurrence occurrence with no row yet —
      // materialize before writing. A no-op when it already has one.
      void (async () => {
        await materializeIfNeeded(todo);
        const eventId = await setTodoStatus(todo.id, next);
        // EI-94 Phase 3: an instant undo tombstones the `done` event too, so
        // history doesn't show "Completed" for something un-done a second
        // later.
        if (eventId) attachEventIds(entryId, [eventId]);
      })();
      /*
       * Only a departure needs a toast. Completing drops the to-do off the
       * board under the default view, so there is nothing left on screen to
       * confirm it — but REOPENING puts a card back where you can see it, and
       * announcing something already visible is noise. Same rule
       * `handleSheetStatus` applies just below.
       */
      if (next !== "open") {
        toast.success(`${STATUS_VERB[next]} “${short(todo.title)}”`, {
          duration: 6000,
          action: { label: "Undo", onClick: () => void undoById(entryId) },
        });
      }
      if (next === "done") celebrateDone(todo, origin);
    },
    [materializeIfNeeded, celebrateDone],
  );

  /**
   * The sheet's handlers all read the todo as it is RIGHT NOW to build an
   * inverse, which is why `openTodo` is derived from `todos` rather than held
   * in state — a snapshot would reverse whatever was true when it opened.
   */
  const handleSheetSave = useCallback(
    (id: string, patch: Partial<Todo>) => {
      // `todosById`, not `todos.find`: the sheet may be open on a virtual or
      // force-overflowed recurrence occurrence.
      const before = todosById.get(id);
      // Typing a new date into the sheet is still a genuine reschedule, same
      // as dragging — stamp `scheduledAt` the same way `schedulePatch` and
      // `dayGroupPatch` do, so the day sheet's timeline sees it. Gated on the
      // date actually changing for the same reason those are: re-saving the
      // sheet with the date field untouched must not look like a fresh move.
      const stamped =
        before && "scheduledDate" in patch && patch.scheduledDate !== before.scheduledDate
          ? { ...patch, scheduledAt: patch.scheduledDate ? now() : null }
          : patch;
      // Silent: the sheet is open, so the change is visible in the field the
      // user just left. One entry per field, so ⌘Z steps back one edit.
      if (before) {
        pushUndo(`Edited “${short(before.title)}”`, [
          { kind: "todo", entityId: id, patch: inversePatch(before, stamped) },
        ]);
      }
      void (async () => {
        if (before) await materializeIfNeeded(before);
        await updateTodo(id, stamped);
      })();
    },
    [todosById, materializeIfNeeded],
  );

  const handleSheetStatus = useCallback(
    (id: string, status: Todo["status"], origin?: ConfettiOrigin | null) => {
      const before = todosById.get(id);
      if (!before) return;
      const forward = statusPatch(status);
      const entryId = pushUndo(`${STATUS_VERB[status]} “${short(before.title)}”`, [
        { kind: "todo", entityId: id, patch: inversePatch(before, forward) },
      ]);
      void (async () => {
        await materializeIfNeeded(before);
        const eventId = await setTodoStatus(id, status);
        if (eventId) attachEventIds(entryId, [eventId]);
      })();
      // Same reasoning as the card checkbox: anything but `open` drops the
      // todo off the board, so there is nothing left on screen to confirm it.
      if (status !== "open") {
        toast.success(`${STATUS_VERB[status]} “${short(before.title)}”`, {
          duration: 6000,
          action: { label: "Undo", onClick: () => void undoById(entryId) },
        });
      }
      if (status === "done") celebrateDone(before, origin);
    },
    [todosById, materializeIfNeeded, celebrateDone],
  );

  /**
   * Overdrive's (EI-97) one write path — every verdict a card can receive
   * shares this call site, so undo reverses exactly what was written no
   * matter which of the four it was. Returns the `pushUndo` entry id
   * synchronously (the write itself is fire-and-forget, same convention as
   * `handleToggle`), which the overlay keeps so `⌫`/`⌘Z`/its own toast can
   * replay it via `undoById`. `label` rides along too (round 2, EI-97) — the
   * overlay's toast shows it verbatim rather than re-deriving the same
   * per-verdict wording a second time.
   */
  const handleOverdriveVerdict = useCallback(
    (
      todo: Todo,
      verdict: Verdict,
      origin?: ConfettiOrigin | null,
    ): { undoId: string; label: string } => {
      const forward: Partial<Todo> =
        verdict.kind === "listed"
          ? listPatch(verdict.listId)
          : verdict.kind === "scheduled"
            ? schedulePatch(verdict.date, todo.scheduledDate)
            : statusPatch(verdict.kind);

      const label =
        verdict.kind === "dropped"
          ? `Won’t do “${short(todo.title)}”`
          : verdict.kind === "done"
            ? `Completed “${short(todo.title)}”`
            : verdict.kind === "listed"
              ? `Moved “${short(todo.title)}” to ${listsById.get(verdict.listId ?? "")?.name ?? "Backlog"}`
              : `Scheduled “${short(todo.title)}” for ${formatShortDate(verdict.date)}`;

      const entryId = pushUndo(label, [
        { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
      ]);

      void (async () => {
        await materializeIfNeeded(todo);
        if (verdict.kind === "dropped" || verdict.kind === "done") {
          const eventId = await setTodoStatus(todo.id, verdict.kind);
          if (eventId) attachEventIds(entryId, [eventId]);
        } else if (verdict.kind === "listed") {
          await moveTodoToList(todo.id, verdict.listId);
        } else {
          await scheduleTodo(todo.id, verdict.date, todo.scheduledDate);
        }
      })();

      if (verdict.kind === "done") celebrateDone(todo, origin);

      return { undoId: entryId, label };
    },
    [listsById, materializeIfNeeded, celebrateDone],
  );

  const handleToggleLabel = useCallback(
    (todoId: string, labelId: string) => {
      const before = todosById.get(todoId);
      if (!before) return;
      // toggleTodoLabel rewrites the whole array, so the inverse is simply the
      // array as it stands — no need to know which way the toggle went.
      pushUndo(`Labelled “${short(before.title)}”`, [
        { kind: "todo", entityId: todoId, patch: { labelIds: before.labelIds } },
      ]);
      void (async () => {
        await materializeIfNeeded(before);
        await toggleTodoLabel(todoId, labelId);
      })();
    },
    [todosById, materializeIfNeeded],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const before = todosById.get(id);
      if (!before) return;
      // A recurring occurrence reads as "skip this one" — the series and
      // its other occurrences are untouched — which is a different fact
      // from an ordinary todo's "deleted" and worth saying so out loud.
      const label = before.recurrenceParentId
        ? `Skipped “${short(before.title)}”`
        : `Deleted “${short(before.title)}”`;
      const entryId = pushUndo(label, [
        { kind: "todo", entityId: id, patch: { deletedAt: null } },
      ]);
      void (async () => {
        await materializeIfNeeded(before);
        // Deleting a todo tombstones its attachments too (EI-245), and which
        // rows those are is only known once the delete has read them — so
        // they join the undo entry after the fact, exactly like
        // `attachEventIds`. Without this, ⌘Z restores the todo with its files
        // silently detached, which reads as data loss, not as an undo.
        const attachmentIds = await deleteTodo(id);
        appendUndoSteps(
          entryId,
          attachmentIds.map((attachmentId) => ({
            kind: "attachment" as const,
            entityId: attachmentId,
            patch: { deletedAt: null },
          })),
        );
      })();
      toast.success(label, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void undoById(entryId) },
      });
    },
    [todosById, materializeIfNeeded],
  );

  /**
   * Add a sub-task (EI-55) under `parentId` — `TodoSheet`'s Sub-tasks
   * section. Same "record the undo step AFTER the write" shape as
   * `handleQuickAdd`, and for the same reason: the id it needs doesn't exist
   * until `createSubtask` returns. No toast — unlike a top-level quick-add,
   * the new row appears immediately in the still-open sheet, so there is
   * nothing invisible here for a toast to confirm.
   */
  const handleAddSubtask = useCallback(
    (parentId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const parent = todosById.get(parentId);
      void (async () => {
        if (parent) await materializeIfNeeded(parent);
        const id = await createSubtask(parentId, trimmed);
        pushUndo(`Added “${short(trimmed)}”`, [createUndoStep("todo", id)]);
      })();
    },
    [todosById, materializeIfNeeded],
  );

  /**
   * List settings. All three close the dialog: the write is instant and local,
   * so leaving it open would mean staring at a form describing a column that
   * has already changed — or, for archive and delete, one that has gone.
   */
  const handleSaveList = useCallback((list: List, patch: ListPatch) => {
    // The undo entry names what actually changed. A rename, a recolor, and a
    // default-reminder change are the same write, and "Renamed" on any of the
    // others is the sort of label that makes ⌘Z look broken.
    const label =
      patch.name !== undefined
        ? `Renamed “${list.name}”`
        : patch.defaultReminderPresetId !== undefined
          ? `Changed default reminder for “${list.name}”`
          : patch.description !== undefined
            ? `Edited “${list.name}”`
            : `Recolored “${list.name}”`;
    updateListWithUndo(list, patch, label);
  }, []);

  const handleArchiveList = useCallback(
    (list: List) => {
      setInfoListId(null);
      void archiveListWithUndo(list);
    },
    [setInfoListId],
  );

  const handleDeleteList = useCallback(
    (list: List) => {
      setInfoListId(null);
      void deleteListWithUndo(list);
    },
    [setInfoListId],
  );

  /** Tab settings. Closed on every action, for the same reasons as lists. */
  const handleSaveTab = useCallback((tab: Tab, patch: TabPatch) => {
    updateTabWithUndo(tab, patch, `Edited “${short(tab.name)}”`);
  }, []);

  const handleArchiveTab = useCallback(
    (tab: Tab) => {
      setInfoTabId(null);
      void archiveTabWithUndo(tab);
    },
    [setInfoTabId],
  );

  const handleDeleteTab = useCallback(
    (tab: Tab) => {
      setInfoTabId(null);
      void deleteTabWithUndo(tab);
    },
    [setInfoTabId],
  );

  /** A new tab is worth looking at, so switch to it rather than just listing it. */
  const handleCreateTab = useCallback(
    async (name: string) => {
      selectTab(await createTabWithUndo(name));
    },
    [selectTab],
  );

  /** Start a new series from the currently open (plain, one-off) todo. */
  const handleStartSeries = useCallback(
    (rule: RecurrenceRule) => {
      if (!openTodo) return;
      void createSeriesFromTodo(openTodo, rule);
    },
    [openTodo],
  );

  /**
   * The recurrence detail for the open sheet, if `openTodo` is a
   * materialized occurrence. `openTodo` alone doesn't carry the rule — that
   * lives on the template, found through `recurrenceParentId`.
   */
  const recurrenceInfo = useMemo(() => {
    if (!openTodo?.recurrenceParentId) return null;
    const template = todosById.get(openTodo.recurrenceParentId);
    const rule = template ? parseRule(template.recurrenceRule) : null;
    if (!template || !rule || !template.scheduledDate) return null;
    const todoId = openTodo.id;
    const seriesStart = template.scheduledDate;
    const occurrence = parseOccurrenceId(todoId);
    // The occurrence currently open, not the template's own start — a
    // "Change…" edit retargets the series to begin HERE (see
    // `retargetSeries`), so the dialog it opens must default and bound
    // itself from this date, not from wherever the series originally began.
    const occurrenceDate = occurrence?.date ?? seriesStart;
    return {
      rule,
      seriesStart,
      occurrenceDate,
      summary: summarizeRule(rule, seriesStart),
      // `occurrence` is null for the ORIGIN one-off todo a series was just
      // started from (`createSeriesFromTodo`) — it links to the template via
      // `recurrenceParentId` for display, but its own id was never in
      // `${templateId}@${date}` form, so it isn't itself an occurrence to
      // compute "next after". `seriesStart` — the template's own scheduled
      // date — IS the next occurrence in that case.
      nextDate: occurrence ? nextOccurrenceAfter(rule, seriesStart, occurrence.date) : seriesStart,
      missedCount: recurrenceExpansion?.missedCounts.get(todoId) ?? null,
      onStop: async () => {
        // Materialize FIRST: `openTodo` may still be a virtual occurrence,
        // and ending the series before this date would otherwise make the
        // very card being viewed stop existing on the next render. A no-op
        // for the origin todo (already a real row) or an already-real one.
        const materialized = await materializeIfNeeded(openTodo);
        // Ends the series the day before this occurrence, so this one and
        // anything already materialized are untouched — only FUTURE
        // occurrences stop generating. Falls back to the day before the
        // template's own start when `materialized` isn't itself a
        // parseable occurrence (the origin todo again) — stopping from
        // there means "cancel the series before it ever begins."
        const cutoff = parseOccurrenceId(materialized.id)?.date ?? addDays(seriesStart, -1);
        await setSeriesUntil(template.id, cutoff);
        toast.success("Stopped repeating");
      },
      onChangeRule: (next: RecurrenceRule) => {
        // Retargets the template to start HERE, so the occurrence currently
        // open keeps generating under the new rule — no materialization
        // needed, unlike onStop, because this never cuts off the viewed date.
        void retargetSeries(template.id, next, occurrenceDate);
        toast.success("Repeat updated");
      },
      onRemoveSeries: async () => {
        // Materialization can't help here — the template itself is going,
        // so every virtual occurrence (including this one) stops existing
        // regardless. Close explicitly rather than relying on the stale-id
        // effect, so the sheet dismisses in the same tick as the delete.
        await deleteSeries(template.id);
        closeTodoSheet();
        toast.success("Deleted the repeating series");
      },
    };
  }, [openTodo, todosById, recurrenceExpansion, materializeIfNeeded, closeTodoSheet]);

  const autoScroll = computeAutoScroll(layout);

  return {
    sensors,
    collisionDetection,
    autoScroll,
    handleDragStart,
    handleSelect,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    dropAnimation,
    handleQuickAdd,
    handleToggle,
    handleSheetSave,
    handleSheetStatus,
    handleOverdriveVerdict,
    handleToggleLabel,
    handleDelete,
    handleAddSubtask,
    handleSaveList,
    handleArchiveList,
    handleDeleteList,
    handleSaveTab,
    handleArchiveTab,
    handleDeleteTab,
    handleCreateTab,
    handleStartSeries,
    recurrenceInfo,
    materializeIfNeeded,
  };
}
