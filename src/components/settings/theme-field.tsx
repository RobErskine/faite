"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_MODES, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ThemeFieldProps {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * Appearance picker for the Design section.
 *
 * Three segmented buttons rather than a Select: the result of clicking one is
 * the entire screen, so all three options should be visible and comparable at
 * once rather than hidden behind a click.
 */
export function ThemeField({ value, onChange }: ThemeFieldProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Appearance</legend>
      <div className="inline-flex rounded-lg border p-1">
        {THEME_MODES.map((mode) => {
          const Icon = THEME_ICONS[mode.id];
          const active = value === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(mode.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {mode.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
