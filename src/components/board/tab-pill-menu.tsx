"use client";

import { Archive, Settings2, Trash2 } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { Tab } from "@/lib/schema";
import { ColorSubmenu } from "./color-submenu";
import type { TabPatch } from "./tab-info-dialog";

/**
 * A tab pill's right-click menu (EI-288) — the same four actions the list
 * column menu offers, because a tab is the same kind of thing one level up.
 *
 * No `inherited` on the color submenu: a tab is where color originates. Lists
 * fall back to their tab's; a tab falls back to nothing.
 */
interface TabPillMenuProps {
  tab: Tab;
  onSave: (tab: Tab, patch: TabPatch) => void;
  onArchive: (tab: Tab) => void;
  onDelete: (tab: Tab) => void;
  onOpenInfo: () => void;
}

export function TabPillMenu({
  tab,
  onSave,
  onArchive,
  onDelete,
  onOpenInfo,
}: TabPillMenuProps) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onOpenInfo}>
        <Settings2 />
        Tab settings…
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ColorSubmenu
        value={tab.color ?? null}
        onChange={(color) => onSave(tab, { color })}
      />

      <ContextMenuSeparator />

      {/* Archiving a tab takes its lists with it; deleting rehomes them.
          Both undoable, so neither confirms — same call as lists. */}
      <ContextMenuItem onClick={() => onArchive(tab)}>
        <Archive />
        Archive
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={() => onDelete(tab)}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
