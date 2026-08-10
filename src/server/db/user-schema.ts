import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Per-user Durable Object storage schema (P3, EI-46/EI-47).
 *
 * Mirrors the shapes in `src/lib/schema.ts` — that Zod schema stays the
 * single source of truth for the data model; this file only maps it onto
 * SQLite columns. Two additions that have no client-side equivalent:
 *
 * - `version` on every entity table: a monotonic integer stamped from
 *   `sync_meta` on each write. Drives `since=version` pulls (EI-46) — a
 *   client asks for every row with `version > cursor`, across every kind,
 *   using one counter as a single global watermark.
 * - `field_clocks`: the server's per-field HLC store. The client derives a
 *   field's clock from its outbox (D2) because it has exactly one writer;
 *   the DO has many concurrent writers and no outbox, so it needs a real
 *   column. One row per (entityId, field) that has ever been written.
 *
 * Schema and migrations only at this phase — no RPC, no fetch handlers, no
 * client calls. See `src/server/user-do.ts` and `src/server/sync/apply-patch.ts`.
 */

/** Fields shared by every syncable entity table. */
const syncableColumns = {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  /** Monotonic write counter — see file header. */
  version: integer("version").notNull(),
};

/** Fields shared by lists, labels, projects, and tabs. */
const decorationColumns = {
  color: text("color"),
  emoji: text("emoji"),
  iconUrl: text("icon_url"),
};

export const lists = sqliteTable("lists", {
  ...syncableColumns,
  ...decorationColumns,
  name: text("name").notNull(),
  isBacklog: integer("is_backlog", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),
  archivedWithTabId: text("archived_with_tab_id"),
  position: text("position").notNull(),
  tabId: text("tab_id"),
});

export const labels = sqliteTable("labels", {
  ...syncableColumns,
  ...decorationColumns,
  name: text("name").notNull(),
  position: text("position").notNull(),
});

export const projects = sqliteTable("projects", {
  ...syncableColumns,
  ...decorationColumns,
  name: text("name").notNull(),
  position: text("position").notNull(),
});

export const todos = sqliteTable("todos", {
  ...syncableColumns,
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: integer("priority"),
  scheduledDate: text("scheduled_date"),
  deadline: text("deadline"),
  listId: text("list_id"),
  projectId: text("project_id"),
  /** JSON-encoded array of label ids — see `todoSchema.labelIds`. */
  labelIds: text("label_ids").notNull().default("[]"),
  location: text("location"),
  parentId: text("parent_id"),
  position: text("position").notNull(),
  recurrenceRule: text("recurrence_rule"),
  recurrenceParentId: text("recurrence_parent_id"),
  completedAt: text("completed_at"),
});

export const tabs = sqliteTable("tabs", {
  ...syncableColumns,
  ...decorationColumns,
  name: text("name").notNull(),
  description: text("description"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),
  position: text("position").notNull(),
});

/**
 * One notes row per calendar day. `id` is deterministic (`daynote:<date>`) so
 * two offline devices editing the same day converge on one row — see
 * `dayNoteSchema` in `src/lib/schema.ts` for why that breaks the UUIDv7 rule.
 */
export const dayNotes = sqliteTable("day_notes", {
  ...syncableColumns,
  date: text("date").notNull(),
  body: text("body").notNull().default(""),
});

/** Singleton row, keyed by `ownerId` — one settings row per DO (one owner per DO). */
export const settings = sqliteTable("settings", {
  ownerId: text("owner_id").primaryKey(),
  timezone: text("timezone").notNull().default("UTC"),
  workdaysOnly: integer("workdays_only", { mode: "boolean" }).notNull().default(false),
  /** JSON-encoded array of weekday numbers — see `settingsSchema.workdays`. */
  workdays: text("workdays").notNull().default("[1,2,3,4,5]"),
  overflowAfterDays: integer("overflow_after_days").notNull().default(3),
  visibleDays: integer("visible_days").notNull().default(7),
  /** JSON-encoded array of statuses — see `settingsSchema.visibleStatuses`. */
  visibleStatuses: text("visible_statuses").notNull().default('["open"]'),
  showWeekends: integer("show_weekends", { mode: "boolean" }).notNull().default(true),
  fontPairing: text("font_pairing").notNull(),
  theme: text("theme").notNull(),
  displayName: text("display_name").notNull().default(""),
  avatarKind: text("avatar_kind").notNull(),
  avatarInitials: text("avatar_initials").notNull().default(""),
  avatarEmoji: text("avatar_emoji").notNull().default(""),
  avatarImage: text("avatar_image").notNull().default(""),
  activeTabId: text("active_tab_id"),
  /** Nullable: null means "never resized", the CSS default applies. */
  backlogWidth: integer("backlog_width"),
  backlogCollapsed: integer("backlog_collapsed", { mode: "boolean" }).notNull().default(false),
  overflowWidth: integer("overflow_width"),
  overflowCollapsed: integer("overflow_collapsed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull(),
});

/**
 * Per-field HLC — the server-side counterpart of the client's outbox-derived
 * clock (D2). `kind` is stored alongside `entityId` for query convenience
 * even though ids are already globally unique (UUIDv7); it saves a fan-out
 * across every entity table to find where a given id lives.
 */
export const fieldClocks = sqliteTable(
  "field_clocks",
  {
    entityId: text("entity_id").notNull(),
    kind: text("kind").notNull(),
    field: text("field").notNull(),
    hlc: text("hlc").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.field] })],
);

/** Singleton row (`id` always 1) holding the next value to stamp as `version`. */
export const syncMeta = sqliteTable("sync_meta", {
  id: integer("id").primaryKey(),
  nextVersion: integer("next_version").notNull().default(1),
});
