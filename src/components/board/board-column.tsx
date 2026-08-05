"use client";

import { useState } from "react";
import type { KeyboardEventHandler, PointerEventHandler } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { edge } from "@/lib/colors";
import { listDragId } from "@/lib/board";
import type { Label as LabelRecord, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import { DragGrip } from "./drag-grip";
import { TodoCard } from "./todo-card";

interface BoardColumnProps {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  todos: Todo[];
  labels: LabelRecord[];
  ctx: PlacementContext;
  awayTodoIds?: Set<string>;
  emphasis?: boolean;
  /** Rendered in the column header — list rename/delete menus, etc. */
  actions?: React.ReactNode;
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
  onQuickAdd: (title: string) => void;
  /** Ruled lines fill the empty space, matching the reference UI's paper feel. */
  minRows?: number;
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
   * The owning tab's colour, tinting the header rule. Absent on day columns and
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
}

export function BoardColumn({
  id,
  title,
  subtitle,
  todos,
  labels,
  ctx,
  awayTodoIds,
  emphasis,
  actions,
  onToggle,
  onOpen,
  onQuickAdd,
  minRows = 8,
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
  // element fine but cannot be assigned to a specific handler prop. The two
  // activators go to different elements here, so name them once. Both are
  // undefined while disabled — dnd-kit withholds the listeners entirely, so a
  // day column's header gets no handler at all rather than a guarded one.
  const { onPointerDown: startPointerDrag, onKeyDown: startKeyboardDrag } =
    (dragListeners ?? {}) as {
      onPointerDown?: PointerEventHandler;
      onKeyDown?: KeyboardEventHandler;
    };

  const commit = () => {
    const title = draft.trim();
    if (!title) return;
    onQuickAdd(title);
    setDraft(""); // Keep focus so several todos can be typed in a row.
  };

  const fillerRows = Math.max(0, minRows - todos.length);

  return (
    <section
      ref={setNodeRef}
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        "group/column relative flex flex-col rounded-md transition-all",
        pinned
          ? // Fixed-width sibling of the track, not a flex child of it — it
            // keeps its own vertical scroll since the track no longer gives
            // it one.
            "w-(--column-min) shrink-0 overflow-y-auto"
          : // Grows to fill the half, but between a floor and a ceiling. The
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
    >
      <header
        ref={setDragRef}
        /*
          The whole header is the drag surface, matching a card's whole row
          (§4.9). Only `onPointerDown` moves here: `attributes` and the keyboard
          activator stay on the grip, which is a real focusable control and can
          carry them without making the header a button that contains buttons.

          Scoped to the header rather than the section because the column body
          is full of cards that are drag sources themselves — a pointerdown
          there has to mean "drag this card", not "drag its column".
        */
        onPointerDown={startPointerDrag}
        className={cn(
          "flex items-baseline justify-between gap-2 px-2 pb-1",
          // Stated rather than inherited, so the header advertises the gesture
          // across its whole width and not just over the grip.
          dragListName !== null && "cursor-grab active:cursor-grabbing",
          // Only drawn when the tab has a colour, so an uncoloured tab keeps
          // the original headers rather than gaining a grey rule.
          accentColor && "border-b-2",
        )}
        style={accentColor ? { borderColor: edge(accentColor) } : undefined}
      >
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
            way in — but it stays a real control for the same two reasons it
            does on a card: it is the keyboard activator, and it is the only
            surface carrying `touch-none`, so on touch it remains the drag
            surface while the track keeps its scrolling.
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
            <h2
              className={cn(
                "truncate font-heading text-lg font-bold uppercase tracking-tight",
                emphasis && "text-primary",
              )}
            >
              {title}
            </h2>
          </div>
        </div>
        {actions}
      </header>

      <div className="flex flex-1 flex-col">
        <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {todos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              labels={labels}
              ctx={ctx}
              isAway={awayTodoIds?.has(todo.id)}
              showInsertionLine={!rejectsDrop && overTodoId === todo.id}
              isLanding={landingTodoId === todo.id}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
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
        {isOver && !rejectsDrop && !overTodoId && !isColumnDragActive && (
          <span
            aria-hidden
            data-drop-indicator
            className="relative block h-0.5 rounded-full bg-primary"
          >
            <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
          </span>
        )}

        {/* Quick add sits directly under the last item, like the reference UI. */}
        <div className="group relative flex items-center border-b border-border/60">
          <Plus
            className="pointer-events-none absolute left-2 size-3 text-muted-foreground/40 opacity-0 group-focus-within:opacity-100"
            aria-hidden
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setDraft("");
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

        {/* Ruled filler lines. Decorative only. */}
        {Array.from({ length: fillerRows }, (_, i) => (
          <div key={i} className="h-8 border-b border-border/40" aria-hidden />
        ))}
      </div>
    </section>
  );
}
