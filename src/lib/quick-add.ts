import type { CivilDate, Priority, ReminderPreset } from "./schema";
import { addDays, dayOfWeek, formatShortDate, toCivilDate } from "./scheduling";

/**
 * Parses a quick-add string like "buy milk p2 fri 2pm" into a title plus the
 * fields it implies. Pure and synchronous — `today` is passed in rather than
 * read from `new Date()`, same discipline as `scheduling.ts`/`recurrence.ts`.
 *
 * Tokens are only recognized at the two EDGES of the string, never in the
 * middle: a trailing run (any token kind) scanned right-to-left, then a
 * leading run (priority only) scanned left-to-right, bounded by wherever the
 * trailing run stopped. This is what keeps ordinary sentences safe — "call
 * mom about p1 stuff" and "today I need to call mom" parse nothing, because
 * the word after/before the candidate token isn't itself a token and the scan
 * stops. Priority is the one kind allowed to lead, since `p1`-`p4` never open
 * a real sentence the way a bare date word could.
 */

export type QuickAddMatchKind = "priority" | "date" | "deadline" | "time";

export interface QuickAddMatch {
  /** The exact substring matched, for display. */
  raw: string;
  kind: QuickAddMatchKind;
  /** Human label for a preview chip, e.g. "P2", "Fri Aug 14", "2:00 PM". */
  label: string;
}

export interface QuickAdd {
  title: string;
  priority: Priority | null;
  scheduledDate: CivilDate | null;
  deadline: CivilDate | null;
  reminderTime: string | null;
  /** Left-to-right, one per kind that matched — for a live preview. */
  matches: QuickAddMatch[];
}

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WEEKDAY_WORDS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTH_WORDS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

/** Next occurrence of `target` weekday (0=Sun) at or after `today` — today counts. */
function nextWeekday(target: number, today: CivilDate): CivilDate {
  const diff = (target - dayOfWeek(today) + 7) % 7;
  return addDays(today, diff);
}

/** Month/day at or after `today`, rolling into next year if it has already passed. */
function nextMonthDay(month: number, day: number, today: CivilDate): CivilDate | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const todayYear = Number(today.slice(0, 4));
  if (day > daysInMonth(todayYear, month)) return null;
  const candidate = toCivilDate(todayYear, month, day);
  if (candidate >= today) return candidate;
  if (day > daysInMonth(todayYear + 1, month)) return null;
  return toCivilDate(todayYear + 1, month, day);
}

interface DateResult {
  date: CivilDate;
  isDeadline: boolean;
}

/** Strips a leading "!" (the deadline marker) off the first word of a date token. */
function splitDeadlineMarker(word: string): { word: string; isDeadline: boolean } {
  if (word.startsWith("!") && word.length > 1) {
    return { word: word.slice(1), isDeadline: true };
  }
  return { word, isDeadline: false };
}

function matchDateSingle(rawWord: string, today: CivilDate): DateResult | null {
  const { word, isDeadline } = splitDeadlineMarker(rawWord.toLowerCase());

  if (word === "today" || word === "tod") return { date: today, isDeadline };
  if (word === "tomorrow" || word === "tom" || word === "tmr") {
    return { date: addDays(today, 1), isDeadline };
  }

  const weekday = WEEKDAY_WORDS[word];
  if (weekday !== undefined) return { date: nextWeekday(weekday, today), isDeadline };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return { date: toCivilDate(year, month, day), isDeadline };
  }

  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(word);
  if (slash) {
    const [, mStr, dStr, yStr] = slash;
    const month = Number(mStr);
    const day = Number(dStr);
    if (!yStr) {
      const rolled = nextMonthDay(month, day, today);
      return rolled ? { date: rolled, isDeadline } : null;
    }
    const year = yStr.length === 2 ? 2000 + Number(yStr) : Number(yStr);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return { date: toCivilDate(year, month, day), isDeadline };
  }

  return null;
}

function matchDateCombo(rawWord1: string, rawWord2: string, today: CivilDate): DateResult | null {
  const { word: word1, isDeadline } = splitDeadlineMarker(rawWord1.toLowerCase());
  const word2 = rawWord2.toLowerCase();

  if (word1 === "next") {
    const weekday = WEEKDAY_WORDS[word2];
    if (weekday !== undefined) {
      return { date: addDays(nextWeekday(weekday, today), 7), isDeadline };
    }
    return null;
  }

  const month = MONTH_WORDS[word1];
  if (month !== undefined) {
    const dayMatch = /^(\d{1,2})$/.exec(word2);
    if (!dayMatch) return null;
    const date = nextMonthDay(month, Number(dayMatch[1]), today);
    return date ? { date, isDeadline } : null;
  }

  return null;
}

function matchPriority(word: string): Priority | null {
  const match = /^p([1-4])$/i.exec(word);
  return match ? (Number(match[1]) as Priority) : null;
}

/** Exported for `reminder-presets.ts` (EI-106 P1) — the same "HH:MM" grammar
 * a preset's own combobox parses, so there is one time tokenizer, not two. */
export function matchTime(word: string): string | null {
  const meridiem = /^(\d{1,2})(?::([0-5]\d))?(am|pm|a|p)$/i.exec(word);
  if (meridiem) {
    const hour12 = Number(meridiem[1]);
    if (hour12 < 1 || hour12 > 12) return null;
    const minute = meridiem[2] ? Number(meridiem[2]) : 0;
    const isPm = meridiem[3].toLowerCase().startsWith("p");
    let hour = hour12 % 12;
    if (isPm) hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const clock24 = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(word);
  if (clock24) {
    return `${clock24[1].padStart(2, "0")}:${clock24[2]}`;
  }

  return null;
}

/** Exported as `formatReminderTime` from `reminder-presets.ts` (EI-106 P1) —
 * "14:00" -> "2:00 PM", reused rather than re-implemented there. */
export function formatTimeLabel(time: string): string {
  const [hStr, mStr] = time.split(":");
  const hour = Number(hStr);
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mStr} ${period}`;
}

/**
 * Preset-name vocabulary (EI-106 P4) — "morning" resolves a preset named
 * "In the morning" the same way `parsePresetQuery`'s "match" branch does:
 * a case-insensitive match, not necessarily an exact full-name one. Exact
 * FULL-NAME matching would miss every multi-word preset name against
 * quick-add's one-word-at-a-time trailing scan.
 *
 * Matched against WHOLE WORDS in the preset's name, not a bare substring —
 * `p.name.includes(word)` (the first version of this function) matched "on"
 * inside "Afternoon", "mo" inside "Morning", and "it" inside "Lunchtime",
 * silently eating an ordinary trailing word ("call mo" -> title "call",
 * reminder set to 8am) with no ambiguity to catch it, since exactly one
 * preset happened to contain the substring. A trailing word must equal, or
 * be a prefix of, one of the preset name's own words — "morn" still matches
 * "Morning", "lunch" still matches "Lunchtime", but "on"/"mo"/"it" match
 * nothing. `MIN_LENGTH` additionally floors out the shortest common words
 * ("at", "in", "on") before they can accidentally equal a short preset word.
 *
 * Ambiguous (more than one preset matches) resolves to nothing here —
 * quick-add has no disambiguation UI mid-parse, unlike the picker's
 * dropdown, so an ambiguous word is safer left as plain title text.
 */
const PRESET_WORD_MIN_LENGTH = 3;

function matchPresetTime(
  word: string,
  presets: readonly ReminderPreset[],
): ReminderPreset | null {
  if (presets.length === 0) return null;
  const lower = word.toLowerCase();
  if (lower.length < PRESET_WORD_MIN_LENGTH) return null;
  const matches = presets.filter((p) =>
    p.name
      .toLowerCase()
      .split(/\s+/)
      .some((nameWord) => nameWord === lower || nameWord.startsWith(lower)),
  );
  return matches.length === 1 ? matches[0] : null;
}

function labelForDate(date: CivilDate, prefix = ""): string {
  return `${prefix}${WEEKDAY_ABBR[dayOfWeek(date)]} ${formatShortDate(date)}`;
}

interface RawMatch {
  kind: QuickAddMatchKind;
  start: number;
  end: number;
  raw: string;
  value: Priority | CivilDate | string;
  /** Set only for a preset-name time match — overrides the default
   * `formatTimeLabel(value)` label with the preset's own "emoji name". */
  presetLabel?: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function tokenize(input: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    words.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return words;
}

export function parseQuickAdd(
  input: string,
  today: CivilDate,
  presets: readonly ReminderPreset[] = [],
): QuickAdd {
  const empty: QuickAdd = {
    title: input,
    priority: null,
    scheduledDate: null,
    deadline: null,
    reminderTime: null,
    matches: [],
  };

  const words = tokenize(input);
  if (words.length === 0) return empty;

  // Trailing run: any token kind, scanned right-to-left. Stops at the first
  // word that isn't a token.
  const trailing: RawMatch[] = [];
  let hi = words.length;
  while (hi > 0) {
    if (hi >= 2) {
      const w1 = words[hi - 2];
      const w2 = words[hi - 1];
      const combo = matchDateCombo(w1.text, w2.text, today);
      if (combo) {
        trailing.push({
          kind: combo.isDeadline ? "deadline" : "date",
          start: w1.start,
          end: w2.end,
          raw: input.slice(w1.start, w2.end),
          value: combo.date,
        });
        hi -= 2;
        continue;
      }
    }

    const w = words[hi - 1];
    const priority = matchPriority(w.text);
    if (priority !== null) {
      trailing.push({ kind: "priority", start: w.start, end: w.end, raw: w.text, value: priority });
      hi -= 1;
      continue;
    }
    const date = matchDateSingle(w.text, today);
    if (date) {
      trailing.push({
        kind: date.isDeadline ? "deadline" : "date",
        start: w.start,
        end: w.end,
        raw: w.text,
        value: date.date,
      });
      hi -= 1;
      continue;
    }
    const time = matchTime(w.text);
    if (time) {
      trailing.push({ kind: "time", start: w.start, end: w.end, raw: w.text, value: time });
      hi -= 1;
      continue;
    }
    const preset = matchPresetTime(w.text, presets);
    if (preset) {
      trailing.push({
        kind: "time",
        start: w.start,
        end: w.end,
        raw: w.text,
        value: preset.time,
        presetLabel: preset.emoji ? `${preset.emoji} ${preset.name}` : preset.name,
      });
      hi -= 1;
      continue;
    }
    break;
  }

  // Leading run: priority only, bounded by wherever the trailing run stopped.
  const leading: RawMatch[] = [];
  let lo = 0;
  while (lo < hi) {
    const w = words[lo];
    const priority = matchPriority(w.text);
    if (priority === null) break;
    leading.push({ kind: "priority", start: w.start, end: w.end, raw: w.text, value: priority });
    lo += 1;
  }

  if (lo >= hi) return empty; // Nothing left for a title — bail entirely.

  const title = input.slice(words[lo].start, words[hi - 1].end).trim();

  // Duplicate token of the same kind: the one earliest in the string wins.
  const all = [...leading, ...trailing];
  const pick = (kind: QuickAddMatchKind): RawMatch | null =>
    all.filter((m) => m.kind === kind).sort((a, b) => a.start - b.start)[0] ?? null;

  const priorityMatch = pick("priority");
  const dateMatch = pick("date");
  const deadlineMatch = pick("deadline");
  const timeMatch = pick("time");

  const matches: QuickAddMatch[] = [priorityMatch, dateMatch, deadlineMatch, timeMatch]
    .filter((m): m is RawMatch => m !== null)
    .sort((a, b) => a.start - b.start)
    .map((m) => ({
      raw: m.raw,
      kind: m.kind,
      label:
        m.kind === "priority"
          ? `P${m.value}`
          : m.kind === "date"
            ? labelForDate(m.value as CivilDate)
            : m.kind === "deadline"
              ? labelForDate(m.value as CivilDate, "Due ")
              : (m.presetLabel ?? formatTimeLabel(m.value as string)),
    }));

  return {
    title,
    priority: (priorityMatch?.value as Priority) ?? null,
    scheduledDate: (dateMatch?.value as CivilDate) ?? null,
    deadline: (deadlineMatch?.value as CivilDate) ?? null,
    reminderTime: (timeMatch?.value as string) ?? null,
    matches,
  };
}
