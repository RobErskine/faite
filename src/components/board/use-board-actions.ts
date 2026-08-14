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
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import type { List, Tab, Todo } from "@/lib/schema";
import {
  parseColumnId,
  parseDayGroupId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  parseWeekendColumnId,
  planListDrop,
  planTabDrop,
  preferPreciseTarget,
} from "@/lib/board";
import {
  FLIGHT_MS,
  readLandingRect,
  runLandingDropAnimation,
} from "@/lib/drop-animation";
import { positionForIndex } from "@/lib/ordering";
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
import type { BoardUiState } from "./use-board-ui-state";

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
  const collisions = underPointer.length > 0 ? underPointer : closestCorners(args);

  /**
   * A column drag wants the opposite answer to a card drag. The pointer is
   * inside a column *and* the cards within it, and for reordering columns the
   * cards are noise — only the column is a meaningful reference point.
   */
  if (parseListDragId(String(args.active.id))) {
    const column = collisions.find((c) => parseColumnId(String(c.id))?.kind === "list");
    return column ? [column] : [];
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

  const target = preferPreciseTarget(collisions);
  return target ? [target] : collisions;
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const {
    activeTodo,
    setActiveTodo,
    overId,
    setOverId,
    setActiveList,
    setActiveTab,
    landingTodoId,
    setLandingTodoId,
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
    ctx,
    openTodo,
    recurrenceExpansion,
    reminderPresets,
  } = data;

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
    },
    [todosById, lists, tabs, coarse, setActiveTab, setActiveList, setActiveTodo],
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
    landingRectRef.current = null;
  }, [setActiveTodo, setActiveList, setActiveTab, setOverId, landingRectRef]);

  /**
   * Hovering a tab with a card in hand focuses that tab.
   *
   * This is what makes moving a to-do to another tab one gesture rather than a
   * drop, a click, and a second drag. The dwell exists because the strip sits
   * between the two halves: without it, dragging a card upward across the bar
   * would flip through every tab it passed over.
   *
   * The timer is keyed on `overId`, so leaving the pill before it fires
   * cancels — React tears down the effect on every change of target.
   */
  useEffect(() => {
    if (!activeTodo || !overId) return;
    const hovered = parseTabDropId(overId);
    if (!hovered || hovered === activeTabId) return;

    const timer = window.setTimeout(() => selectTab(hovered), TAB_FOCUS_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [activeTodo, overId, activeTabId, selectTab]);

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
        onLand: (id) => setLandingTodoId((current) => (current === id ? null : current)),
      });
    },
    [landingRectRef, setLandingTodoId],
  );

  /**
   * Backstop. `onLand` is what normally reveals the row, but it only runs if
   * dnd-kit gets as far as invoking the drop animation — it bails early if the
   * overlay cannot be measured. A row stuck at zero opacity would look like
   * data loss, so time out well past the flight and reveal it regardless.
   */
  useEffect(() => {
    if (!landingTodoId) return;
    const timer = window.setTimeout(
      () => setLandingTodoId((current) => (current === landingTodoId ? null : current)),
      FLIGHT_MS + 250,
    );
    return () => window.clearTimeout(timer);
  }, [landingTodoId, setLandingTodoId]);

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

      setActiveTodo(null);
      setActiveList(null);
      setActiveTab(null);
      setOverId(null);
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

      // Reordering a list column. Separate from the card path below: it writes
      // one list's position and never touches a todo.
      if (draggedListId) {
        const target = parseColumnId(String(over.id));
        if (target?.kind !== "list") return; // dropped outside the planning half
        const plan = planListDrop(lists, draggedListId, target.listId);
        if (!plan) return; // dropped on itself
        landingRectRef.current = landingRect;

        const list = lists.find((l) => l.id === draggedListId);
        if (list) {
          pushUndo(`Moved “${short(list.name)}”`, [
            {
              kind: "list",
              entityId: list.id,
              patch: inversePatch(list, { position: plan.position }),
            },
          ]);
        }
        await updateList(draggedListId, { position: plan.position });
        return;
      }

      if (!board) return;

      // `todosById`, not `todos.find`: a card in flight may be a virtual or
      // force-overflowed recurrence occurrence, neither of which has a real
      // row yet. Materializing it here — a no-op if it already has one —
      // gives every write below a row to land on.
      const draggedCard = todosById.get(String(active.id));
      if (!draggedCard) return;
      const todo = await materializeIfNeeded(draggedCard);

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
        setLandingTodoId(todo.id);

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
      let index = 0;

      if (!target) {
        const overTodo = todosById.get(String(over.id));
        if (!overTodo) return;
        const column = findColumn(board, overTodo.id);
        if (!column) return;
        target = column.target;
        siblings = column.todos;
        index = siblings.findIndex((t) => t.id === overTodo.id);
      } else {
        const column = columnByTarget(board, target);
        siblings = column ?? [];
        index = siblings.length;
      }

      // Exclude the dragged item so it cannot become its own neighbour.
      const ordered = siblings.filter((t) => t.id !== todo.id);
      const position = positionForIndex(ordered, index);

      if (target.kind === "list" || target.kind === "day") {
        // Only a committed move gets a landing. Everything else — a refusal, a
        // cancel, a release over nothing — leaves the rect null, and dnd-kit's
        // return-to-source animation stands. For a refusal that is the right
        // read: the item visibly goes back where it came from.
        landingRectRef.current = landingRect;
        setLandingTodoId(todo.id);
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
      landingRectRef,
      setActiveTodo,
      setActiveList,
      setActiveTab,
      setOverId,
      setLandingTodoId,
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
    (todo: Todo) => {
      const forward = statusPatch("done");
      const entryId = pushUndo(`Completed “${short(todo.title)}”`, [
        { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
      ]);
      // `todo` may be a virtual recurrence occurrence with no row yet —
      // materialize before writing. A no-op when it already has one.
      void (async () => {
        await materializeIfNeeded(todo);
        const eventId = await setTodoStatus(todo.id, "done");
        // EI-94 Phase 3: an instant undo tombstones the `done` event too, so
        // history doesn't show "Completed" for something un-done a second
        // later.
        if (eventId) attachEventIds(entryId, [eventId]);
      })();
      toast.success(`Completed “${short(todo.title)}”`, {
        duration: 6000,
        action: { label: "Undo", onClick: () => void undoById(entryId) },
      });
    },
    [materializeIfNeeded],
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
    (id: string, status: Todo["status"]) => {
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
    },
    [todosById, materializeIfNeeded],
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
    (todo: Todo, verdict: Verdict): { undoId: string; label: string } => {
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

      return { undoId: entryId, label };
    },
    [listsById, materializeIfNeeded],
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
        await deleteTodo(id);
      })();
      toast.success(label, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void undoById(entryId) },
      });
    },
    [todosById, materializeIfNeeded],
  );

  /**
   * List settings. All three close the dialog: the write is instant and local,
   * so leaving it open would mean staring at a form describing a column that
   * has already changed — or, for archive and delete, one that has gone.
   */
  const handleSaveList = useCallback((list: List, patch: ListPatch) => {
    // The undo entry names what actually changed. A rename and a recolor are the
    // same write, and "Renamed" on a recolor is the sort of label that makes ⌘Z
    // look broken.
    const label =
      patch.name !== undefined
        ? `Renamed “${list.name}”`
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
