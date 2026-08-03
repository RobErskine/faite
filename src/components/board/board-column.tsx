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
        "flex min-w-0 flex-1 flex-col transition-colors",
        isOver && "bg-accent/40",
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
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

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
