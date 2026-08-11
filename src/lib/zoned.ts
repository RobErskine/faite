import type { CivilDate } from "./schema";

/**
 * Civil date + time-of-day + IANA timezone -> the ISO instant it names.
 *
 * `scheduling.ts` only converts the other direction (instant -> civil date),
 * because everything else in this app reasons in civil dates. Reminders are
 * the one feature that needs a real wall-clock TIME, which forces this
 * inverse — and there is no `Intl` API for it.
 *
 * The algorithm: guess the instant as if the wall-clock digits were UTC, then
 * measure how far that guess reads back in the TARGET zone, and correct by
 * the difference. One correction is exact away from a DST transition; a
 * second pass handles landing on the wrong side of one.
 *
 * KNOWN LIMITATION, undocumented by design rather than solved: during the
 * one hour a year a zone falls back (an ambiguous wall time, occurring
 * twice) or springs forward (a wall time that never occurs at all), this
 * returns A valid instant near the requested time, not necessarily the
 * "first occurrence" / "shifted forward" reading a full disambiguation
 * algorithm (Temporal's `compatible` mode) would pick. Out of scope for a
 * foreground-only reminder feature; revisit if it ever needs to be exact.
 */

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTER_CACHE.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  PARTS_FORMATTER_CACHE.set(timezone, formatter);
  return formatter;
}

/**
 * The zone's UTC offset in minutes (positive = ahead of UTC) AT `instant`.
 *
 * Computed by reading `instant`'s wall-clock digits in `timezone`, then
 * asking how far those same digits, read as UTC, sit from `instant` itself.
 */
function offsetMinutesAt(instant: number, timezone: string): number {
  const parts = partsFormatter(timezone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUtc - instant) / 60_000;
}

/** Parses "HH:MM" into `{ hour, minute }`. Throws on anything else — callers validate upstream (`todoSchema.reminderTime`). */
function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`zonedInstant: malformed time "${time}"`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * The ISO instant `date` at `time` in `timezone` names.
 *
 * Falls back to UTC on an unrecognized timezone, matching `scheduling.ts`'s
 * `civilDateFormatter` — a bad stored timezone must not throw mid-render.
 */
export function zonedInstant(date: CivilDate, time: string, timezone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const { hour, minute } = parseTime(time);
  const wallAsUtc = Date.UTC(y, m - 1, d, hour, minute, 0);

  let zone = timezone;
  try {
    // Probing validity — throws on a bad IANA name.
    partsFormatter(zone);
  } catch {
    zone = "UTC";
  }

  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    guess = wallAsUtc - offsetMinutesAt(guess, zone) * 60_000;
  }
  return new Date(guess).toISOString();
}
