"use client";

import { useRef, useState } from "react";
import type {
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  TouchEventHandler,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CalendarCheck, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { edge, tint, wash } from "@/lib/colors";
import { listDragId, type TodoGroup } from "@/lib/board";
import { addStop, groupStop, navKeyOf, type NavKey } from "@/lib/column-nav";
import type { Label as LabelRecord, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import { DragGrip } from "./drag-grip";
import { TodoCard } from "./todo-card";

/**
 * A grouped column's order is COMPUTED, so nothing shifts to preview an insertion.
 *
 * Not cosmetic, and not optional. `verticalListSortingStrategy` is called with
 * `overIndex: -1` whenever `over` is a group rather than a card, and at -1 its
 * `index < activeIndex && index >= overIndex` branch (@dnd-kit/sortable
 * sortable.esm.js:245) is TRUE for every card above the dragged one — so the
 * default strategy shoves the top of the column downwards for the whole drag.
 */
const NO_SORTING: SortingStrategy = () => null;

/**
 * Cards in a grouped column are drag SOURCES only; the group is the target.
 *
 * `SortableContext`'s `disabled` reaches every `useSortable` inside it and is
 * forwarded straight to that card's `useDroppable` — and dnd-kit hands only
 * ENABLED droppables to collision detection, so this removes day-column cards
 * from `over` resolution entirely rather than ignoring them afterwards. Which is
 * also why the per-card insertion line needs no gating here: `overTodoId` can no
 * longer name a card in this half.
 */
const CARDS_NOT_DROPPABLE = { draggable: false, droppable: true } as const;

interface BoardColumnProps {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  todos: Todo[];
  labels: LabelRecord[];
  ctx: PlacementContext;
  awayTodoIds?: Set<string>;
  /**
   * How many to-dos anywhere on the board carry a deadline on this column's
   * date. Day columns only — a list column is not a date, so it has no answer.
   * Omitted or 0 renders nothing.
   */
  dueCount?: number;
  /**
   * Grouped rendering, present on day columns and Overflow and absent on list
   * columns — the planning half is arranged by hand.
   *
   * Must partition `todos`; both come off the same `DayColumn`, which derives one
   * from the other, so they cannot disagree by construction.
   */
  groups?: TodoGroup[];
  /** List keys whose groups are collapsed. Shared across the whole calendar half. */
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  /** The group a release would land in — highlight and drop indicator. */
  overGroupId?: string | null;
  emphasis?: boolean;
  /** Rendered in the column header — list rename/delete menus, etc. */
  actions?: React.ReactNode;
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
  /**
   * Omit to drop the quick-add row entirely. Overflow does: nothing can be
   * scheduled into it, so a field there would discard whatever you typed.
   */
  onQuickAdd?: (title: string) => void;
  /**
   * Arrow-key navigation out of this column's cards and quick-add. Returns
   * true when focus moved. See docs/KEYBOARD.md §11.
   */
  onNavigate?: (fromStopId: string, key: NavKey) => boolean;
  /** Ruled lines fill the empty space, matching the reference UI's paper feel. */
  minRows?: number;
  /**
   * Opens this column's detail surface — the list settings dialog for a list
   * column, the day details sheet for a day column. A single click on the
   * heading triggers it.
   *
   * One prop rather than two because it is one gesture: click the heading, see
   * what this column is.
   */
  onOpenInfo?: () => void;
  /** True while any drag is in flight — used to outline candidate targets. */
  isDragActive?: boolean;
  /** Id of the todo the pointer is currently over, for the insertion line. */
  overTodoId?: string | null;
  /** Id of the todo flying to its new slot — hidden until the ghost arrives. */
  landingTodoId?: string | null;
  /**
   * Dropping here will be refused (Overflow). Styled as a rejecting target so
   * the outcome is obvious before the pointer is released.
   */
  rejectsDrop?: boolean;
  /**
   * List id, when this column may be dragged to reorder. Absent for day
   * columns (date-ordered, so reordering is meaningless) and for Backlog,
   * which is pinned leftmost.
   */
  reorderListId?: string;
  /**
   * Keep the grip's width even when this column has no grip, so titles stay
   * aligned across a half. Set on every planning-half column; day columns have
   * no grips at all, so they have nothing to align to.
   */
  reservesGripSlot?: boolean;
  /** True while a list column is being dragged — dims the card affordances. */
  isColumnDragActive?: boolean;
  /**
   * True on the single column a column drag would land next to. Only ever
   * set on a movable column — Backlog can never be the target, since nothing
   * can land before it (see `Board`'s `columnDropTargetId`).
   */
  isColumnDropTarget?: boolean;
  /**
   * The owning tab's color, tinting the header rule. Absent on day columns and
   * on Backlog, neither of which belongs to a tab.
   */
  accentColor?: string | null;
  /**
   * Sits outside the scrolling track as a fixed-width sibling rather than
   * flexing with it — Overflow and Backlog, so they stay reachable however far
   * their track scrolls. Needs its own vertical scroll since it no longer
   * shares the track that provided one.
   */
  pinned?: boolean;
  /**
   * Shrinks to a 40px strip with a vertical label and a count, in place of
   * the ordinary body — only meaningful alongside `pinned`. Stays a real
   * droppable (a collapsed Backlog still accepts a card, landing at the end
   * of the column); Overflow already refuses drops regardless, via
   * `rejectsDrop`.
   */
  collapsed?: boolean;
  /** Expands a collapsed column. Clicking anywhere on the strip triggers it. */
  onExpand?: () => void;
  /**
   * Tags this as a full-width column in the scrolling day track, via
   * `data-day-column`.
   *
   * Read only by `measurePitch` in use-day-track.ts, which needs one column of
   * the track's REPEATING width to turn `scrollLeft` into a day index. It used
   * to take the track's first child, which stopped being safe once a collapsed
   * weekend strip could sort first and hand it 40px instead of 168 — every
   * jump would then land several days short of where it said it would.
   */
  dayTrackColumn?: boolean;
  /**
   * Recurring-occurrence badge counts, keyed by todo id — see
   * `lib/recurrence-expand.ts`. Only ever populated for cards forced into
   * Overflow, but threaded to every column for free rather than special-cased.
   */
  missedCounts?: ReadonlyMap<string, number>;
  /**
   * "Every week on Fri", keyed by TEMPLATE id (`todo.recurrenceParentId`),
   * not by occurrence — one summary per series, unlike `missedCounts`. Used
   * for the repeat icon's tooltip on any card in the series, materialized or
   * virtual, wherever it renders — not just Overflow.
   */
  recurrenceSummaries?: ReadonlyMap<string, string>;
}

export function BoardColumn({
  id,
  title,
  subtitle,
  todos,
  labels,
  ctx,
  awayTodoIds,
  dueCount,
  groups,
  collapsedGroups,
  onToggleGroup,
  overGroupId,
  emphasis,
  actions,
  onToggle,
  onOpen,
  onQuickAdd,
  onNavigate,
  minRows = 8,
  onOpenInfo,
  isDragActive,
  overTodoId,
  landingTodoId,
  rejectsDrop,
  reorderListId,
  reservesGripSlot,
  isColumnDragActive,
  isColumnDropTarget,
  accentColor,
  pinned,
  collapsed,
  onExpand,
  dayTrackColumn,
  missedCounts,
  recurrenceSummaries,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [draft, setDraft] = useState("");

  /**
   * The list name when this column can be reordered, null when it cannot.
   *
   * One value drives all three halves of the gesture — the hook, the header's
   * cursor, and the grip — so the header can never become a drag surface for a
   * column with no grip to drag it by from the keyboard. It carries the name
   * rather than a boolean because the grip has to announce it, and only this
   * check knows the title is a string rather than arbitrary nodes.
   */
  const dragListName = reorderListId && typeof title === "string" ? title : null;

  /**
   * The column's own drag source, for reordering.
   *
   * Called here rather than inside the grip so that the whole header can start
   * the drag, the way the whole row does on a card (§4.9). Called
   * unconditionally with `disabled` rather than from a child that only renders
   * for movable columns, because hooks cannot be conditional and this header
   * markup is shared by every column — the alternative was two copies of it. A
   * disabled draggable registers but can never activate, so day columns and
   * Backlog stay exactly as inert as they were.
   */
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: reorderListId ? listDragId(reorderListId) : `${id}:fixed`,
    disabled: dragListName === null,
  });

  // dnd-kit types its listeners as bare `Function`, which spreads onto an
  // element fine but cannot be assigned to a specific handler prop. The
  // activators go to different elements here, so name them once. All are
  // undefined while disabled — dnd-kit withholds the listeners entirely, so a
  // day column's header gets no handler at all rather than a guarded one.
  //
  // `onMouseDown`/`onTouchStart`, not `onPointerDown`: the sensors are a
  // MouseSensor and a TouchSensor rather than one PointerSensor (§4.8), and each
  // sensor names its own activator. Destructuring the wrong one fails silently —
  // an undefined handler is a header that simply does not drag.
  const {
    onMouseDown: startMouseDrag,
    onTouchStart: startTouchDrag,
    onKeyDown: startKeyboardDrag,
  } = (dragListeners ?? {}) as {
    onMouseDown?: MouseEventHandler;
    onTouchStart?: TouchEventHandler;
    onKeyDown?: KeyboardEventHandler;
  };

  const commit = () => {
    const title = draft.trim();
    if (!title || !onQuickAdd) return;
    onQuickAdd(title);
    setDraft(""); // Keep focus so several todos can be typed in a row.
  };

  /**
   * The groups to render, or null for a flat column.
   *
   * An ARRAY-or-null rather than a boolean flag, so narrowing it below needs no
   * assertion — and `length > 0` rather than mere presence, because `groups` is
   * `[]` on a day column with no lists to group by (`buildBoard`'s degenerate
   * fallback) and in that state the flat `todos` are still the contents.
   */
  const grouped = groups && groups.length > 0 ? groups : null;

  // Group headers occupy vertical space the filler arithmetic did not know
  // about. A header is ~19px against a 32px filler row, so counting them 1:1
  // slightly under-fills — the safe direction.
  const fillerRows = Math.max(0, minRows - todos.length - (groups?.length ?? 0));

  /**
   * The card rows, so the markup exists once whether or not the column groups.
   *
   * A function rather than a second component: it closes over eight props that
   * would otherwise all have to be threaded through, and it renders no element of
   * its own.
   */
  const renderCards = (rows: Todo[]) =>
    rows.map((todo) => (
      <TodoCard
        key={todo.id}
        todo={todo}
        labels={labels}
        ctx={ctx}
        isAway={awayTodoIds?.has(todo.id)}
        // A grouped column has no per-card insertion line: its cards are not
        // droppables, so `overTodoId` can never name one of them anyway (see
        // CARDS_NOT_DROPPABLE). The group highlight is the indicator there.
        showInsertionLine={!rejectsDrop && overTodoId === todo.id}
        isLanding={landingTodoId === todo.id}
        onToggle={onToggle}
        onOpen={onOpen}
        onNavigate={onNavigate}
        missedCount={missedCounts?.get(todo.id)}
        recurrenceSummary={
          todo.recurrenceParentId ? recurrenceSummaries?.get(todo.recurrenceParentId) : undefined
        }
      />
    ));

  return (
    <section
      ref={setNodeRef}
      aria-label={
        collapsed
          ? `Expand the ${typeof title === "string" ? title : "column"}`
          : typeof title === "string"
            ? title
            : undefined
      }
      role={collapsed ? "button" : undefined}
      tabIndex={collapsed ? 0 : undefined}
      onClick={collapsed ? onExpand : undefined}
      onKeyDown={
        collapsed
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onExpand?.();
              }
            }
          : undefined
      }
      className={cn(
        "group/column relative flex flex-col rounded-md transition-all",
        collapsed && "w-10 min-h-0 flex-1 shrink-0 cursor-pointer items-center",
        pinned && !collapsed
          ? // Fixed-width child of PINNED_PANEL's flex column, not of the
            // scrolling track — `flex-1` sizes it on the panel's main axis
            // (height, so it fills the panel top to bottom) while the fixed
            // width holds; `min-h-0` is what lets its own vertical scroll
            // engage instead of the panel just growing to fit its content.
            "w-(--column-min) min-h-0 flex-1 overflow-y-auto"
          : !pinned &&
            // Grows to fill the half, but between a floor and a ceiling. The
            // floor is what pushes the half into horizontal scroll once the
            // columns stop fitting; see --column-min in globals.css.
            "flex-1 min-w-(--column-min) max-w-(--column-max)",
        // Four distinct drag states, so at a glance you can tell where a drop
        // is possible, where it will land, and where it will be refused.
        //   candidate — every valid column, dashed and quiet (card drag)
        //   active    — the column under the pointer, solid ring and tint
        //               (card drag OR the single column drop target)
        //   rejecting — Overflow, which refuses drops
        // A card drag and a column drag never overlap — `isDragActive` and
        // `isColumnDragActive` are mutually exclusive booleans on the board —
        // so both can safely drive the same "active" style without a clash.
        // `data-drop-indicator` marks it for the drop animation to fly the
        // column chip to, exactly as it does for a card.
        isDragActive && !isOver && !rejectsDrop &&
          "outline-dashed outline-1 outline-offset-[-2px] outline-border",
        ((isOver && !rejectsDrop && !isColumnDragActive) ||
          (isColumnDragActive && isColumnDropTarget)) &&
          "bg-primary/5 outline outline-2 outline-offset-[-2px] outline-primary",
        isDragActive && rejectsDrop && !isOver &&
          "outline-dashed outline-1 outline-offset-[-2px] outline-destructive/30",
        isOver && rejectsDrop && !isColumnDragActive &&
          "bg-destructive/5 outline outline-2 outline-offset-[-2px] outline-destructive/60",
      )}
      data-drop-indicator={isColumnDragActive && isColumnDropTarget ? "" : undefined}
      data-day-column={dayTrackColumn ? "" : undefined}
    >
      <header
        ref={setDragRef}
        /*
          The whole header is the drag surface, matching a card's whole row
          (§4.9). Only the pointer activators move here: `attributes` and the
          keyboard activator stay on the grip, which is a real focusable control
          and can carry them without making the header a button that contains
          buttons.

          Scoped to the header rather than the section because the column body
          is full of cards that are drag sources themselves — a press there has
          to mean "drag this card", not "drag its column".
        */
        onMouseDown={startMouseDrag}
        onTouchStart={startTouchDrag}
        className={cn(
          // Relative regardless of branch: harmless when nothing inside is
          // absolutely positioned, and it's what lets RailCollapseButton (in
          // the `actions` slot) anchor to the heading's own box rather than
          // the whole column when it's passed for Overflow/Backlog.
          "relative",
          collapsed
            ? "flex flex-1 flex-col items-center gap-2 px-1 py-2"
            : "flex items-baseline justify-between gap-2 px-2 pb-1",
          // Stated rather than inherited, so the header advertises the gesture
          // across its whole width and not just over the grip.
          dragListName !== null && "cursor-grab active:cursor-grabbing",
          // Only drawn when the tab has a color, so an uncolored tab keeps
          // the original headers rather than gaining a grey rule.
          accentColor && !collapsed && "border-b-2",
        )}
        style={accentColor && !collapsed ? { borderColor: edge(accentColor) } : undefined}
      >
        {collapsed ? (
          <>
            {todos.length > 0 && (
              <span className="num text-2xs font-medium text-muted-foreground">
                {todos.length}
              </span>
            )}
            <h2
              className={cn(
                "truncate font-heading text-lg font-bold uppercase tracking-tight",
                "[writing-mode:vertical-rl] rotate-180",
                emphasis && "text-primary",
              )}
            >
              {title}
            </h2>
          </>
        ) : (
          <>
            <div className="min-w-0">
              {subtitle && (
                <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {subtitle}
                </p>
              )}
              {/*
                Grip sits immediately left of the name, matching a todo row. The
                empty slot on Backlog is deliberate: it cannot be reordered, but
                without the reserved space its title would sit flush left while
                every neighbouring column's title was indented past a grip.

                The header drags on its own now, so the grip is no longer the only
                way in — but it stays a real control because it is the keyboard
                activator, which a bare `<header>` cannot be without becoming a
                button full of buttons. Touch no longer depends on it: the
                TouchSensor's long press covers the whole header (§4.8).
              */}
              <div className="flex min-w-0 items-center gap-1.5">
                {dragListName !== null ? (
                  <DragGrip
                    aria-label={`Drag to reorder the ${dragListName} list`}
                    className={cn(
                      // Visible at rest, not hover-only, so the affordance is
                      // discoverable without sweeping the header.
                      "group-hover/column:text-muted-foreground",
                      isDragging && "opacity-40",
                    )}
                    {...dragAttributes}
                    onKeyDown={startKeyboardDrag}
                  />
                ) : (
                  reservesGripSlot && <span className="size-3 shrink-0" aria-hidden />
                )}
                {/*
                  A real button inside the heading, not an `onClick` on the h2.
                  `<h2><button>` is the standard accessible heading-action
                  pattern; the bare handler this replaced was pointer-only, so
                  the list dialog was unreachable by keyboard or AT.

                  This does not fight the header drag. On day columns there is
                  no drag to fight — `dragListName` is null, so dnd-kit
                  withholds its listeners and `<header>` carries none. On list
                  columns it behaves exactly as the old handler did: dnd-kit
                  swallows the trailing click once a drag activates, and below
                  the MouseSensor's 4px / TouchSensor's 250ms thresholds nothing
                  activates, so an ordinary click lands. Same mechanism the
                  card's checkbox already relies on.
                */}
                <h2
                  className={cn(
                    "min-w-0 truncate font-heading text-lg font-bold uppercase tracking-tight",
                    emphasis && "text-primary",
                  )}
                >
                  {onOpenInfo ? (
                    <button
                      type="button"
                      onClick={onOpenInfo}
                      className="max-w-full cursor-pointer truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {title}
                    </button>
                  ) : (
                    title
                  )}
                </h2>
              </div>
            </div>
            {actions}
          </>
        )}
      </header>

      {/*
        DEADLINES DUE THIS DAY.

        Counted across the whole board, not just this column: a to-do due Friday
        may well be scheduled for Tuesday, and the point of the banner is to warn
        you before Friday arrives. So it is a property of the *date*, not of the
        column's contents, and `board.tsx` computes it from every todo.

        Deliberately loud — destructive tint, full column width, directly under
        the header — because it is the one thing on the board that a plan can be
        wrong about without anything else looking wrong.
      */}
      {!collapsed && dueCount !== undefined && dueCount > 0 && (
        <div
          data-due-banner={dueCount}
          className={cn(
            "flex items-center gap-1 border-b border-destructive/20 bg-destructive/10",
            "px-2 py-0.5 text-2xs font-medium text-destructive",
          )}
        >
          <CalendarCheck className="size-3 shrink-0" aria-hidden />
          <span aria-hidden>
            <span className="num">{dueCount}</span> due
          </span>
          <span className="sr-only">
            {dueCount === 1 ? "1 to-do is" : `${dueCount} to-dos are`} due on this
            day
          </span>
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-1 flex-col">
          {/*
            `groups?.length` rather than `groups`: an empty array is `buildBoard`'s
            degenerate no-lists fallback, where the flat `todos` are still the
            column's contents. Branching on the array's existence would render
            `[].map(...)` and drop every card on the floor.
          */}
          <SortableContext
            items={todos.map((t) => t.id)}
            strategy={grouped ? NO_SORTING : verticalListSortingStrategy}
            disabled={grouped ? CARDS_NOT_DROPPABLE : undefined}
          >
            {grouped ? (
              grouped.map((group) => (
                <TodoGroupSection
                  key={group.id}
                  group={group}
                  collapsed={!!collapsedGroups?.has(group.key)}
                  isOver={overGroupId === group.id}
                  droppable={!rejectsDrop}
                  onToggle={onToggleGroup}
                  onNavigate={onNavigate}
                >
                  {renderCards(group.todos)}
                </TodoGroupSection>
              ))
            ) : (
              renderCards(todos)
            )}
          </SortableContext>

          {/*
            Hovering the column itself rather than a specific card means the item
            lands at the end, so show the indicator there instead.

            `!isColumnDragActive` matters: `isOver` is dnd-kit's own per-droppable
            state and knows nothing about which kind of drag is in flight, so
            without this a column drag hovering here would ALSO light up this
            card-drop dot — a stray card-drop indicator bleeding into a column
            drag, which is a different bug from, but the same shape as, the
            reason `isColumnDropTarget` exists above.
          */}
          {/*
            `!overGroupId` keeps at most ONE `data-drop-indicator` on screen,
            which `readLandingRect()` depends on — with two, the dragged card
            flies to whichever one `querySelector` happens to find first.
          */}
          {isOver && !rejectsDrop && !overTodoId && !overGroupId && !isColumnDragActive && (
            <span
              aria-hidden
              data-drop-indicator
              className="relative block h-0.5 rounded-full bg-primary"
            >
              <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
            </span>
          )}

          {/* Quick add sits directly under the last item, like the reference UI. */}
          {onQuickAdd && (
            <div className="group relative flex items-center border-b border-border/60">
              <Plus
                className="pointer-events-none absolute left-2 size-3 text-muted-foreground/40 opacity-0 group-focus-within:opacity-100"
                aria-hidden
              />
              <input
                data-nav-stop={addStop(id)}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === "Escape") setDraft("");

                  const key = navKeyOf(e);
                  if (!key) return;
                  /*
                    Caret motion wins while there is text to move through — and
                    more importantly, `onBlur` commits, so navigating away
                    mid-draft would silently create the to-do you were still
                    typing. Enter already clears the draft and keeps focus, so
                    type → Enter → `→` is the intended loop.
                  */
                  if (draft !== "") return;
                  if (onNavigate?.(addStop(id), key)) e.preventDefault();
                }}
                onBlur={commit}
                placeholder="Add a to-do"
                aria-label={
                  typeof title === "string" ? `Add a to-do to ${title}` : "Add a to-do"
                }
                className={cn(
                  "w-full bg-transparent px-2 py-1.5 text-sm outline-none",
                  "placeholder:text-transparent focus:placeholder:text-muted-foreground/60",
                  "group-focus-within:pl-6",
                )}
              />
            </div>
          )}

          {/* Ruled filler lines. Decorative only. */}
          {Array.from({ length: fillerRows }, (_, i) => (
            <div key={i} className="h-8 border-b border-border/40" aria-hidden />
          ))}
        </div>
      )}
    </section>
  );
}

interface TodoGroupSectionProps {
  group: TodoGroup;
  collapsed: boolean;
  /** A release here would land in this group. */
  isOver: boolean;
  /** False on Overflow, which refuses drops — so it registers no target at all. */
  droppable: boolean;
  onToggle?: (key: string) => void;
  onNavigate?: (fromStopId: string, key: NavKey) => boolean;
  children: ReactNode;
}

/**
 * One list's run of cards inside a computed column, under a collapsible header.
 *
 * Local to this file because it calls `useDroppable`, which needs the
 * `DndContext` this column already sits inside — and because the header and the
 * wash are only meaningful next to the cards they belong to.
 */
function TodoGroupSection({
  group,
  collapsed,
  isOver,
  droppable,
  onToggle,
  onNavigate,
  children,
}: TodoGroupSectionProps) {
  const { setNodeRef } = useDroppable({ id: group.id, disabled: !droppable });
  const headerRef = useRef<HTMLButtonElement>(null);
  const cardsId = `${group.id}-cards`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative",
        /*
          The group highlight REPLACES the per-card insertion line in this half.
          A drop here means "belongs to this list", which is a statement about the
          whole group rather than about a slot between two cards — so a line
          between two cards would promise precision the write does not have.
        */
        isOver && "bg-primary/5 outline outline-2 outline-offset-[-2px] outline-primary",
      )}
    >
      <button
        ref={headerRef}
        type="button"
        /*
          A real `<button>`, so Enter and Space toggle natively — but
          `tabIndex={-1}`, reached by the arrow keys only, exactly like a card
          row. Tabbable headers were the obvious thing and they are wrong: a
          seven-day week with four lists is 28 new Tab stops standing between the
          user and the first quick-add.

          Unlike a card row this CAN carry a role, because it contains only text,
          a chevron and a count — there is no nested control to worry about.
        */
        tabIndex={-1}
        data-nav-stop={groupStop(group.id)}
        aria-expanded={!collapsed}
        aria-controls={cardsId}
        // The count is visible only when collapsed but always in the accessible
        // name: a screen-reader user has no "glance".
        aria-label={`${group.name}, ${group.todos.length} ${
          group.todos.length === 1 ? "to-do" : "to-dos"
        }`}
        onClick={() => {
          onToggle?.(group.key);
          // Collapsing removes the cards from the DOM. If focus was inside them
          // it lands on <body> and the arrow keys go dead, so pull it up to the
          // header — which is where a keyboard user would expect to still be.
          headerRef.current?.focus({ preventScroll: true });
        }}
        onKeyDown={(e) => {
          const key = navKeyOf(e);
          if (key && onNavigate?.(groupStop(group.id), key)) e.preventDefault();
        }}
        className={cn(
          "flex w-full items-center gap-1 border-b px-2 py-0.5 text-left",
          "text-2xs font-medium uppercase tracking-wide text-muted-foreground",
          "cursor-pointer transition-colors hover:bg-accent/50",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          // An uncolored list keeps the ordinary rule rather than gaining a grey
          // one — the same rule the column header's tab accent follows.
          !group.color && "border-border/60",
        )}
        /*
          Colour rides the border and a faint fill, never the text: a Radix step-9
          hue at `text-2xs` fails contrast in one theme or the other, which is the
          same reason `lib/priority.ts` keeps its palette to fills.
        */
        style={
          group.color
            ? { borderColor: edge(group.color), backgroundColor: tint(group.color) }
            : undefined
        }
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 transition-transform",
            collapsed && "-rotate-90",
          )}
          aria-hidden
        />
        <span className="truncate">{group.name}</span>
        {collapsed && (
          <span className="num ml-auto shrink-0" aria-hidden>
            {group.todos.length}
          </span>
        )}
      </button>

      {/*
        THE WASH sits behind the run of cards, not on each card — which is also
        why nothing here fights `hover:bg-accent/50`. That hover is 50% alpha and
        composites over this; an inline `style.backgroundColor` on the card would
        have beaten the hover class outright, since inline always wins, and the fix
        would have been a `bg-[var(--wash,transparent)]` custom-property dance on
        every row. Behind them, there is nothing to fix.
      */}
      <div id={cardsId} style={{ backgroundColor: wash(group.color) }}>
        {!collapsed && children}
      </div>

      {isOver && (
        <span
          aria-hidden
          data-drop-indicator
          className="relative block h-0.5 rounded-full bg-primary"
        >
          <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
        </span>
      )}
    </div>
  );
}
