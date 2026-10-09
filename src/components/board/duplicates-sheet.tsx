"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { isHeldDuplicate } from "@/lib/duplicates";
import { formatShortDate } from "@/lib/scheduling";
import type { List, Todo } from "@/lib/schema";

interface DuplicatesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `useDuplicateTodos()` — open to-dos the server flagged. */
  duplicates: Todo[];
  /** To resolve each flag's `duplicateOf` to the to-do it matched. */
  todosById: ReadonlyMap<string, Todo>;
  listsById: ReadonlyMap<string, List>;
  backlogList: List | undefined;
  /** `settings.holdAllDuplicates` — decides "Add to board" vs "Keep both". */
  holdAll: boolean;
  /** "Mark as duplicate and remove" — the board's own delete, with its Undo toast. */
  onRemove: (id: string) => void;
  /** "Add to board" / "Keep both" — clears the flag. */
  onKeep: (id: string) => void;
  onOpenTodo: (id: string) => void;
}

/**
 * The review queue for probable duplicates (EI-346). Opened from the account
 * menu, ⌘K, or the toast that announced a flag.
 *
 * Plain rows, never `TodoCard`, so — like `ActivitySheet` — it is safe to
 * mount inside the board's DndContext.
 */
export function DuplicatesSheet({
  open,
  onOpenChange,
  duplicates,
  todosById,
  listsById,
  backlogList,
  holdAll,
  onRemove,
  onKeep,
  onOpenTodo,
}: DuplicatesSheetProps) {
  const where = (todo: Todo) => {
    const list = (todo.listId && listsById.get(todo.listId)) || backlogList;
    return [list?.name, todo.scheduledDate && formatShortDate(todo.scheduledDate)].filter(Boolean).join(" · ");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[60ch]">
        <SheetHeader className="pr-10">
          <SheetTitle className="font-heading uppercase tracking-tight">Duplicates</SheetTitle>
          <SheetDescription className="text-xs">
            New to-dos that look like one already on your board.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {duplicates.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No possible duplicates right now.</p>
          ) : (
            <ul aria-label="Possible duplicates" className="space-y-3">
              {duplicates.map((todo) => {
                const match = todo.duplicateOf ? todosById.get(todo.duplicateOf) : undefined;
                return (
                  <li key={todo.id} className="space-y-2 rounded-md border p-3">
                    <button
                      type="button"
                      onClick={() => onOpenTodo(todo.id)}
                      className="focus-ring block text-left text-sm font-medium hover:underline"
                    >
                      {todo.title}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {match ? (
                        <>
                          Looks like{" "}
                          <button
                            type="button"
                            onClick={() => onOpenTodo(match.id)}
                            className="focus-ring text-foreground hover:underline"
                          >
                            “{match.title}”
                          </button>
                          {where(match) ? ` in ${where(match)}` : null}
                        </>
                      ) : (
                        "The to-do it matched is no longer on your board."
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="xs" variant="outline" onClick={() => onRemove(todo.id)}>
                        Mark as duplicate and remove
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => onKeep(todo.id)}>
                        {isHeldDuplicate(todo, holdAll) ? "Add to board" : "Keep both"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
