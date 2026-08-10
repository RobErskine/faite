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
  label = "color",
  className,
  id,
}: ColorPickerProps) {
  const selected = isTintableColor(value) ? value.toLowerCase() : null;
  const isPreset = ACCENT_COLORS.some((c) => c.value.toLowerCase() === selected);
  const name = ACCENT_COLORS.find((c) => c.value.toLowerCase() === selected)?.name;

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
        <Swatch color={selected} />
        <span className="text-muted-foreground">
          {name ?? (selected ? "Custom" : "None")}
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto gap-3">
        <div className="grid grid-cols-5 gap-1.5">
          {ACCENT_COLORS.map((color) => {
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
              value={selected ?? "#3e63dd"}
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

function Swatch({ color }: { color: string | null }) {
  if (!color) {
    // A ring rather than a filled circle: "no color" should not look like a
    // color that happens to match the background.
    return <span className="size-4 rounded-full border border-dashed" aria-hidden />;
  }
  return (
    <span
      className="size-4 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}
