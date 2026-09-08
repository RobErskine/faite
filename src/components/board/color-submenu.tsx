"use client";

import { Palette } from "lucide-react";
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { ACCENT_COLORS } from "@/lib/colors";

/**
 * The Color ▸ submenu, shared by the list column and tab pill menus (EI-286,
 * EI-288). Two call sites rather than one is what earns the extraction — the
 * alternative is the same eleven rows and the same sentinel written twice.
 *
 * A radio group, not plain items: exactly one color is in effect, and the
 * checkmark is what makes the current one findable without reading swatches.
 *
 * Deliberately no custom color input. A native OS picker opened from inside a
 * popup is a focus-restoration trap; the "… settings…" dialog above it in both
 * menus is the route to an arbitrary color.
 */

/** Matches `ListInfoDialog`/`TabInfoDialog`'s own sentinel for "no color". */
export const NO_COLOR = "__none__";

interface ColorSubmenuProps {
  /** The record's OWN color, null when it has none. */
  value: string | null;
  /**
   * What it renders as anyway when `value` is null — a list falls back to its
   * tab's color. Omit where nothing is inherited (a tab).
   */
  inherited?: string | null;
  onChange: (color: string | null) => void;
}

export function ColorSubmenu({ value, inherited, onChange }: ColorSubmenuProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Palette />
        Color
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          value={value ?? NO_COLOR}
          onValueChange={(next) =>
            onChange(next === NO_COLOR ? null : String(next))
          }
        >
          <ContextMenuRadioItem value={NO_COLOR}>
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
