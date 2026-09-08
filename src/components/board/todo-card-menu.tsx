"use client";

import { Ban, CalendarClock, Check, SquarePen, Trash2 } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { formatCombo } from "@/lib/keyboard";
import { usePlatform } from "@/lib/use-platform";
import { quickRescheduleOptions } from "@/lib/quick-reschedule";
import { formatDay, formatShortDate, type PlacementContext } from "@/lib/scheduling";
import type { CivilDate, Todo } from "@/lib/schema";

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
  /** Dismiss the menu after a chord fires — clicking an item closes it on its
   * own, but a keyboard shortcut has to say so. */
  close: () => void;
}

/** "Sat, Aug 15" — the resolved date beside a reschedule row. */
function resolvedLabel(date: CivilDate): string {
  return `${formatDay(date).weekday.slice(0, 3)}, ${formatShortDate(date)}`;
}

export function TodoCardMenu({
  todo,
  ctx,
  onOpen,
  actions,
  selectionCount = 1,
  close,
}: TodoCardMenuProps) {
  const platform = usePlatform();
  const many = selectionCount > 1;
  /** Suffix rather than pluralized nouns: "Delete 3" beats "Delete 3 to-dos"
   * in a menu, and stays honest when the count is 1 by vanishing entirely. */
  const n = many ? ` ${selectionCount}` : "";

  /*
    Anchored on TODAY, never the card's own `scheduledDate` — a list-column
    card has none, and a missed one still carries a date in the past, so
    measuring from it would schedule into the past and roll straight back.
    `quick-reschedule.ts` carries the full argument. Each row shows where it
    lands, which is what keeps "In 2 days" from meaning something invisible.
  */
  const rescheduleOptions = quickRescheduleOptions(ctx.today);

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

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <CalendarClock />
          {`Reschedule${n}`}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {rescheduleOptions.map((option) => (
            <ContextMenuItem
              key={option.kind}
              onClick={() => actions.onReschedule(todo, option.date)}
            >
              {option.label}
              <ContextMenuShortcut>{resolvedLabel(option.date)}</ContextMenuShortcut>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>

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
