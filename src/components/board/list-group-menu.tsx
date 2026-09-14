"use client";

import { Plus } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { TodoGroup } from "@/lib/board";
import type { CivilDate } from "@/lib/schema";
import { RescheduleSubmenu } from "./reschedule-submenu";

interface ListGroupMenuProps {
  group: TodoGroup;
  today: CivilDate;
  /** Open the "New to-do" field under this group. */
  onAdd: () => void;
  onReschedule: (date: CivilDate) => void;
}

/**
 * The right-click menu on a list group header inside a day column (EI-337).
 *
 * Both items duplicate a route the board already has, per CONTEXT-MENU.md §2:
 * "New to-do here" is the day column's quick-add with that list `@mentioned`,
 * and Reschedule ▸ is dragging each open card to another day.
 *
 * Reschedule counts OPEN to-dos only, because that is all it moves — a done
 * row stays on the day it was done.
 */
export function ListGroupMenu({
  group,
  today,
  onAdd,
  onReschedule,
}: ListGroupMenuProps) {
  const open = group.todos.filter((t) => t.status === "open").length;
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onAdd}>
        <Plus />
        New to-do here
      </ContextMenuItem>
      <ContextMenuSeparator />
      <RescheduleSubmenu
        today={today}
        label={open > 0 ? `Reschedule ${open}` : "Reschedule"}
        onPick={onReschedule}
        disabled={open === 0}
      />
    </ContextMenuContent>
  );
}
