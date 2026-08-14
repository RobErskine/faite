import { z } from "zod";
import { DEFAULT_FONT_PAIRING, FONT_PAIRING_IDS } from "./fonts";
import { DEFAULT_THEME_MODE, THEME_MODE_IDS } from "./theme";
import { AVATAR_KIND_IDS, DEFAULT_AVATAR_KIND } from "./profile";
import { RAIL_MAX, RAIL_MIN } from "./rail";
import { SPLIT_MAX_PERCENT, SPLIT_MIN_PERCENT } from "./split";

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

/** What a day-sheet timeline entry can be — see `buildDayTimeline` in `day-timeline.ts`. */
export const dayEventKindSchema = z.enum([
  "created",
  "scheduled",
  "done",
  "dropped",
  "rolledOver",
  "overflowed",
]);
export type DayEventKind = z.infer<typeof dayEventKindSchema>;

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
   * WHEN the current `scheduledDate` was assigned — an instant, not a civil
   * date. Null whenever `scheduledDate` is null.
   *
   * Stamped only on a genuine placement change (`schedulePatch`/`dayGroupPatch`
   * in `store/repositories.ts`), never on a write that merely repeats the same
   * date — dragging a card between list groups within one day writes
   * `scheduledDate` again but must not look like a fresh assignment. NOT
   * stamped at creation either: a todo quick-added directly onto a day was
   * never "moved" there, so `day-timeline.ts`'s "Assigned here" event would be
   * a redundant echo of "Created" for the same instant.
   *
   * This is what lets the day sheet's timeline show, on the day a todo is
   * CURRENTLY scheduled for, when that placement decision was made — which may
   * be a different calendar day than the one being viewed (dragging something
   * from today onto tomorrow is an event that belongs on tomorrow's timeline).
   * Like `completedAt`, only the LATEST placement survives: reschedule
   * something twice and only the second move is knowable.
   */
  scheduledAt: z.string().nullable().default(null),

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

  /**
   * A saved place (`Place`, above), when this todo's location was picked
   * from one rather than typed as free text. `location` is written too, set
   * to the place's `address` — that's what the card's tooltip and the plain
   * free-text field both show; `placeId` only adds the nickname badge in the
   * sheet. A dangling reference to a deleted place (`deletePlace` clears
   * this field but leaves `location` alone) degrades to that same address
   * text rather than showing nothing.
   */
  placeId: idSchema.nullable().default(null),

  /** One level of nesting. Sub-task UI is P6. */
  parentId: idSchema.nullable().default(null),

  /** Fractional index, scoped to whichever column the todo currently sits in. */
  position: z.string(),

  /**
   * The repeat rule, as a versioned JSON blob — **not** an RRULE. See
   * `lib/recurrence.ts` for the schema and the reasoning: RRULE's only
   * advantage is interop, and that is gone the moment `anchor: "completed"`
   * needs a non-standard extension.
   *
   * Stored verbatim as one field on purpose. `anchor` lives INSIDE the blob
   * rather than as a sibling column so the whole rule moves as a single unit
   * under field-level LWW — split across two fields, device A's anchor edit
   * could merge with device B's interval edit into a schedule neither user
   * asked for.
   */
  recurrenceRule: z.string().nullable().default(null),
  /**
   * Series linkage: the todo this occurrence was materialised from. Set on
   * the origin todo too, so a freshly created series shows its repeat
   * immediately rather than only from the second occurrence on.
   *
   * There is no exceptions table — occurrences are materialised on touch
   * (`lib/recurrence-expand.ts`) over the visible window, so there is no
   * pre-generated row to except.
   */
  recurrenceParentId: idSchema.nullable().default(null),

  completedAt: z.string().nullable().default(null),

  /**
   * Time of day, "HH:MM" 24-hour, resolved against `scheduledDate` in the
   * user's `Settings.timezone` — see `lib/zoned.ts`. A TIME, not an instant:
   * storing an instant would fix it to one timezone and wouldn't survive a
   * recurring todo's occurrence landing on a different date each time.
   *
   * Foreground only (P6): fires via `lib/reminders.ts` while a tab is open.
   * No effect while `scheduledDate` is null.
   */
  reminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected a HH:MM time")
    .nullable()
    .default(null),
});
export type Todo = z.infer<typeof todoSchema>;

/**
 * A day's notes — a journal entry, or loose things worth remembering.
 *
 * One row per calendar day, keyed BY that day: `id` is deterministic
 * (`daynote:YYYY-MM-DD`, see `dayNoteId` in `store/repositories.ts`) rather
 * than a UUIDv7. That is the one deliberate exception to convention 1 at the
 * top of this file, and the reason is convergence. There is exactly one note
 * per day, so two offline devices journaling the same Tuesday must collide on
 * ONE entity and let field-level LWW pick a `body`. With random ids they would
 * produce two rows for the same day and nothing in `sync/merge.ts` would ever
 * collapse them. Same precedent as `seed:list:backlog` and `DEFAULT_TAB_ID`.
 *
 * Safe here specifically because a day note is private and per-owner, so it
 * never needs to move between Durable Objects the way a shared label would.
 *
 * "Deleting" a note means writing `body: ""`, not setting `deletedAt` — the id
 * is guaranteed to be recreated the next time that day is opened, so a
 * tombstone would only buy a resurrect-vs-tombstone race. `deletedAt` stays on
 * the row because every syncable record has it and `apply-remote` assumes it.
 */
export const dayNoteSchema = z.object({
  ...syncableFields,
  /** The day this belongs to. Also encoded in `id`. */
  date: civilDateSchema,
  /** Markdown, same convention as `todoSchema.description`. */
  body: z.string().default(""),
});
export type DayNote = z.infer<typeof dayNoteSchema>;

/**
 * A saved location: a real address the user has typed once, given a
 * nickname ("Home", "Gym", "Mother-in-law's"), so it can be recalled by
 * that name instead of retyped.
 *
 * SCAFFOLD ONLY — this is the data model and sync plumbing, with no
 * Google Places lookup wired up yet. `googlePlaceId`/`lat`/`lng` are
 * populated once that lands (see `docs/GOOGLE-PLACES-SETUP.md`); until then
 * every place is entered by hand via `name`/`address` alone, exactly like
 * `Todo.location` free text is today. `Todo.location` is UNCHANGED and
 * stays the fallback for a todo with no saved place — see `Todo.placeId`.
 */
export const placeSchema = z.object({
  ...syncableFields,
  /** The nickname: "Home", "Gym", "Mother-in-law's". */
  name: z.string().min(1),
  /** The formatted address, however it was entered — by hand today, from
   * Google Place Details once the lookup exists. */
  address: z.string(),
  /** Set once the Google Places lookup is wired up. Null for a hand-entered place. */
  googlePlaceId: z.string().nullable().default(null),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
});
export type Place = z.infer<typeof placeSchema>;

/**
 * One entry in a todo's history log — created, moved, scheduled, edited,
 * completed, dropped, reopened, deleted. Append-only; nothing updates a row
 * after it's written except `deletedAt` (undo tombstoning only, see below).
 *
 * `kind` is `z.string()`, NOT an enum. `apply-remote.ts` skips a row that
 * fails Zod validation on a remote apply, and its cursor still advances —
 * an enum would mean shipping a new event kind permanently drops it on any
 * device running a stale cached bundle. Unknown kinds render as a neutral
 * "Updated" row instead. See `src/lib/todo-events.ts` for the known kinds
 * and their `payload` shapes.
 *
 * `id` is UUIDv7 like everything else here — NOT deterministic like
 * `dayNoteSchema.id`. Two devices marking the same todo done offline are two
 * genuine events, not one fact two devices raced to write.
 *
 * `at` is when the FACT happened; `createdAt` is when the row was written.
 * They differ only for the one synthetic `created` entry (see
 * `HISTORY_STARTS_AT` in `todo-timeline.ts`). Sort by `at`, tiebreak by `id`.
 *
 * `updatedAt`/`deletedAt`/`version` are inert by policy — there is no
 * `updateTodoEvent`. `deletedAt` has exactly one writer: undo tombstoning
 * (Phase 3), so an instantly-undone action doesn't leave a stray row.
 */
export const todoEventSchema = z.object({
  ...syncableFields,
  /** Advisory only — never cleared if the todo is later deleted. */
  todoId: idSchema,
  kind: z.string().min(1),
  at: z.string(),
  /** Pre-serialized JSON, same convention as `todoSchema.recurrenceRule`. */
  payload: z.string().nullable().default(null),
});
export type TodoEvent = z.infer<typeof todoEventSchema>;

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
  /**
   * How many days a missed todo rolls before dropping into Overflow — the
   * "Faite Loop" length. 0 means an item falls straight into Overflow the day
   * after it's missed; capped at 30 (there is deliberately no "never
   * overflow" option — see docs/FAITE-LOOP.md).
   */
  overflowAfterDays: z.number().int().min(0).max(30).default(3),
  /**
   * Day columns VISIBLE in the calendar half: 1, 3, 5, or 7.
   *
   * Counts columns you can see, not calendar days. With `showWeekends` off a
   * collapsed weekend strip is not a column, so 5 on a Friday means Fri, Mon,
   * Tue, Wed, Thu — five working columns spanning seven calendar days. The
   * span is derived by `calendarSpanFor` in components/board/weekend-runs.ts.
   */
  visibleDays: z.number().int().min(1).max(7).default(7),
  /**
   * Which statuses render on the board. Defaults to unfinished work only,
   * which is what the board did unconditionally before this was a setting.
   *
   * `done` and `dropped` are separate entries rather than one "show finished"
   * flag for the same reason `todoStatusSchema` keeps them apart: abandoning
   * something and completing it are different facts, and a user reviewing one
   * rarely wants the other.
   */
  visibleStatuses: z.array(todoStatusSchema).default(["open"]),
  /**
   * Which kinds render in a day sheet's Timeline section — filters that view,
   * not the board. Unlike `visibleStatuses` this may legally be empty: an
   * empty board looks broken, but a day sheet has its own "N hidden by the
   * view filter" notice for that case, so there's no ambiguity to guard against.
   */
  visibleEventKinds: z
    .array(dayEventKindSchema)
    .default(["created", "scheduled", "done", "dropped", "rolledOver", "overflowed"]),
  /**
   * When false, each run of consecutive non-working days collapses into a
   * single expandable strip and stops counting toward `visibleDays`.
   *
   * WHICH days those are is derived from `workdays` above rather than
   * hardcoded to Sat/Sun — one source of truth for "the weekend", and it
   * follows a user who works Tue–Sat. Note this is independent of
   * `workdaysOnly`, which governs rollover targets and nothing else.
   */
  showWeekends: z.boolean().default(true),
  /**
   * Typography pairing. Purely presentational, but stored (not localStorage)
   * so it syncs with the rest of the user's settings across devices.
   */
  fontPairing: z.enum(FONT_PAIRING_IDS).default(DEFAULT_FONT_PAIRING),
  /**
   * Appearance. Stored rather than kept in localStorage for the same reason
   * `fontPairing` is: it belongs to the account, not to the device.
   *
   * The stored value is the MODE, not the resolved palette. Storing "dark"
   * when the user picked "system" on a dark laptop would freeze the choice at
   * the moment they made it and stop it tracking the OS ever again.
   */
  theme: z.enum(THEME_MODE_IDS).default(DEFAULT_THEME_MODE),
  /** "" falls back to a placeholder name — see lib/profile.ts. */
  displayName: z.string().max(80).default(""),
  /**
   * Which of the three avatar fields below is active. Kept as flat fields
   * rather than a nested object so each edit is its own outbox entry — two
   * devices changing name and avatar at once must not clobber each other.
   */
  avatarKind: z.enum(AVATAR_KIND_IDS).default(DEFAULT_AVATAR_KIND),
  /** "" falls back to initials derived from displayName. */
  avatarInitials: z.string().max(2).default(""),
  avatarEmoji: z.string().default(""),
  /** A remote URL, or a small downscaled data: URL — see lib/avatar-image.ts. */
  avatarImage: z.string().default(""),
  /**
   * Which planning-half tab is showing.
   *
   * Stored rather than held in component state so the board comes back the way
   * it was left. Null (and any id that no longer resolves) falls back to the
   * default tab, which is why nothing has to clean this up when a tab is
   * archived or deleted.
   */
  activeTabId: idSchema.nullable().default(null),
  /**
   * Backlog and Overflow's rail widths, resized independently (one can hold a
   * lot while the other holds nothing, so they are never coupled). Null means
   * "never resized" — the CSS default (`--list-column-min`) applies, which
   * keeps that default declared in exactly one place rather than duplicated
   * here as a number that could drift from it.
   *
   * Device-local like `activeTabId` above, not synced: the right width for a
   * laptop screen is not the right width for a wide monitor on the same
   * account. See `SETTINGS_SYNCED_FIELDS` in `lib/sync/wire.ts`.
   */
  backlogWidth: z.number().int().min(RAIL_MIN).max(RAIL_MAX).nullable().default(null),
  backlogCollapsed: z.boolean().default(false),
  overflowWidth: z.number().int().min(RAIL_MIN).max(RAIL_MAX).nullable().default(null),
  overflowCollapsed: z.boolean().default(false),
  /**
   * Percent of the vertical split the calendar half gets — see split-handle.tsx
   * and use-split-resize.ts. Null means "never resized", same reasoning as the
   * rail widths above: the CSS default (`--split-top` in globals.css) stays
   * the single source of what that looks like.
   *
   * Unlike the rail widths, this one DOES sync (`SETTINGS_SYNCED_FIELDS` in
   * lib/sync/wire.ts): a percentage transfers between a laptop and a wide
   * monitor on the same account where a pixel width would not.
   */
  splitRatio: z.number().int().min(SPLIT_MIN_PERCENT).max(SPLIT_MAX_PERCENT).nullable().default(null),
  /**
   * Which half, if either, is collapsed. An enum rather than two booleans so
   * "both collapsed at once" is unrepresentable rather than merely avoided.
   */
  splitCollapsed: z.enum(["none", "calendar", "planning"]).default("none"),
  /**
   * Guards the first-run reminder-preset seed (EI-106 P3) so deleting all
   * five defaults doesn't resurrect them on next boot — an empty-table check
   * would do exactly that. Flips true the one time the seed runs; never
   * false again.
   */
  reminderPresetsSeeded: z.boolean().default(false),
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
   * Backlog plays for todos. Renaming and recoloring it are fine.
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

/**
 * A named, reusable reminder time — "In the morning" → `08:00` — picked
 * instead of typed (EI-106). A first-class synced entity like `Label`, not a
 * JSON column on `settings`: `settings` is flat by design so each edit is its
 * own outbox entry (`store/mutate.ts`), and a JSON array of presets would
 * clobber across devices on concurrent edits.
 *
 * Todos bind to a preset BY VALUE, not by reference — `Todo.reminderTime`
 * stores the literal `"HH:MM"` a preset resolved to, never a
 * `reminderPresetId`. Retiming a preset therefore relabels existing
 * reminders sitting on the old time rather than moving them; deleting a
 * preset touches no todo at all. See `docs/REMINDERS.md`.
 */
export const reminderPresetSchema = z.object({
  ...syncableFields,
  ...decorationSchema.shape,
  name: z.string().min(1),
  /** Wall-clock time of day, "HH:MM" — same convention as `Todo.reminderTime`. */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  /** Fractional index. See lib/ordering.ts. Chronological (`time`) order is
   * what the picker shows; this is only for the Settings reorder. */
  position: z.string(),
});
export type ReminderPreset = z.infer<typeof reminderPresetSchema>;

/** Entity kinds that sync. Used to route outbox entries. */
export const entityKindSchema = z.enum([
  "todo",
  "list",
  "label",
  "project",
  "tab",
  "dayNote",
  "place",
  "todoEvent",
  "reminderPreset",
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
