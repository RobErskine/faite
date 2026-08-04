import { z } from "zod";
import { DEFAULT_FONT_PAIRING, FONT_PAIRING_IDS } from "./fonts";

/**
 * Single source of truth for Faite's data model.
 *
 * This drives the local store now, and later Drizzle (P3), OpenAPI (P5), and
 * MCP (P7). Nothing should define these shapes independently.
 *
 * Two conventions that matter more than they look:
 *
 * 1. **Ids are UUIDv7.** Never per-user autoincrement. Records must be able to
 *    move between Durable Objects without collision when label sharing arrives.
 * 2. **Dates are civil dates ("YYYY-MM-DD"), not timestamps.** A todo scheduled
 *    for "Aug 4" means that calendar day in the user's timezone, not an instant.
 *    Storing an instant forces UTC-offset math on every render and produces
 *    off-by-one-day bugs across DST and travel. See lib/scheduling.ts.
 */

/** Civil date: a calendar day with no time or zone. */
export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD civil date");

export type CivilDate = z.infer<typeof civilDateSchema>;

/** UUIDv7 — time-ordered, so it also sorts usefully by creation. */
export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

/**
 * `dropped` is "won't do" — deliberately distinct from `done`. Collapsing them
 * loses the difference between finishing something and abandoning it, which
 * matters for history and stats.
 */
export const todoStatusSchema = z.enum(["open", "done", "dropped"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

/** 1 = highest. Matches the 4-level convention in the original spec. */
export const prioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type Priority = z.infer<typeof prioritySchema>;

/** Shared by lists, labels, and projects. */
export const decorationSchema = z.object({
  color: z.string().nullable().default(null),
  emoji: z.string().nullable().default(null),
  iconUrl: z.string().nullable().default(null),
});

/** Present on every syncable record. */
const syncableFields = {
  id: idSchema,
  ownerId: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
};

/**
 * A List is a column in the planning half. Single-assign and ordered.
 *
 * Lists are NOT labels. A label is multi-assign, so a labelled todo would have
 * to appear in several columns at once with several sort positions, and
 * dragging between columns would have no coherent meaning. Lists own the
 * column; labels are filters.
 */
export const listSchema = z.object({
  ...syncableFields,
  ...decorationSchema.shape,
  name: z.string().min(1),
  /** The Backlog list cannot be deleted or renamed. Exactly one per user. */
  isBacklog: z.boolean().default(false),
  /**
   * Set when the list is put away: it leaves the board WITH its to-dos, and
   * restoring brings both back.
   *
   * A sibling of `deletedAt`, not a reuse of it. Deleting is destructive and
   * rehomes the to-dos to Backlog; archiving is a filing decision that keeps
   * the list whole, which is what makes an item count meaningful in the
   * archive. Rows written before this field existed read back `undefined`, so
   * every filter must test truthiness rather than `=== null`.
   */
  archivedAt: z.string().nullable().default(null),
  /**
   * The tab that archived this list, when it went away as part of one.
   *
   * The group is RECORDED, not inferred. Matching on a shared `archivedAt`
   * looked equivalent and was cheaper, right up until two archives landed in
   * the same millisecond — `now()` has millisecond resolution, so a list filed
   * on its own moments before its tab was archived became indistinguishable
   * from one the tab took with it, and restoring the tab dragged it back.
   *
   * Null means "archived on its own", which is also what legacy rows read as.
   */
  archivedWithTabId: idSchema.nullable().default(null),
  /** Fractional index. See lib/ordering.ts. */
  position: z.string(),
  /**
   * The planning-half tab this list belongs to.
   *
   * Null means "pinned into every tab", which only Backlog is allowed to be —
   * it is the fallback column for homeless todos, so a tab without it would
   * quietly collect them (see buildBoard). Every other list is backfilled onto
   * the default tab by `ensureDefaultTab`.
   */
  tabId: idSchema.nullable().default(null),
});
export type List = z.infer<typeof listSchema>;

/** Multi-assign categorisation. Filter and chip only — never a column. */
export const labelSchema = z.object({
  ...syncableFields,
  ...decorationSchema.shape,
  name: z.string().min(1),
  position: z.string(),
});
export type Label = z.infer<typeof labelSchema>;

/** Single-assign bucket for cross-cutting work ("Bathroom Renovation 2026"). */
export const projectSchema = z.object({
  ...syncableFields,
  ...decorationSchema.shape,
  name: z.string().min(1),
  position: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const todoSchema = z.object({
  ...syncableFields,

  title: z.string(),
  /** Markdown. Editor UI lands in P6. */
  description: z.string().nullable().default(null),
  status: todoStatusSchema.default("open"),
  priority: prioritySchema.nullable().default(null),

  /**
   * The day this todo becomes relevant.
   *
   * Null means it lives in the planning half, in its list column. Setting it
   * moves the todo to the calendar half. Scheduling does NOT clear `listId` or
   * labels — the todo keeps its membership and simply renders in the other
   * half. See lib/scheduling.ts for how the column is derived.
   */
  scheduledDate: civilDateSchema.nullable().default(null),

  /**
   * Hard due date, independent of `scheduledDate`.
   *
   * A deadline never exempts a todo from overflow and never changes which
   * column it lands in. It is preserved verbatim and surfaced as a
   * missed-deadline badge once passed.
   */
  deadline: civilDateSchema.nullable().default(null),

  listId: idSchema.nullable().default(null),
  projectId: idSchema.nullable().default(null),
  labelIds: z.array(idSchema).default([]),

  /** Free text: "grocery store", "the in-laws' house". UI is P6. */
  location: z.string().nullable().default(null),

  /** One level of nesting. Sub-task UI is P6. */
  parentId: idSchema.nullable().default(null),

  /** Fractional index, scoped to whichever column the todo currently sits in. */
  position: z.string(),

  /**
   * Reserved for P6 recurrence: an RRULE string on a template row, with
   * occurrences materialised lazily over the visible window. Declared now so
   * the field exists before sync starts and does not require a migration.
   */
  recurrenceRule: z.string().nullable().default(null),
  recurrenceParentId: idSchema.nullable().default(null),

  completedAt: z.string().nullable().default(null),
});
export type Todo = z.infer<typeof todoSchema>;

/**
 * Per-user settings.
 *
 * `timezone` is load-bearing: the overflow rule counts days, so the day
 * boundary has to be the user's, not the server's or UTC's.
 */
export const settingsSchema = z.object({
  ownerId: idSchema,
  timezone: z.string().default("UTC"),
  /**
   * When true, missed todos roll over across working days only, so a Friday
   * miss lands on Monday rather than Saturday.
   *
   * This affects ROLLOVER TARGETS ONLY. A todo the user explicitly schedules
   * on a Saturday still shows on Saturday.
   */
  workdaysOnly: z.boolean().default(false),
  /** 0 = Sunday. Defaults to Mon–Fri. */
  workdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  /** How many days a missed todo rolls before dropping into Overflow. */
  overflowAfterDays: z.number().int().min(1).default(3),
  /** Day columns visible in the calendar half: 1, 3, 5, or 7. */
  visibleDays: z.number().int().min(1).max(7).default(7),
  /**
   * Typography pairing. Purely presentational, but stored (not localStorage)
   * so it syncs with the rest of the user's settings across devices.
   */
  fontPairing: z.enum(FONT_PAIRING_IDS).default(DEFAULT_FONT_PAIRING),
  /**
   * Which planning-half tab is showing.
   *
   * Stored rather than held in component state so the board comes back the way
   * it was left. Null (and any id that no longer resolves) falls back to the
   * default tab, which is why nothing has to clean this up when a tab is
   * archived or deleted.
   */
  activeTabId: idSchema.nullable().default(null),
  updatedAt: z.string(),
});
export type Settings = z.infer<typeof settingsSchema>;

/**
 * A Tab groups list columns in the planning half.
 *
 * Tabs partition the PLANNING half only. The calendar half is the week and
 * belongs to no tab, and Backlog is pinned into every tab (`List.tabId` null),
 * so switching tabs never changes what is scheduled or what is in Backlog.
 * See lib/board.ts for how that partition is applied.
 */
export const tabSchema = z.object({
  ...syncableFields,
  ...decorationSchema.shape,
  name: z.string().min(1),
  /** Prose shown as the tab's tooltip. Plain text, not markdown. */
  description: z.string().nullable().default(null),
  /**
   * The tab a user starts with. Cannot be archived or deleted — it is the
   * guaranteed destination for lists rehomed by `deleteTab`, the same role
   * Backlog plays for todos. Renaming and recolouring it are fine.
   */
  isDefault: z.boolean().default(false),
  /**
   * Set when the tab is put away: it leaves the strip WITH its lists, and
   * restoring brings both back.
   *
   * A sibling of `deletedAt`, not a reuse of it, for the same reasons given on
   * `listSchema.archivedAt`. The lists archived alongside a tab are stamped
   * with this exact timestamp, which is what lets `unarchiveTab` restore
   * precisely those and leave lists archived earlier alone.
   */
  archivedAt: z.string().nullable().default(null),
  /** Fractional index. See lib/ordering.ts. */
  position: z.string(),
});
export type Tab = z.infer<typeof tabSchema>;

/** Entity kinds that sync. Used to route outbox entries. */
export const entityKindSchema = z.enum([
  "todo",
  "list",
  "label",
  "project",
  "tab",
  "settings",
]);
export type EntityKind = z.infer<typeof entityKindSchema>;

/**
 * A pending local change awaiting upload.
 *
 * Written by mutate() from P1 onward even though nothing drains it until P3.
 * Recording changed fields (rather than whole records) is what allows the P3
 * merge to be field-level: two devices editing different fields of the same
 * todo must both survive.
 */
export const outboxEntrySchema = z.object({
  id: idSchema,
  kind: entityKindSchema,
  entityId: idSchema,
  /** Field-level patch. Keys are field names on the entity. */
  patch: z.record(z.string(), z.unknown()),
  /**
   * Hybrid Logical Clock timestamp. P1 writes a wall-clock ISO string; P3
   * replaces this with a real HLC. The field exists now so the shape is stable.
   */
  hlc: z.string(),
  createdAt: z.string(),
});
export type OutboxEntry = z.infer<typeof outboxEntrySchema>;
