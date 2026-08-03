"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Command as CommandIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Todo } from "@/lib/schema";
import { buildBoard, parseColumnId } from "@/lib/board";
import { positionForIndex } from "@/lib/ordering";
import { OVERFLOW } from "@/lib/scheduling";
import {
  useBootstrap,
  useLabels,
  useLists,
  usePlacementContext,
  useProjects,
  useSettings,
  useTodos,
} from "@/lib/store/hooks";
import {
  createTodo,
  deleteTodo,
  moveTodoToList,
  scheduleTodo,
  setTodoStatus,
  toggleTodoLabel,
  updateTodo,
} from "@/lib/store/repositories";
import { BoardColumn } from "./board-column";
import { TodoSheet } from "./todo-sheet";
import { CommandPalette } from "./command-palette";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Format a civil date for display without reintroducing timezone drift. */
function formatDay(day: string) {
  // Parse as UTC so the formatter cannot shift the calendar day.
  const date = new Date(`${day}T12:00:00Z`);
  return { weekday: WEEKDAY.format(date), label: MONTH_DAY.format(date) };
}

export function Board() {
  const ready = useBootstrap();
  const todos = useTodos();
  const lists = useLists();
  const labels = useLabels();
  const projects = useProjects();
  const settings = useSettings();
  const ctx = usePlacementContext(settings);

  const [activeTodo, setActiveTodo] = useState<Todo | null>(null);
  const [openTodo, setOpenTodo] = useState<Todo | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd/Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(
    // A small activation distance keeps clicks and drags distinguishable, and
    // makes touch dragging usable inside a Capacitor WebView later.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const board = useMemo(
    () => (ctx ? buildBoard(todos, lists, ctx) : null),
    [todos, lists, ctx],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveTodo(todos.find((t) => t.id === event.active.id) ?? null);
    },
    [todos],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTodo(null);
      if (!over || !board) return;

      const todo = todos.find((t) => t.id === active.id);
      if (!todo) return;

      // `over` may be a column or another todo. Resolve the owning column.
      let target = parseColumnId(String(over.id));
      let siblings: Todo[] = [];
      let index = 0;

      if (!target) {
        const overTodo = todos.find((t) => t.id === over.id);
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

      if (target.kind === "list") {
        await moveTodoToList(todo.id, target.listId, position);
      } else if (target.kind === "day") {
        await scheduleTodo(todo.id, target.day, position);
      } else {
        // Dropping into Overflow is a triage gesture, not a schedule. Leave the
        // date alone so the item stays overdue rather than silently becoming
        // "due today" — the user still has to decide what to do with it.
        toast("Reschedule, complete, or move it to a list", {
          description: "Overflow is for deciding, not parking.",
        });
      }
    },
    [board, todos],
  );

  const handleQuickAdd = useCallback(
    (title: string, target: { listId?: string; day?: string }) => {
      void createTodo({
        title,
        listId: target.listId ?? null,
        scheduledDate: target.day ?? null,
      });
    },
    [],
  );

  const handleToggle = useCallback((todo: Todo) => {
    void setTodoStatus(todo.id, todo.status === "done" ? "open" : "done");
  }, []);

  if (!ready || !ctx || !board || !settings) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading your board…
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-dvh flex-col">
        {/* Calendar half */}
        <div className="flex flex-1 gap-px overflow-x-auto border-b bg-border/40 px-4 pt-4">
          <BoardColumn
            id={board.overflow.id}
            title="Overflow"
            subtitle="Put off too long"
            todos={board.overflow.todos}
            labels={labels}
            ctx={ctx}
            onToggle={handleToggle}
            onOpen={setOpenTodo}
            onQuickAdd={() => {}}
            emphasis
          />
          {board.days.map((column) => {
            const { weekday, label } = formatDay(column.day);
            const isToday = column.day === ctx.today;
            return (
              <BoardColumn
                key={column.id}
                id={column.id}
                title={weekday}
                subtitle={label}
                todos={column.todos}
                labels={labels}
                ctx={ctx}
                emphasis={isToday}
                onToggle={handleToggle}
                onOpen={setOpenTodo}
                onQuickAdd={(title) => handleQuickAdd(title, { day: column.day })}
              />
            );
          })}
        </div>

        {/* Planning half */}
        <div className="flex flex-[0.8] flex-col bg-muted/30">
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide">
              My Lists
            </span>
            <span className="text-xs text-muted-foreground">{lists.length}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <CommandIcon className="size-3" aria-hidden />
                Commands
                <kbd className="ml-1 rounded border bg-background px-1 font-mono text-[10px]">
                  ⌘K
                </kbd>
              </Button>
            </div>
          </div>
          <Separator />
          <div className="flex flex-1 gap-px overflow-x-auto bg-border/40 px-4 pt-3">
            {board.lists.map((column) => (
              <BoardColumn
                key={column.id}
                id={column.id}
                title={column.list.name}
                todos={column.todos}
                labels={labels}
                ctx={ctx}
                awayTodoIds={board.awayTodoIds}
                onToggle={handleToggle}
                onOpen={setOpenTodo}
                onQuickAdd={(title) =>
                  handleQuickAdd(title, { listId: column.list.id })
                }
                minRows={5}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeTodo && (
          <div className="rounded border bg-background px-2 py-1.5 text-sm shadow-lg">
            {activeTodo.title}
          </div>
        )}
      </DragOverlay>

      <TodoSheet
        todo={openTodo}
        lists={lists}
        labels={labels}
        projects={projects}
        onClose={() => setOpenTodo(null)}
        onSave={(id, patch) => void updateTodo(id, patch)}
        onToggleLabel={(todoId, labelId) => void toggleTodoLabel(todoId, labelId)}
        onDelete={(id) => void deleteTodo(id)}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        lists={lists}
        settings={settings}
      />
    </DndContext>
  );
}

/** Locate which column currently holds a todo. */
function findColumn(
  board: NonNullable<ReturnType<typeof buildBoard>>,
  todoId: string,
) {
  for (const day of board.days) {
    if (day.todos.some((t) => t.id === todoId)) {
      return { target: { kind: "day" as const, day: day.day }, todos: day.todos };
    }
  }
  if (board.overflow.todos.some((t) => t.id === todoId)) {
    return { target: { kind: "overflow" as const }, todos: board.overflow.todos };
  }
  for (const column of board.lists) {
    if (column.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "list" as const, listId: column.list.id },
        todos: column.todos,
      };
    }
  }
  return null;
}

/** The todos currently in a given drop target. */
function columnByTarget(
  board: NonNullable<ReturnType<typeof buildBoard>>,
  target: NonNullable<ReturnType<typeof parseColumnId>>,
): Todo[] | null {
  if (target.kind === "day") {
    return board.days.find((d) => d.day === target.day)?.todos ?? null;
  }
  if (target.kind === "overflow") return board.overflow.todos;
  return board.lists.find((c) => c.list.id === target.listId)?.todos ?? null;
}

export { OVERFLOW };
