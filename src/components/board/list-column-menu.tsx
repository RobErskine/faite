"use client";

import { Archive, Settings2, Palette, Trash2 } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { ACCENT_COLORS, effectiveListColor } from "@/lib/colors";
import type { List, Tab } from "@/lib/schema";
import type { ListPatch } from "./list-info-dialog";

/**
 * A list column header's right-click menu (EI-286).
 *
 * Every action already has a home in `ListInfoDialog`; this is the shortcut to
 * the three that are worth reaching without opening it. Rename, description
 * and the default reminder deliberately stay in the dialog — they need a text
 * field, and a menu is the wrong shape for typing.
 */

/** Matches `ListInfoDialog`'s own sentinel for "no color of its own". */
const NONE = "__none__";

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
    What the list renders as today when it has no color of its own — its tab's.
    Shown as the swatch on the "None" row so the inherited color is visible
    rather than implied, matching `color-picker.tsx`'s treatment.
  */
  const inherited = effectiveListColor({ ...list, color: null }, tabsById);

  return (
    <ContextMenuContent>
      {/* First, because it is the route to everything this menu leaves out —
          including a custom color. A native color input inside a popup is a
          focus-restoration trap, so the picker stays in the dialog. */}
      <ContextMenuItem onClick={onOpenInfo}>
        <Settings2 />
        List settings…
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Palette />
          Color
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {/* A radio group, not plain items: exactly one color is in effect,
              and the checkmark is what makes the current one findable. */}
          <ContextMenuRadioGroup
            value={list.color ?? NONE}
            onValueChange={(value) =>
              onSave(list, { color: value === NONE ? null : String(value) })
            }
          >
            <ContextMenuRadioItem value={NONE}>
              <Swatch color={inherited} />
              {inherited ? "None (from tab)" : "None"}
            </ContextMenuRadioItem>
            {ACCENT_COLORS.map((color) => (
              <ContextMenuRadioItem key={color.value} value={color.value}>
                <Swatch color={color.value} />
                {color.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>

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

/** A color dot. `aria-hidden` — the name beside it is what gets announced. */
function Swatch({ color }: { color: string | null | undefined }) {
  return (
    <span
      aria-hidden
      className="size-3.5 shrink-0 rounded-full ring-1 ring-foreground/10"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
