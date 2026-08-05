"use client";

import { Check } from "lucide-react";
import { FONT_PAIRINGS, type FontPairingId } from "@/lib/fonts";
import { cn } from "@/lib/utils";

interface FontPairingFieldProps {
  value: FontPairingId;
  onChange: (id: FontPairingId) => void;
}

/**
 * Typography picker for the Design section.
 *
 * Each card carries `data-font={pairing.id}` so it previews in its own face —
 * choosing a typeface from a list rendered in a different typeface is
 * guesswork. Carried over from the command palette's Typography group
 * (command-palette.tsx), which is the same data and the same insight, just a
 * different surface.
 */
export function FontPairingField({ value, onChange }: FontPairingFieldProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Typography</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FONT_PAIRINGS.map((pairing) => {
          const active = value === pairing.id;
          return (
            <button
              key={pairing.id}
              type="button"
              data-font={pairing.id}
              aria-pressed={active}
              onClick={() => onChange(pairing.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "border-ring bg-accent" : "hover:bg-muted/50",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">
                  {pairing.label}
                </span>
                {active ? (
                  <Check className="size-4 shrink-0 text-foreground" aria-hidden />
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {pairing.description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
