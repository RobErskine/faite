"use client";

import { Archive, Settings2, Trash2 } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { effectiveListColor } from "@/lib/colors";
import type { List, Tab } from "@/lib/schema";
import { ColorSubmenu } from "./color-submenu";
import type { ListPatch } from "./list-info-dialog";

/**
 * A list column header's right-click menu (EI-286).
 *
 * Every action already has a home in `ListInfoDialog`; this is the shortcut to
 * the three worth reaching without opening it. Rename, description and the
 * default reminder deliberately stay in the dialog — they need a text field,
 * and a menu is the wrong shape for typing.
 */
interface ListColumnMenuProps {
  list: List;
  tabsById: ReadonlyMap<string, Tab>;
  onSave: (list: List, patch: ListPatch) => void;
  onArchive: (list: List) => void;
  onDelete: (list: List) => void;
  onOpenInfo: () => void;
}

export function ListColumnMenu({
  list,
  tabsById,
  onSave,
  onArchive,
  onDelete,
  onOpenInfo,
}: ListColumnMenuProps) {
  /*
    What the list would render as with no color of its own — its tab's. Shown
    on the "None" row so the inherited color is visible rather than implied,
    matching `color-picker.tsx`'s treatment.
  */
  const inherited = effectiveListColor({ ...list, color: null }, tabsById);

  return (
    <ContextMenuContent>
      {/* First, because it is the route to everything this menu leaves out,
          including an arbitrary color. */}
      <ContextMenuItem onClick={onOpenInfo}>
        <Settings2 />
        List settings…
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ColorSubmenu
        value={list.color ?? null}
        inherited={inherited}
        onChange={(color) => onSave(list, { color })}
      />

      <ContextMenuSeparator />

      {/* Archive keeps the list's to-dos with it; Delete rehomes them to
          Backlog. Both are undoable, which is why neither confirms here. */}
      <ContextMenuItem onClick={() => onArchive(list)}>
        <Archive />
        Archive
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={() => onDelete(list)}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
