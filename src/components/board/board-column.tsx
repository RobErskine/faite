"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Label as LabelRecord, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
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
  /**
   * Dropping here will be refused (Overflow). Styled as a rejecting target so
   * the outcome is obvious before the pointer is released.
   */
  rejectsDrop?: boolean;
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
  rejectsDrop,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [draft, setDraft] = useState("");

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
        "flex min-w-0 flex-1 flex-col rounded-md transition-all",
        // Three distinct drag states, so at a glance you can tell where a drop
        // is possible, where it will land, and where it will be refused.
        //   candidate — every valid column, dashed and quiet
        //   active    — the column under the pointer, solid ring and tint
        //   rejecting — Overflow, which refuses drops
        isDragActive && !isOver && !rejectsDrop &&
          "outline-dashed outline-1 outline-offset-[-2px] outline-border",
        isOver && !rejectsDrop &&
          "bg-primary/5 outline outline-2 outline-offset-[-2px] outline-primary",
        isDragActive && rejectsDrop && !isOver &&
          "outline-dashed outline-1 outline-offset-[-2px] outline-destructive/30",
        isOver && rejectsDrop &&
          "bg-destructive/5 outline outline-2 outline-offset-[-2px] outline-destructive/60",
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-2 pb-1">
        <div className="min-w-0">
          {subtitle && (
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {subtitle}
            </p>
          )}
          <h2
            className={cn(
              "truncate text-lg font-bold uppercase tracking-tight",
              emphasis && "text-primary",
            )}
          >
            {title}
          </h2>
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
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {/*
          Hovering the column itself rather than a specific card means the item
          lands at the end, so show the indicator there instead.
        */}
        {isOver && !rejectsDrop && !overTodoId && (
          <span aria-hidden className="relative block h-0.5 rounded-full bg-primary">
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
