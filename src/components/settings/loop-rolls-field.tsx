"use client";

import { cn } from "@/lib/utils";

const ROLL_PRESETS = [0, 1, 2, 3, 5, 7, 14, 30] as const;

/** The `0` preset's label — see the note on `LoopRollsField`. */
const ROLLS_ZERO_LABEL = "0 · next day";

interface LoopRollsFieldProps {
  value: number;
  onChange: (rolls: number) => void;
}

/**
 * Segmented preset control for `settings.overflowAfterDays` — the Faite Loop
 * length. Presets, not a 0-30 spinner: eight buttons read faster than a
 * thirty-one-item picker. The schema still accepts any value 0-30, so a
 * synced out-of-preset value (an older client, say) round-trips fine even
 * though this control can't select it directly — see docs/FAITE-LOOP.md.
 *
 * `0` reads "0 · next day", never "None" (EI-383): zero rolls means a miss
 * goes to Overflow the very next day, and "None" read as "never overflow" —
 * the one setting the Loop deliberately does not have. The text is the
 * button's whole accessible name, so sighted and screen-reader users get
 * the same words.
 */
export function LoopRollsField({ value, onChange }: LoopRollsFieldProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Rolls before Overflow</legend>
      <div className="inline-flex flex-wrap rounded-lg border p-1">
        {ROLL_PRESETS.map((rolls) => {
          const active = value === rolls;
          return (
            <button
              key={rolls}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(rolls)}
              className={cn(
                "num rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {rolls === 0 ? ROLLS_ZERO_LABEL : rolls}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
