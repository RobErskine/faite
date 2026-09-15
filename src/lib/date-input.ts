import { z } from "zod";
import { prioritySchema, type CivilDate } from "./schema";
import { civilDateOf } from "./scheduling";

/**
 * What a to-do's `scheduledDate`/`deadline` accept over the MCP tools and
 * `/api/v1/todos` (EI-338). Storage stays a civil date (`schema.ts`, rule 2);
 * this is only the input side.
 *
 * Two shapes, because an AI client reading "at 2pm tomorrow" naturally emits a
 * timestamp: a plain `YYYY-MM-DD`, or an ISO 8601 date-time WITH an offset.
 * A date-time with no offset is rejected — "14:00" in no zone names no day,
 * and guessing one is the off-by-one-day bug rule 2 exists to prevent.
 *
 * A date-time is saved as the day it falls on in the user's timezone, not the
 * day written in the string: `2026-09-15T23:30:00-04:00` is the 16th in UTC.
 */
const dateInputSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true }), z.null()]);

const FORMATS =
  'Either a date ("2026-09-15") or an ISO 8601 date-time with an offset ' +
  '("2026-09-15T14:00:00-04:00"); a date-time is saved as its date in the ' +
  "user's timezone. null clears it.";

export const scheduledDateInputSchema = dateInputSchema.describe(
  `The day the user plans to do it. ${FORMATS}`,
);

export const deadlineInputSchema = dateInputSchema.describe(
  `The date it must be done by. ${FORMATS}`,
);

export const priorityInputSchema = prioritySchema
  .nullable()
  .describe("1 to 4: 1 is the highest priority, 4 the lowest. null means no priority.");

interface DateInputs {
  scheduledDate?: string | null;
  deadline?: string | null;
}

/** A date-time → its civil date in `timezone`; a plain date or null as is. */
export function toCivilDate(value: string | null, timezone: string): CivilDate | null {
  if (value === null || !value.includes("T")) return value;
  return civilDateOf(value, timezone);
}

/**
 * Returns `input` with both date fields as civil dates. `loadTimezone` runs
 * only when a date-time is actually present, so the common plain-date call
 * costs no settings read. Absent keys stay absent — a PATCH must not grow
 * fields the caller never sent.
 */
export async function resolveDateInputs<T extends DateInputs>(
  input: T,
  loadTimezone: () => Promise<string>,
): Promise<T> {
  const needsZone = [input.scheduledDate, input.deadline].some((v) => typeof v === "string" && v.includes("T"));
  if (!needsZone) return input;

  const timezone = await loadTimezone();
  const resolved = { ...input };
  if (input.scheduledDate !== undefined) resolved.scheduledDate = toCivilDate(input.scheduledDate, timezone);
  if (input.deadline !== undefined) resolved.deadline = toCivilDate(input.deadline, timezone);
  return resolved;
}
