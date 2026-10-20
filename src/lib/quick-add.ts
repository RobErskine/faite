import type { CivilDate, Priority, ReminderPreset } from "./schema";
import { addDays, dayOfWeek, formatShortDateAsOf, toCivilDate } from "./scheduling";

/**
 * Parses a quick-add string like "buy milk p2 fri 2pm" into a title plus the
 * fields it implies. Pure and synchronous — `today` is passed in rather than
 * read from `new Date()`, same discipline as `scheduling.ts`/`recurrence.ts`.
 *
 * Tokens are only recognized at the two EDGES of the string, never in the
 * middle: a trailing run (any token kind) scanned right-to-left, then a
 * leading run scanned left-to-right, bounded by wherever the trailing run
 * stopped. This is what keeps ordinary sentences safe — "call mom about p1
 * stuff" parses nothing, because the word after/before the candidate token
 * isn't itself a token and the scan stops.
 *
 * The leading run takes priority and only the dates that can't be ordinary
 * words: ones with a digit ("oct 1", "10/1", "2026-10-20") or the deadline
 * "!" ("!fri"). A word-only date ("today", "tom", "sat", "next fri") opens
 * real sentences too often to be read as a date at the start — "Tom called
 * back", "Sun cream", "Wednesday anchor" — so it stays title text, but
 * with a "not used" notice rather than silently (EI-379).
 *
 * One date wins (EI-379): when several date phrases parse, the earliest in
 * the string applies, and every other one STAYS in the title with a "not
 * used" notice. A date word is never removed from what was typed unless it
 * is the one that applied.
 */

export type QuickAddMatchKind = "priority" | "date" | "deadline" | "time" | "assignee";

/** Who a to-do is assigned to — the part of an `Assignee` quick-add needs. */
export interface QuickAddAssignee {
  id: string;
  name: string;
}

export interface QuickAddMatch {
  /** The exact substring matched, for display. */
  raw: string;
  kind: QuickAddMatchKind;
  /** Human label for a preview chip, e.g. "P2", "Fri Aug 14", "2:00 PM" —
   * a date outside the current year carries it: "Fri Oct 1, 2027" (EI-375). */
  label: string;
  /**
   * Set only by `foldQuickAddDraft`: the offset in the live text the word
   * was folded out of, so dismissing its chip can put the word back where
   * it was typed (`restoreFoldedMatch`) rather than tacking it on the end.
   */
  at?: number;
}

/**
 * A word sitting where a token would be, that the parser deliberately did
 * NOT apply — shown as a chip so it is never silent. It always stays in the
 * title.
 *
 * - `past-date` (EI-375): "yesterday". A past day cannot be scheduled
 *   (`nextMonthDay` rolls a passed month-day forward for the same reason).
 * - `unused-date` (EI-379): a second date phrase. One date wins — the
 *   earliest — and the others are left as typed.
 * - `leading-date` (EI-379): a word-only date at the very start ("today
 *   call mom") — see the module comment for why the start is not read.
 */
export type QuickAddNoticeKind = "past-date" | "unused-date" | "leading-date";

export interface QuickAddNotice {
  raw: string;
  kind: QuickAddNoticeKind;
  label: string;
}

/** The tooltip on a notice's dashed chip — what happened and what to do. */
export function quickAddNoticeHint(notice: QuickAddNotice): string {
  switch (notice.kind) {
    case "past-date":
      return "A past day can’t be scheduled. It stays in the title.";
    case "unused-date":
      return `Only the first date is used, so “${notice.raw}” stays in the title. Remove the other date to use this one.`;
    case "leading-date":
      return `A date at the start is read as part of the title. Type “${notice.raw}” at the end to schedule it.`;
  }
}

export interface QuickAddOptions {
  /**
   * Words the user dismissed from the preview (EI-375) — read as plain title
   * text even where they would otherwise parse. Matched against a token's
   * exact `raw`, so "Thursday" dismissed leaves a later "fri" free to parse.
   * A dismissed word ends the trailing scan the way any non-token word does,
   * which is what puts it back in the title.
   */
  literals?: readonly string[];
  /**
   * Whether a date at the very start can apply ("oct 1 renew passport").
   * On by default — every create path wants it. The to-do sheet's title
   * field turns it off: it re-parses an EXISTING title on every blur, and a
   * to-do titled "10/1 invoice" from before EI-379 must not lose its first
   * word and gain a date just because its sheet was opened.
   */
  leadingDates?: boolean;
  /**
   * The AGENT assignees a trailing "for <name>" can name (EI-426). Agents
   * only: "buy gift for Mom" names who the gift is for, not who does the
   * work, so people are never offered here. Omitted or empty, "for" is just a
   * word.
   */
  agents?: readonly QuickAddAssignee[];
}

export interface QuickAdd {
  title: string;
  priority: Priority | null;
  scheduledDate: CivilDate | null;
  deadline: CivilDate | null;
  reminderTime: string | null;
  /** The agent a trailing "for <agent>" named (EI-426), or null. */
  assignee: QuickAddAssignee | null;
  /** Left-to-right, one per kind that matched — for a live preview. */
  matches: QuickAddMatch[];
  /** Words left in the title on purpose — see `QuickAddNotice`. */
  notices: QuickAddNotice[];
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

/**
 * A whole input read as one date — the date popover's "Type a date" field
 * (EI-318).
 *
 * Deliberately the SAME grammar as the quick-add row and ⌘K rather than a
 * new one. Someone who has learned that "next fri" works when capturing will
 * type it here, and a second date grammar that almost agreed with the first
 * would be worse than having none at all. `parseQuickAdd` scans a sentence
 * for a date token among other words; this reads the entire input as one
 * token, which is why it can accept the two-word forms without having to
 * decide what the remaining words were.
 *
 * Strict about length: one word goes to `matchDateSingle`, exactly two to
 * `matchDateCombo`, anything else is `null`. "sep 14 ok" is not a date, and
 * quietly reading the first two words of it would set a date the user did
 * not finish typing.
 *
 * The deadline marker ("!fri") parses and its meaning is dropped — this
 * field sets a date, and Deadline is its own field beside it.
 *
 * `null` for anything unrecognized: the field shows no suggestion, and the
 * calendar underneath is still the way to pick a day.
 */
export function parseDatePhrase(input: string, today: CivilDate): CivilDate | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return matchDateSingle(words[0], today)?.date ?? null;
  if (words.length === 2) return matchDateCombo(words[0], words[1], today)?.date ?? null;
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

/** "Thu Oct 15", or "Fri Oct 1, 2027" — "oct 1" typed on Oct 14 is next
 * year, and a chip reading just "Oct 1" hid that (EI-375). The year rule is
 * `formatShortDateAsOf`, shared with the card badges (EI-387). */
function labelForDate(date: CivilDate, today: CivilDate, prefix = ""): string {
  return `${prefix}${WEEKDAY_ABBR[dayOfWeek(date)]} ${formatShortDateAsOf(date, today)}`;
}

/** "Thu, Oct 15", or "Fri, Oct 1, 2027" outside the current year — the date
 * as a quick-add toast names it (`describeQuickAddLanding`). */
export function formatQuickAddDate(date: CivilDate, today: CivilDate): string {
  return `${WEEKDAY_ABBR[dayOfWeek(date)]}, ${formatShortDateAsOf(date, today)}`;
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
  /** Set only for an "assignee" match. */
  agent?: QuickAddAssignee;
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

/** A date phrase that can't be an ordinary word opening a sentence: it has a
 * digit ("oct 1", "10/1", "2026-10-20") or the deadline "!" ("!fri"). */
function isUnmistakableDate(raw: string): boolean {
  return /\d/.test(raw) || raw.startsWith("!");
}

function isDateKind(kind: QuickAddMatchKind): boolean {
  return kind === "date" || kind === "deadline";
}

function labelForMatch(m: RawMatch, today: CivilDate): string {
  switch (m.kind) {
    case "priority":
      return `P${m.value}`;
    case "date":
      return labelForDate(m.value as CivilDate, today);
    case "deadline":
      return labelForDate(m.value as CivilDate, today, "Due ");
    case "time":
      return m.presetLabel ?? formatTimeLabel(m.value as string);
    case "assignee":
      return `→ ${m.agent?.name ?? ""}`;
  }
}

/**
 * A trailing "for <agent>" ending at word `hi - 1` (EI-426). The longest name
 * is tried first, so "for Claude Code" is not read as "for Claude" with "Code"
 * left over. Loose, like "@list": case, spaces, "-" and "_" are ignored.
 * `ambiguous` means two agents answer to the phrase — the caller assigns
 * neither and leaves the words in the title.
 */
function matchTrailingAgent(
  words: readonly Word[],
  hi: number,
  input: string,
  agents: readonly QuickAddAssignee[],
): { start: number; agent: QuickAddAssignee } | "ambiguous" | null {
  if (agents.length === 0) return null;
  const maxWords = Math.max(...agents.map((a) => a.name.trim().split(/\s+/).length));
  for (let k = Math.min(maxWords, hi - 1); k >= 1; k -= 1) {
    if (words[hi - 1 - k].text.toLowerCase() !== "for") continue;
    const key = normalizeListName(input.slice(words[hi - k].start, words[hi - 1].end));
    if (!key) continue;
    const found = agents.filter((a) => normalizeListName(a.name) === key);
    if (found.length === 1) return { start: words[hi - 1 - k].start, agent: found[0] };
    if (found.length > 1) return "ambiguous";
  }
  return null;
}

interface QuickAddScan {
  result: QuickAdd;
  /** Parallel to `result.matches`: whether each came from the leading run —
   * `foldQuickAddDraft` needs it to remember where the word was typed. */
  leading: boolean[];
}

export function parseQuickAdd(
  input: string,
  today: CivilDate,
  presets: readonly ReminderPreset[] = [],
  options: QuickAddOptions = {},
): QuickAdd {
  return scanQuickAdd(input, today, presets, options).result;
}

function scanQuickAdd(
  input: string,
  today: CivilDate,
  presets: readonly ReminderPreset[],
  options: QuickAddOptions,
): QuickAddScan {
  const empty: QuickAdd = {
    title: input,
    priority: null,
    scheduledDate: null,
    deadline: null,
    reminderTime: null,
    assignee: null,
    matches: [],
    notices: [],
  };

  const words = tokenize(input);
  if (words.length === 0) return { result: empty, leading: [] };
  const literals = new Set(options.literals ?? []);
  /** Notices with where they sit, so they come out in reading order. */
  const noticed: { start: number; notice: QuickAddNotice }[] = [];
  const notice = (start: number, raw: string, kind: QuickAddNoticeKind, label: string) =>
    noticed.push({ start, notice: { raw, kind, label } });
  const sortedNotices = () => noticed.sort((a, b) => a.start - b.start).map((n) => n.notice);

  // Trailing run: any token kind, scanned right-to-left. Stops at the first
  // word that isn't a token.
  const trailing: RawMatch[] = [];
  /**
   * "@word"s inside the trailing run (EI-375). A list mention that resolved
   * was already lifted out by `resolveQuickAdd`, so one that reaches here
   * matched no list — and it stays in the title. It must not END the run,
   * though, or "dentist fri @nolist" would silently lose its date to a typo
   * in a list name. It is skipped over and rejoined to the title instead.
   */
  const carried: Word[] = [];
  let hi = words.length;
  while (hi > 0) {
    const last = words[hi - 1];
    if (/^@\S/.test(last.text)) {
      carried.unshift(last);
      hi -= 1;
      continue;
    }
    if (literals.has(last.text)) break;
    if (hi >= 2 && literals.has(input.slice(words[hi - 2].start, last.end))) break;
    if (last.text.toLowerCase() === "yesterday") {
      notice(last.start, last.text, "past-date", `${last.text} · not scheduled`);
      break;
    }

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

    // "for <agent>" — one per string; a second leaves its words in the title.
    const agentMatch = trailing.some((t) => t.kind === "assignee")
      ? null
      : matchTrailingAgent(words, hi, input, options.agents ?? []);
    if (agentMatch === "ambiguous") break;
    if (agentMatch) {
      const raw = input.slice(agentMatch.start, words[hi - 1].end);
      if (literals.has(raw)) break;
      trailing.push({
        kind: "assignee",
        start: agentMatch.start,
        end: words[hi - 1].end,
        raw,
        value: agentMatch.agent.id,
        agent: agentMatch.agent,
      });
      hi = words.findIndex((x) => x.start === agentMatch.start);
      continue;
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

  // Leading run: priority, and a date that can't be an ordinary word (EI-379
  // — see the module comment), bounded by wherever the trailing run stopped.
  const leading: RawMatch[] = [];
  const leadingDates = options.leadingDates ?? true;
  let lo = 0;
  while (lo < hi) {
    const w = words[lo];
    if (literals.has(w.text)) break;
    const priority = matchPriority(w.text);
    if (priority !== null) {
      leading.push({ kind: "priority", start: w.start, end: w.end, raw: w.text, value: priority });
      lo += 1;
      continue;
    }
    if (!leadingDates) break;

    let phrase: { end: number; width: number; date: DateResult } | null = null;
    if (lo + 1 < hi) {
      const w2 = words[lo + 1];
      if (literals.has(input.slice(w.start, w2.end))) break;
      const combo = matchDateCombo(w.text, w2.text, today);
      if (combo) phrase = { end: w2.end, width: 2, date: combo };
    }
    if (!phrase) {
      const single = matchDateSingle(w.text, today);
      if (single) phrase = { end: w.end, width: 1, date: single };
    }
    if (!phrase) break;

    const raw = input.slice(w.start, phrase.end);
    if (!isUnmistakableDate(raw)) {
      notice(w.start, raw, "leading-date", `${raw} · not used`);
      break;
    }
    leading.push({
      kind: phrase.date.isDeadline ? "deadline" : "date",
      start: w.start,
      end: phrase.end,
      raw,
      value: phrase.date.date,
    });
    lo += phrase.width;
  }

  // Nothing parsed: the "@word"s skipped above are just more title, in place.
  if (trailing.length === 0 && leading.length === 0) {
    hi = words.length;
    carried.length = 0;
  }

  // Nothing left for a title — bail entirely.
  if (lo >= hi) return { result: { ...empty, notices: sortedNotices() }, leading: [] };

  // One token per kind applies: the earliest in the string. A losing DATE
  // phrase is not dropped (EI-379) — it stays in the title, in place, and
  // says it was not used. A losing priority or time is still just removed.
  const winners = new Map<QuickAddMatchKind, RawMatch>();
  const unused: RawMatch[] = [];
  for (const m of [...leading, ...trailing].sort((a, b) => a.start - b.start)) {
    if (!winners.has(m.kind)) {
      winners.set(m.kind, m);
    } else if (isDateKind(m.kind)) {
      unused.push(m);
      notice(m.start, m.raw, "unused-date", `${m.raw} · not used`);
    }
  }

  const title = [
    { start: words[lo].start, text: input.slice(words[lo].start, words[hi - 1].end).trim() },
    ...unused.map((m) => ({ start: m.start, text: m.raw })),
    ...carried.map((w) => ({ start: w.start, text: w.text })),
  ]
    .sort((a, b) => a.start - b.start)
    .map((piece) => piece.text)
    .join(" ");

  const applied = [...winners.values()].sort((a, b) => a.start - b.start);
  const value = (kind: QuickAddMatchKind) => winners.get(kind)?.value ?? null;

  return {
    result: {
      title,
      priority: value("priority") as Priority | null,
      scheduledDate: value("date") as CivilDate | null,
      deadline: value("deadline") as CivilDate | null,
      reminderTime: value("time") as string | null,
      assignee: winners.get("assignee")?.agent ?? null,
      matches: applied.map((m) => ({ raw: m.raw, kind: m.kind, label: labelForMatch(m, today) })),
      notices: sortedNotices(),
    },
    leading: applied.map((m) => leading.includes(m)),
  };
}

/**
 * Hands a folded date back to the text when the text has since gained a
 * date of the same kind (EI-379).
 *
 * Folding takes a date out of the field and holds it as a chip; a second
 * date typed after it would otherwise compete with a word no longer in the
 * text, and whichever the string happened to list first would win — the
 * folded one is reappended at the END (`quickAddDraftToString`), so it
 * always lost, silently. Putting it back where it was typed means the field
 * reads exactly as if it had been pasted: the earlier phrase wins and the
 * later one shows as "not used". Priority and time are not touched — a
 * second one still replaces the first, as `foldQuickAddDraft` documents.
 *
 * Pure, so the previews and the commit run it too, not only the fold:
 * "buy milk tomorrow " folds, then "fri" + Enter arrives with no space after
 * it, and must settle the same way.
 */
export function settleQuickAddDraft(
  text: string,
  confirmed: readonly QuickAddMatch[],
  today: CivilDate,
  presets: readonly ReminderPreset[] = [],
  options: QuickAddOptions = {},
): { text: string; confirmed: QuickAddMatch[] } {
  const parsed = parseQuickAdd(text.trim(), today, presets, options);
  const clashing = confirmed.filter(
    (c) => isDateKind(c.kind) && parsed.matches.some((m) => m.kind === c.kind),
  );
  if (clashing.length === 0) return { text, confirmed: [...confirmed] };
  // Last-typed position first, so restoring one never shifts another's `at`.
  let restored = text;
  for (const c of [...clashing].sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity))) {
    restored = restoreFoldedMatch(restored, c);
  }
  return { text: restored, confirmed: confirmed.filter((c) => !clashing.includes(c)) };
}

/**
 * Folds a just-completed match out of `text` into `confirmed` the moment a
 * finished word puts a trailing space at the very end of the string —
 * mirrors what `resolveMentionTrigger` (mention.ts) does for "#label"/"@list"
 * on an explicit popover pick. Date/time/priority tokens have no pick step
 * of their own, so a completed word substitutes for one: the same way
 * `parseQuickAdd` only recognizes a token once it's fully typed, this only
 * folds a token once it's fully typed AND terminated by a space, so a
 * still-in-progress word ("tom" of "tomato") is never yanked out from under
 * someone still typing it.
 *
 * Safe to call on every keystroke rather than needing a dedicated "was space
 * just pressed" hook: idempotent (re-running on an already-folded, unchanged
 * `text` finds nothing left to fold and returns it as-is) and a no-op
 * whenever `text` doesn't end in a space or nothing trailing matches.
 *
 * A newly-folded priority or time overwrites a `confirmed` one of the same
 * kind — retyping one replaces it. A DATE does not (EI-379): the folded one
 * goes back in the text first (`settleQuickAddDraft`), and then the field is
 * read like pasted text — one date wins, the other stays as "not used".
 * Nothing folds while a "not used" date is in the field: folding the winner
 * out would reappend it after the loser and hand the loser the win.
 */
export function foldQuickAddDraft(
  text: string,
  confirmed: readonly QuickAddMatch[],
  today: CivilDate,
  presets: readonly ReminderPreset[] = [],
  options: QuickAddOptions = {},
): { text: string; confirmed: QuickAddMatch[] } {
  if (!text.endsWith(" ")) return { text, confirmed: [...confirmed] };
  const trimmed = text.trimEnd();
  if (trimmed === "") return { text, confirmed: [...confirmed] };

  const settled = settleQuickAddDraft(trimmed, confirmed, today, presets, options);
  const unchanged = settled.confirmed.length === confirmed.length ? text : `${settled.text} `;
  const { result: parsed, leading } = scanQuickAdd(settled.text, today, presets, options);
  if (parsed.matches.length === 0 || parsed.notices.some((n) => n.kind === "unused-date")) {
    return { text: unchanged, confirmed: settled.confirmed };
  }

  const foldedKinds = new Set(parsed.matches.map((m) => m.kind));
  // Where each word goes back if its chip is dismissed: a trailing one after
  // the title, a leading one (EI-379) before it.
  const at = parsed.title.length + 1;
  return {
    text: `${parsed.title} `,
    confirmed: [
      ...settled.confirmed.filter((m) => !foldedKinds.has(m.kind)),
      ...parsed.matches.map((m, i) => ({ ...m, at: leading[i] ? 0 : at })),
    ],
  };
}

/**
 * Puts a folded match's word back into the live text — what dismissing its
 * chip does (EI-375). The caller also adds `match.raw` to its literals, so
 * the word reads as title text from then on instead of folding straight back
 * out on the next space.
 *
 * Goes back at `match.at`, where it was typed: "Call the dentist about
 * Thursday and…" folds "Thursday" out mid-sentence, and appending it would
 * scramble the title. Falls back to the end when `at` no longer sits on a
 * word boundary (the text before it was edited since).
 */
export function restoreFoldedMatch(text: string, match: QuickAddMatch): string {
  let at = Math.min(match.at ?? text.length, text.length);
  const insideWord = at > 0 && at < text.length && /\S/.test(text[at - 1]) && /\S/.test(text[at]);
  if (insideWord) at = text.length;
  const before = text.slice(0, at).trimEnd();
  const after = text.slice(at).trimStart();
  return [before, match.raw, after].filter(Boolean).join(" ");
}

/**
 * Reconstructs a single string carrying both the still-live `text` and every
 * match `foldQuickAddDraft` already folded out of it, for handing to
 * `parseQuickAdd`/`handleQuickAdd` at submit time exactly as if nothing had
 * ever been folded — the write path never needs to know folding happened.
 * Order among folded matches doesn't affect what `parseQuickAdd` extracts
 * from them (its trailing scan only requires them contiguous, not any
 * particular order among same-position kinds), only that they land after
 * `text`'s own title.
 */
export function quickAddDraftToString(text: string, confirmed: readonly QuickAddMatch[]): string {
  const trimmed = text.trim();
  if (confirmed.length === 0) return trimmed;
  const suffix = confirmed.map((m) => m.raw).join(" ");
  return trimmed ? `${trimmed} ${suffix}` : suffix;
}

// ---------------------------------------------------------------------------
// "@list" mentions typed as text, and where a quick-add lands (EI-375)
// ---------------------------------------------------------------------------

/**
 * "To Read", "to-read", "toread" and "To_Read" all fold to "toread": case,
 * spaces, hyphens and underscores are how people spell a list name from
 * memory, and none of them is a real difference between two lists.
 */
export function normalizeListName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

export type ListMentionMatch<L> =
  | { kind: "match"; list: L }
  | { kind: "ambiguous"; lists: L[] }
  | { kind: "none" };

/**
 * Which list a typed "@query" names. An exact name (ignoring case) wins
 * outright, so "@toread" still means a list literally called "Toread" when
 * "To Read" also exists. Only then the loose form (`normalizeListName`). Two
 * or more at the same level is ambiguous, and an ambiguous mention files
 * nowhere — guessing between two lists is how a capture gets lost.
 */
export function matchListMention<L extends { name: string }>(
  query: string,
  lists: readonly L[],
): ListMentionMatch<L> {
  const lower = query.toLowerCase();
  const exact = lists.filter((l) => l.name.toLowerCase() === lower);
  if (exact.length === 1) return { kind: "match", list: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", lists: exact };
  const key = normalizeListName(query);
  if (!key) return { kind: "none" };
  const loose = lists.filter((l) => normalizeListName(l.name) === key);
  if (loose.length === 1) return { kind: "match", list: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", lists: loose };
  return { kind: "none" };
}

/** An "@word" in the text that filed nowhere — `matches` lists that fit it:
 * 0 is "no such list", 2+ is "can't tell which". */
export interface UnresolvedListMention {
  raw: string;
  query: string;
  matches: number;
  /**
   * Set only when the candidates were not all lists (EI-426): "assignee" when
   * they were all assignees, "both" when a list and an assignee share the
   * name. Absent for the list-only case, so it reads as it always has.
   */
  among?: "assignee" | "both";
}

/** Which list or assignee a typed "@query" names — one pool, so a name used by
 * both a list and an assignee is ambiguous rather than quietly the list. */
function matchMention<L extends { name: string }, A extends { name: string }>(
  query: string,
  lists: readonly L[],
  assignees: readonly A[],
):
  | { kind: "list"; list: L }
  | { kind: "assignee"; assignee: A }
  | { kind: "ambiguous"; matches: number; among: UnresolvedListMention["among"] }
  | { kind: "none" } {
  if (assignees.length === 0) {
    const r = matchListMention(query, lists);
    if (r.kind === "match") return { kind: "list", list: r.list };
    if (r.kind === "ambiguous") return { kind: "ambiguous", matches: r.lists.length, among: undefined };
    return { kind: "none" };
  }
  type Candidate = { list: L } | { assignee: A };
  const pool: { name: string; c: Candidate }[] = [
    ...lists.map((list) => ({ name: list.name, c: { list } as Candidate })),
    ...assignees.map((assignee) => ({ name: assignee.name, c: { assignee } as Candidate })),
  ];
  const lower = query.toLowerCase();
  const key = normalizeListName(query);
  let found = pool.filter((p) => p.name.toLowerCase() === lower);
  if (found.length === 0 && key) found = pool.filter((p) => normalizeListName(p.name) === key);
  if (found.length === 0) return { kind: "none" };
  if (found.length === 1) {
    const c = found[0].c;
    return "list" in c ? { kind: "list", list: c.list } : { kind: "assignee", assignee: c.assignee };
  }
  const hasList = found.some((p) => "list" in p.c);
  const hasAssignee = found.some((p) => "assignee" in p.c);
  return {
    kind: "ambiguous",
    matches: found.length,
    among: hasList && hasAssignee ? "both" : hasAssignee ? "assignee" : undefined,
  };
}

/**
 * Lifts "@list" mentions out of typed text. The mention menu already does
 * this for a mention PICKED from it; this is the same thing for one typed out
 * in full and never picked (the menu closed on a space, or Enter came first),
 * which used to stay in the title and file into the column it was typed in.
 *
 * A mention that resolves is removed from the text, and the first one sets
 * the list. One that resolves nowhere stays in the text, reported in
 * `unresolved`, so the preview and the toast can say so. If lifting the
 * mentions would leave no text at all, nothing is lifted: "@groceries" on
 * its own is a title, not an empty to-do.
 */
export function extractListMentions<L extends { name: string }, A extends { name: string } = never>(
  input: string,
  lists: readonly L[],
  assignees: readonly A[] = [],
): { text: string; list: L | null; assignee: A | null; unresolved: UnresolvedListMention[] } {
  let list: L | null = null;
  let assignee: A | null = null;
  const unresolved: UnresolvedListMention[] = [];
  const spans: { start: number; end: number }[] = [];
  const re = /(^|\s)@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const start = m.index + m[1].length;
    const query = m[2];
    const result = matchMention(query, lists, assignees);
    if (result.kind === "list" || result.kind === "assignee") {
      if (result.kind === "list") list ??= result.list;
      else assignee ??= result.assignee;
      spans.push({ start, end: start + query.length + 1 });
    } else {
      unresolved.push({
        raw: `@${query}`,
        query,
        matches: result.kind === "ambiguous" ? result.matches : 0,
        ...(result.kind === "ambiguous" && result.among ? { among: result.among } : {}),
      });
    }
  }
  if (spans.length === 0) return { text: input, list: null, assignee: null, unresolved };

  let text = input;
  for (const span of [...spans].reverse()) {
    text = `${text.slice(0, span.start).trimEnd()} ${text.slice(span.end).trimStart()}`;
  }
  text = text.trim();
  if (!text) return { text: input, list: null, assignee: null, unresolved };
  return { text, list, assignee, unresolved };
}

export interface ResolvedQuickAdd<L, A extends QuickAddAssignee = QuickAddAssignee>
  extends Omit<QuickAdd, "assignee"> {
  /** The list a typed "@mention" resolved to — null when none did. A list
   * picked from the mention menu is the caller's, and outranks this. */
  list: L | null;
  /**
   * Who the to-do is assigned to (EI-426): a typed "@Name" (any assignee)
   * outranks a trailing "for <agent>". An assignee picked from the mention
   * menu is the caller's, and outranks both. When an "@Name" wins, a "for"
   * phrase is not parsed at all and stays in the title — never dropped.
   */
  assignee: A | QuickAddAssignee | null;
  unresolvedMentions: UnresolvedListMention[];
}

/**
 * Everything a quick-add field turns typed text into: the parsed tokens, the
 * list a typed "@mention" names, and the mentions that named nothing. The ONE
 * place the three quick-add paths (a column's row via `handleQuickAdd`, ⌘K's
 * "Create to-do" and its New to-do mode) and their previews read text, so the
 * chip and the write can never disagree (EI-235 duplicated the glue; this is
 * where new behavior goes instead).
 */
export function resolveQuickAdd<
  L extends { name: string },
  A extends QuickAddAssignee = QuickAddAssignee,
>(
  input: string,
  today: CivilDate,
  options: QuickAddOptions & {
    presets?: readonly ReminderPreset[];
    lists?: readonly L[];
    /** Every assignee, agents and people — an "@Name" may name either. The
     * agents among them are not inferred: pass `agents` for "for <name>". */
    assignees?: readonly A[];
  } = {},
): ResolvedQuickAdd<L, A> {
  const mentions = extractListMentions(input, options.lists ?? [], options.assignees ?? []);
  const parsed = parseQuickAdd(
    mentions.text,
    today,
    options.presets ?? [],
    mentions.assignee ? { ...options, agents: [] } : options,
  );
  return {
    ...parsed,
    list: mentions.list,
    assignee: mentions.assignee ?? parsed.assignee,
    unresolvedMentions: mentions.unresolved,
  };
}

/** The chip's words for an "@word" that filed nowhere. */
export function unresolvedMentionLabel(mention: UnresolvedListMention): string {
  if (mention.matches > 1) {
    if (mention.among === "both") return `${mention.raw} · list and assignee match`;
    if (mention.among === "assignee") return `${mention.raw} · ${mention.matches} assignees match`;
    return `${mention.raw} · ${mention.matches} lists match`;
  }
  return `${mention.raw} · no list`;
}

export interface QuickAddLanding {
  /** "Added to Thu, Oct 15 · To Read", "Added to Backlog". */
  message: string;
  /** A second line, only when part of what was typed did not apply. */
  note: string | null;
}

/**
 * What the toast after every quick-add says (EI-375): where the to-do went,
 * in the board's own terms — the day it is on, the list it is filed in — so
 * a capture that lands off-screen (next year, another tab) is never silent.
 *
 * Backlog is named only when it is the whole answer: a dated to-do sits on
 * its day, and "· Backlog" beside the date would read as a second place.
 */
export function describeQuickAddLanding({
  today,
  scheduledDate,
  list,
  assignee = null,
  unresolvedMentions = [],
}: {
  today: CivilDate;
  scheduledDate: CivilDate | null;
  list: { name: string; isBacklog?: boolean } | null;
  /** Who it was assigned to (EI-426) — named last: "Added to Fri · Instinct". */
  assignee?: { name: string } | null;
  unresolvedMentions?: readonly UnresolvedListMention[];
}): QuickAddLanding {
  const parts: string[] = [];
  if (scheduledDate) parts.push(formatQuickAddDate(scheduledDate, today));
  if (list && !(list.isBacklog && scheduledDate)) parts.push(list.name);
  if (parts.length === 0) parts.push("Backlog");
  if (assignee) parts.push(assignee.name);

  const notes = unresolvedMentions.map((m) =>
    m.matches > 1
      ? m.among === "both"
        ? `${m.raw} matches a list and an assignee, so it stayed in the title.`
        : `${m.raw} matches ${m.matches} ${m.among === "assignee" ? "assignees" : "lists"}, so it stayed in the title.`
      : `No list is called ${m.raw}, so it stayed in the title.`,
  );
  return { message: `Added to ${parts.join(" · ")}`, note: notes.length ? notes.join(" ") : null };
}
