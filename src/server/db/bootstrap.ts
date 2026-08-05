/**
 * Bootstrap DDL for a per-user Durable Object's SQLite storage (P3).
 *
 * A DO has no external migration-apply step the way D1 does (`wrangler d1
 * migrations apply`) — there is nothing to point at a live DO's storage from
 * outside it. So the DO migrates itself, once, in its constructor. `IF NOT
 * EXISTS` makes that safe to run on every cold start rather than needing a
 * "have I migrated" flag.
 *
 * This is hand-written from `drizzle/user/0000_oval_nico_minoru.sql` (itself
 * generated from `src/server/db/user-schema.ts` by `drizzle-kit generate
 * --config=drizzle.user-do.config.ts`) rather than loaded from that file at
 * runtime — the Workers bundle has no filesystem, and wrangler has no module
 * rule configured for importing `.sql` as text. Keep the two in sync by hand;
 * `drizzle-kit generate` is the source of truth to diff against after any
 * schema change.
 */
export const BOOTSTRAP_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS field_clocks (
    entity_id text NOT NULL,
    kind text NOT NULL,
    field text NOT NULL,
    hlc text NOT NULL,
    PRIMARY KEY (entity_id, field)
  )`,
  `CREATE TABLE IF NOT EXISTS labels (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    color text,
    emoji text,
    icon_url text,
    name text NOT NULL,
    position text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lists (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    color text,
    emoji text,
    icon_url text,
    name text NOT NULL,
    is_backlog integer DEFAULT false NOT NULL,
    archived_at text,
    archived_with_tab_id text,
    position text NOT NULL,
    tab_id text
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    color text,
    emoji text,
    icon_url text,
    name text NOT NULL,
    position text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    owner_id text PRIMARY KEY NOT NULL,
    timezone text DEFAULT 'UTC' NOT NULL,
    workdays_only integer DEFAULT false NOT NULL,
    workdays text DEFAULT '[1,2,3,4,5]' NOT NULL,
    overflow_after_days integer DEFAULT 3 NOT NULL,
    visible_days integer DEFAULT 7 NOT NULL,
    font_pairing text NOT NULL,
    theme text NOT NULL,
    display_name text DEFAULT '' NOT NULL,
    avatar_kind text NOT NULL,
    avatar_initials text DEFAULT '' NOT NULL,
    avatar_emoji text DEFAULT '' NOT NULL,
    avatar_image text DEFAULT '' NOT NULL,
    active_tab_id text,
    updated_at text NOT NULL,
    version integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_meta (
    id integer PRIMARY KEY NOT NULL,
    next_version integer DEFAULT 1 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tabs (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    color text,
    emoji text,
    icon_url text,
    name text NOT NULL,
    description text,
    is_default integer DEFAULT false NOT NULL,
    archived_at text,
    position text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS todos (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open' NOT NULL,
    priority integer,
    scheduled_date text,
    deadline text,
    list_id text,
    project_id text,
    label_ids text DEFAULT '[]' NOT NULL,
    location text,
    parent_id text,
    position text NOT NULL,
    recurrence_rule text,
    recurrence_parent_id text,
    completed_at text
  )`,
  // Seeds the singleton counter row exactly once — INSERT OR IGNORE keeps this
  // idempotent alongside the CREATE TABLEs above.
  `INSERT OR IGNORE INTO sync_meta (id, next_version) VALUES (1, 1)`,
];
