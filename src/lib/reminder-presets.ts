import type { ReminderPreset } from "@/lib/schema";
import { formatTimeLabel, matchTime } from "@/lib/quick-add";

/**
 * Pure core for reminder presets (EI-106 P1) — no UI, no store access.
 * `reminder-picker.tsx` (P2) and the card badge (P5) both build on this.
 */

/** "14:00" -> "2:00 PM". Re-exported under a reminders-domain name rather
 * than re-implemented — `formatTimeLabel` already does exactly this for
 * quick-add's own time tokens. */
export const formatReminderTime = formatTimeLabel;

/**
 * Display text for a stored `reminderTime`. Matches a preset by VALUE
 * (`time`), not by a stored reference — see the decision on `Todo` binding
 * to presets by value in `reminderPresetSchema`'s doc comment. A preset
 * match reads as "🌅 In the morning"; anything else falls back to a plain
 * formatted clock time, which is also what a retimed-away-from preset
 * relabels to (EI-106 decision 1).
 */
export function reminderLabelFor(
  time: string,
  presets: readonly ReminderPreset[],
): string {
  const preset = presets.find((p) => p.time === time);
  if (!preset) return formatReminderTime(time);
  return preset.emoji ? `${preset.emoji} ${preset.name}` : preset.name;
}

export type PresetQueryResult =
  /** Name substring hits — the ordinary typeahead case. */
  | { kind: "match"; presets: ReminderPreset[] }
  /** The whole query parsed as a time — apply it, create nothing. */
  | { kind: "time"; time: string }
  /** A name followed by a time token ("gym 9:30am") — create then apply. */
  | { kind: "create"; name: string; time: string }
  | { kind: "none" };

/**
 * Drives the `ReminderPicker`'s rows (P2). Reuses `matchTime` from
 * `quick-add.ts` rather than a second time grammar — see that function's
 * doc comment.
 */
export function parsePresetQuery(
  query: string,
  presets: readonly ReminderPreset[],
): PresetQueryResult {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "match", presets: [...presets] };

  const words = trimmed.split(/\s+/);

  // The whole query is one time token — "9:30am", "14:00".
  if (words.length === 1) {
    const time = matchTime(words[0]);
    if (time) return { kind: "time", time };
  }

  // A trailing time token with a non-empty name ahead of it — "gym 9:30am".
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    const time = matchTime(lastWord);
    if (time) {
      const name = words.slice(0, -1).join(" ").trim();
      if (name) return { kind: "create", name, time };
    }
  }

  const matches = presets.filter((p) =>
    p.name.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (matches.length > 0) return { kind: "match", presets: matches };

  return { kind: "none" };
}
