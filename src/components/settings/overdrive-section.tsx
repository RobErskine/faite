"use client";

import { cn } from "@/lib/utils";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import type { SettingsSectionProps } from "./types";

const MIN_TODOS_PRESETS = [3, 5, 8, 10, 15, 20] as const;

/** `ms`, not a labeled unit like "3s" as the stored value — `overdrive-
 * overlay.tsx`'s timer takes milliseconds directly, and keeping the preset's
 * own value in that unit means no conversion step to get wrong between here
 * and there. `0` is the schema default (auto-confirm OFF). */
const AUTO_CONFIRM_PRESETS = [
  { label: "Off", ms: 0 },
  { label: "1.5s", ms: 1500 },
  { label: "2s", ms: 2000 },
  { label: "3s", ms: 3000 },
  { label: "5s", ms: 5000 },
] as const;

/**
 * A row of segmented preset chips — the same visual language
 * `LoopRollsField` (`loop-rolls-field.tsx`) already established for "pick
 * one of a handful of numbers" settings. Generalized and kept local to this
 * file rather than extracted: both fields below are Overdrive-only, so
 * there's no second caller yet to justify a shared component.
 */
function PresetChips<T extends number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { label: string; value: T }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border p-1">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "num rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Overdrive's two tunables (EI-103). Both shipped deliberately absent from
 * v1 — see docs/OVERDRIVE.md §1 ("A constant, not a setting, for now") and
 * §4 ("Deferred, not rejected") — and both default to the exact behaviour
 * v1 had: a fixed entry threshold of `OVERDRIVE_MIN_TODOS`, and no
 * auto-confirm at all.
 */
export function OverdriveSection({ settings }: SettingsSectionProps) {
  const minTodos = settings?.overdriveMinTodos ?? OVERDRIVE_MIN_TODOS;
  const autoConfirmMs = settings?.overdriveAutoConfirmMs ?? 0;

  return (
    <div className="space-y-8">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Entry threshold</legend>
        <p className="text-sm text-muted-foreground">
          Overflow needs at least this many to-dos piled up before the{" "}
          <span className="font-medium text-foreground">Overdrive</span> button
          appears at the bottom of the column.
        </p>
        <PresetChips
          value={minTodos}
          options={MIN_TODOS_PRESETS.map((n) => ({ label: String(n), value: n }))}
          onChange={(n) => void mutateSettings(LOCAL_OWNER_ID, { overdriveMinTodos: n })}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Auto-confirm delay</legend>
        <p className="text-sm text-muted-foreground">
          When a Schedule pick is staged and you stop touching the ramp, commit
          it on its own after this long instead of waiting for Confirm or
          Enter. Off by default — nothing changes until you turn this on.
        </p>
        <PresetChips
          value={autoConfirmMs}
          options={AUTO_CONFIRM_PRESETS.map((p) => ({ label: p.label, value: p.ms }))}
          onChange={(ms) => void mutateSettings(LOCAL_OWNER_ID, { overdriveAutoConfirmMs: ms })}
        />
      </fieldset>
    </div>
  );
}
