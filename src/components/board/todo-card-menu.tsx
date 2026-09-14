"use client";

import { Ban, Check, SquarePen, Trash2, Undo2 } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { formatCombo } from "@/lib/keyboard";
import { usePlatform } from "@/lib/use-platform";
import type { PlacementContext } from "@/lib/scheduling";
import type { CivilDate, Todo } from "@/lib/schema";
import { RescheduleSubmenu } from "./reschedule-submenu";

/**
 * What a to-do's right-click menu can do (EI-285).
 *
 * Every entry already exists somewhere else — the checkbox, the sheet footer,
 * ⌘K, a drag. That is deliberate and is Base UI's own guidance: a context menu
 * is an accelerator, never the only route to an action. It is also what lets
 * this ship with no visible `⋯` button on the card and no accessibility
 * regression, since nothing here is reachable ONLY by right-click.
 *
 * The handlers resolve their own targets. A card is never told what else is
 * selected — it passes its own `todo` and a count, and `use-board-actions.ts`
 * decides whether that means one row or the whole selection. Keeping the
 * selection out of `TodoCard` is what stops a stale id reaching `mutate()`.
 */
export interface TodoContextActions {
  /**
   * A right-click landed on this card, before the menu opens. Collapses a
   * selection this card is not part of — the same rule a drag already
   * follows, since either gesture is a statement about what you meant.
   */
  onTarget: (todoId: string) => void;
  onStatus: (todo: Todo, status: Todo["status"]) => void;
  onDelete: (todo: Todo) => void;
  onReschedule: (todo: Todo, date: CivilDate) => void;
  /** Unschedule back into the list the to-do belongs to (EI-336). */
  onMoveBackToList: (todo: Todo) => void;
  /** The name "Move back to …" shows — the card itself holds no list data. */
  homeListName: (todo: Todo) => string;
}

interface TodoCardMenuProps {
  todo: Todo;
  ctx: PlacementContext;
  onOpen: (todo: Todo) => void;
  actions: TodoContextActions;
  /**
   * How many to-dos this menu will act on. >1 when the card is part of a
   * multi-selection, which every label says out loud rather than leaving you
   * to infer it from the highlight.
   */
  selectionCount?: number;
  /** An away card — dated, but rendered in its own list column, so "Move back"
   * has nowhere to move it. */
  inListColumn?: boolean;
  /** Dismiss the menu after a chord fires — clicking an item closes it on its
   * own, but a keyboard shortcut has to say so. */
  close: () => void;
}

export function TodoCardMenu({
  todo,
  ctx,
  onOpen,
  actions,
  selectionCount = 1,
  inListColumn = false,
  close,
}: TodoCardMenuProps) {
  const platform = usePlatform();
  const many = selectionCount > 1;
  /** Suffix rather than pluralized nouns: "Delete 3" beats "Delete 3 to-dos"
   * in a menu, and stays honest when the count is 1 by vanishing entirely. */
  const n = many ? ` ${selectionCount}` : "";

  const toggleStatus: Todo["status"] = todo.status === "open" ? "done" : "open";

  /**
   * The three chords, bound HERE rather than shown and left to something else
   * (EI-289).
   *
   * Nothing else can catch them while a menu is open: board hotkeys are held
   * off by `contextMenuOpen` in `computeModalOpen` (EI-284), and the sheet's
   * own handler is not mounted. A hint rendered without this would simply be
   * a lie.
   *
   * Same three chords, same meanings, and the same "local, not a registry
   * entry" reasoning as `todo-sheet.tsx`'s `handleSheetKeyDown` — they are
   * meaningless with no menu open, and `GuardContext` has no per-surface
   * discriminator to scope a global entry with.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    // Exactly one of Ctrl/Meta, never both, never Alt — the rule
    // `hasExactModifiers` enforces for the global registry, hand-checked here
    // because that helper only serves the registry.
    const modOnly = e.metaKey !== e.ctrlKey && !e.altKey;
    if (!modOnly) return;

    const fire = (run: () => void) => {
      // `stopPropagation` as well as `preventDefault`: Base UI's own Enter
      // handler activates whichever item is highlighted, and without this a
      // ⌘↵ aimed at "Mark done" would ALSO run whatever the arrow keys had
      // last landed on.
      e.preventDefault();
      e.stopPropagation();
      run();
      close();
    };

    if (e.key === "Enter" && !e.shiftKey) {
      fire(() => actions.onStatus(todo, toggleStatus));
      return;
    }
    if (e.key === "Backspace") {
      if (e.shiftKey) fire(() => actions.onDelete(todo));
      else fire(() => actions.onStatus(todo, "dropped"));
    }
  };

  return (
    <ContextMenuContent onKeyDown={handleKeyDown}>
      {/* Opening is about one card by definition, so it steps aside for a batch. */}
      {!many && (
        <>
          <ContextMenuItem onClick={() => onOpen(todo)}>
            <SquarePen />
            Edit
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem
        onClick={() =>
          actions.onStatus(todo, toggleStatus)
        }
      >
        <Check />
        {todo.status === "open" ? `Mark${n} done` : `Mark${n} not done`}
        <ContextMenuShortcut>{formatCombo("mod+enter", platform)}</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem onClick={() => actions.onStatus(todo, "dropped")}>
        <Ban />
        {`Won't do${n}`}
        <ContextMenuShortcut>{formatCombo("mod+backspace", platform)}</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <RescheduleSubmenu
        today={ctx.today}
        label={`Reschedule${n}`}
        onPick={(date) => actions.onReschedule(todo, date)}
      />

      {/* Only a card sitting in a day has somewhere to go back from. */}
      {todo.scheduledDate !== null && !inListColumn && (
        <ContextMenuItem onClick={() => actions.onMoveBackToList(todo)}>
          <Undo2 />
          {many
            ? `Move${n} back to their lists`
            : `Move back to ${actions.homeListName(todo)}`}
        </ContextMenuItem>
      )}

      <ContextMenuSeparator />

      <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(todo)}>
        <Trash2 />
        {`Delete${n}`}
        <ContextMenuShortcut>
          {formatCombo("shift+mod+backspace", platform)}
        </ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
