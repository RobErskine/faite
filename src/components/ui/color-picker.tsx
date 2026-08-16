"use client";

import { Check, Pipette, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ACCENT_COLORS, isTintableColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  /**
   * The color `value: null` actually renders as — a list's tab, say. Shown in
   * place of "None" so the trigger stops contradicting the swatch the rest of
   * the app already paints. Purely a display fallback: `onChange` and the
   * stored value never see it, and clearing a real value lands back here
   * rather than at a true "no color" (there is no such state once an
   * inherited color exists).
   */
  inheritedColor?: string | null;
  /** Labels the trigger for assistive tech; the swatch alone says nothing. */
  label?: string;
  className?: string;
  id?: string;
}

/**
 * Ten presets, a custom color, and no color.
 *
 * Built here rather than pulled from a registry because shadcn/ui has no color
 * picker, and the community one that gets called that is Radix-based — this app
 * is deliberately Base UI, so adopting it would mean a second primitive library
 * for one swatch. A saturation canvas would also be the wrong tool: this picks
 * an accent from a curated set, not an arbitrary color from a gradient.
 *
 * Custom colors go through the OS picker via `input[type=color]`, which is
 * free, keyboard accessible, and already familiar.
 */
export function ColorPicker({
  value,
  onChange,
  inheritedColor,
  label = "color",
  className,
  id,
}: ColorPickerProps) {
  const selected = isTintableColor(value) ? value.toLowerCase() : null;
  // Only consulted once `value` itself has nothing to say — a list's own
  // color, even one that happens to match its tab's, always wins the display.
  const inherited =
    selected === null && isTintableColor(inheritedColor) ? inheritedColor.toLowerCase() : null;
  const displayed = selected ?? inherited;
  const isPreset = ACCENT_COLORS.some((c) => c.value.toLowerCase() === displayed);
  const name = ACCENT_COLORS.find((c) => c.value.toLowerCase() === displayed)?.name;

  return (
    <Popover>
      <PopoverTrigger
        id={id}
        aria-label={label}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-transparent px-3 text-sm",
          "outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <Swatch color={displayed} inherited={!selected && !!inherited} />
        <span className="text-muted-foreground">
          {selected
            ? (name ?? "Custom")
            : inherited
              ? `${name ?? "Custom"} (from tab)`
              : "None"}
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto gap-3">
        <div className="grid grid-cols-5 gap-1.5">
          {ACCENT_COLORS.map((color) => {
            // Never the inherited swatch — a color inherited from the tab is
            // not a choice this list has made, and marking one pressed here
            // would make "pinned to Grass" and "currently reading Grass from
            // the tab" look identical, which is the exact confusion this
            // whole prop exists to clear up.
            const active = selected === color.value.toLowerCase();
            return (
              <button
                key={color.value}
                type="button"
                title={color.name}
                aria-label={color.name}
                aria-pressed={active}
                onClick={() => onChange(color.value)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full outline-none",
                  "ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring",
                )}
                style={{ backgroundColor: color.value }}
              >
                {active && <Check className="size-3.5 text-white" aria-hidden />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          {/*
            The native input is the whole custom-color affordance. It is
            visually a label-wrapped swatch so it matches the row, but the OS
            picker and its keyboard handling come for free.
          */}
          <label
            className={cn(
              "flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              "hover:bg-accent focus-within:ring-2 focus-within:ring-ring",
            )}
          >
            <Pipette className="size-3.5 text-muted-foreground" aria-hidden />
            {selected && !isPreset ? "Custom color" : "Custom…"}
            <input
              type="color"
              value={displayed ?? "#3e63dd"}
              onChange={(e) => onChange(e.target.value)}
              className="ml-auto size-5 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>

          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={!selected}
            aria-label="Clear color"
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none",
              "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            )}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Swatch({ color, inherited }: { color: string | null; inherited?: boolean }) {
  if (!color) {
    // A ring rather than a filled circle: "no color" should not look like a
    // color that happens to match the background.
    return <span className="size-4 rounded-full border border-dashed" aria-hidden />;
  }
  if (inherited) {
    // The same dashed ring as "no color", now with the inherited hue inside
    // it — a bullseye. Reads as "here's the color, but this list didn't pick
    // it", which a plain filled circle (this list's own choice) would not.
    return (
      <span
        className="flex size-4 items-center justify-center rounded-full border border-dashed"
        aria-hidden
      >
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
    );
  }
  return (
    <span
      className="size-4 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}
