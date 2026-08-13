"use client";

import { cn } from "@/lib/utils";

const ROLL_PRESETS = [0, 1, 2, 3, 5, 7, 14, 30] as const;

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
              {rolls === 0 ? "None" : rolls}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
