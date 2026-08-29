import { BOOTSTRAP_STATEMENTS } from "./bootstrap";

/**
 * Schema migrations for a per-user Durable Object's SQLite storage.
 *
 * ## Why this exists (read before adding a column anywhere)
 *
 * `bootstrap.ts` is a list of `CREATE TABLE IF NOT EXISTS` statements run in
 * the DO constructor. That is sufficient for a *new* Durable Object and
 * completely insufficient for an *existing* one, because `IF NOT EXISTS` is a
 * no-op when the table is already there. Adding a column to `user-schema.ts`
 * and `bootstrap.ts` therefore gives new accounts the column and **silently
 * never gives it to anyone who already has data.**
 *
 * The failure that follows is not subtle, and it is not a read error:
 * `COLUMNS_BY_KIND` (derived from `user-schema.ts`) starts allowing the new
 * field, `sanitizePatch` lets it through, and `insertRow`/`updateRow` name it
 * in SQL — so the first push carrying that field throws `no such column`
 * inside `push()`'s `transactionSync`. Pushes then fail **forever** for that
 * account while pulls keep working, so it presents as "my edits aren't
 * saving on one device" rather than as a migration problem.
 *
 * Hence a real, ordered, recorded migration ledger.
 *
 * ## Why a table and not `PRAGMA user_version`
 *
 * The chicken-and-egg problem that breaks columns does NOT break tables:
 * `CREATE TABLE IF NOT EXISTS schema_migrations` works fine on an existing
 * DO, because that table genuinely doesn't exist yet. A new table is the one
 * kind of schema change the old bootstrap mechanism can still deliver, which
 * makes it the right place to anchor the ledger. It also avoids depending on
 * which PRAGMAs Cloudflare's SQLite happens to permit — a question training
 * data is unreliable about (see `.ai/lessons.md`).
 *
 * ## The contract every migration must honour
 *
 * 1. **`id` starts at 1 and increases by exactly 1.** Enforced by
 *    `assertMigrationsWellFormed`, which runs in a test, not at boot.
 * 2. **Never edit or renumber a shipped migration.** It has already run on
 *    real Durable Objects and will not run again. Add a new one instead.
 * 3. **Migration 1 is the initial schema and must stay idempotent**, because
 *    an account created before this ledger existed has the tables but no
 *    ledger rows — so migration 1 re-runs against it exactly once. Every
 *    statement in `BOOTSTRAP_STATEMENTS` is `IF NOT EXISTS` / `INSERT OR
 *    IGNORE`, which is what makes that safe. Migrations 2+ do NOT need to be
 *    idempotent: each runs inside a transaction with its own ledger row, so
 *    it either fully applies or fully doesn't.
 * 4. **Additive only, in practice.** A client is a cached static bundle, so
 *    after any deploy old clients keep running against the new schema until
 *    someone refreshes. Dropping or renaming a column breaks them for that
 *    window. See `docs/SCHEMA-CHANGES.md`.
 */

export interface UserDbMigration {
  /** 1-based, contiguous, immutable once shipped. */
  id: number;
  /** Human label; recorded in the ledger for diagnosis. */
  name: string;
  statements: readonly string[];
}

export const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id integer PRIMARY KEY,
  name text NOT NULL,
  applied_at text NOT NULL
)`;

export const USER_DB_MIGRATIONS: readonly UserDbMigration[] = [
  {
    id: 1,
    name: "initial-schema",
    statements: BOOTSTRAP_STATEMENTS,
  },
  {
    id: 2,
    name: "settings-add-rail-layout",
    statements: [
      "ALTER TABLE settings ADD COLUMN backlog_width integer",
      "ALTER TABLE settings ADD COLUMN backlog_collapsed integer DEFAULT false NOT NULL",
      "ALTER TABLE settings ADD COLUMN overflow_width integer",
      "ALTER TABLE settings ADD COLUMN overflow_collapsed integer DEFAULT false NOT NULL",
    ],
  },
  {
    id: 3,
    name: "settings-add-view-prefs",
    statements: [
      // NOT NULL with a DEFAULT, matching the Zod defaults: every existing row
      // must come out of this ALTER with the behaviour it had before the
      // setting existed — open-only, weekends shown.
      `ALTER TABLE settings ADD COLUMN visible_statuses text DEFAULT '["open"]' NOT NULL`,
      "ALTER TABLE settings ADD COLUMN show_weekends integer DEFAULT true NOT NULL",
    ],
  },
  {
    id: 4,
    name: "settings-add-split-layout",
    statements: [
      // Nullable, matching backlog_width/overflow_width in migration 2: null
      // means "never resized", so no DEFAULT is needed here.
      "ALTER TABLE settings ADD COLUMN split_ratio integer",
      `ALTER TABLE settings ADD COLUMN split_collapsed text DEFAULT 'none' NOT NULL`,
    ],
  },
  {
    // Renumbered from 4 to 5 during the merge with feat/resizable-board-split,
    // which landed its own migration 4 first. Never renumber an id once it
    // has shipped — this one hadn't, so it was still safe to.
    id: 5,
    name: "add-day-notes",
    statements: [
      // Deliberately NOT also added to `bootstrap.ts`. A whole new table is one
      // of the two cases where duplicating into bootstrap is sanctioned, but it
      // buys nothing here and costs the snapshot dance in `schema-parity.test.ts`
      // — a fresh Durable Object runs the WHOLE ledger, not just migration 1, so
      // new accounts get this table from here exactly like existing ones do.
      //
      // `NOT NULL DEFAULT ''` on `body` is safe because this is a new table with
      // no existing rows; the prefer-nullable note below is about ALTER TABLE on
      // a populated one.
      `CREATE TABLE IF NOT EXISTS day_notes (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    date text NOT NULL,
    body text DEFAULT '' NOT NULL
  )`,
    ],
  },
  {
    id: 6,
    name: "todos-add-scheduled-at",
    statements: ["ALTER TABLE todos ADD COLUMN scheduled_at text"],
  },
  {
    id: 7,
    name: "settings-add-visible-event-kinds",
    statements: [
      // Same reasoning as migration 3: NOT NULL with a DEFAULT that matches
      // the Zod default, so every existing row comes out showing everything
      // the day sheet showed before this was a setting.
      `ALTER TABLE settings ADD COLUMN visible_event_kinds text DEFAULT '["created","scheduled","done","dropped"]' NOT NULL`,
    ],
  },
  {
    id: 8,
    name: "todos-add-reminder-time",
    statements: ["ALTER TABLE todos ADD COLUMN reminder_time text"],
  },
  {
    id: 9,
    name: "add-places",
    statements: [
      // A whole new table, not added to `bootstrap.ts` — same reasoning as
      // `add-day-notes` above: a fresh DO runs the WHOLE ledger, so new
      // accounts get this table from here exactly like existing ones do.
      `CREATE TABLE IF NOT EXISTS places (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    google_place_id text,
    lat real,
    lng real
  )`,
      "ALTER TABLE todos ADD COLUMN place_id text",
    ],
  },
  {
    id: 10,
    name: "add-todo-events",
    statements: [
      // A whole new table, not added to `bootstrap.ts` — same reasoning as
      // `add-day-notes`/`add-places` above: a fresh DO runs the WHOLE ledger,
      // so new accounts get this table from here exactly like existing ones do.
      // todo_id/kind/at nullable despite being required in Zod — see the doc
      // comment on `todoEvents` in `user-schema.ts` for why.
      `CREATE TABLE IF NOT EXISTS todo_events (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    todo_id text,
    kind text,
    at text,
    payload text
  )`,
    ],
  },
  {
    id: 11,
    name: "add-reminder-presets",
    statements: [
      // A whole new table, not added to `bootstrap.ts` — same reasoning as
      // `add-day-notes`/`add-places`/`add-todo-events` above: a fresh DO runs
      // the WHOLE ledger, so new accounts get this table from here exactly
      // like existing ones do.
      `CREATE TABLE IF NOT EXISTS reminder_presets (
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
    time text NOT NULL,
    position text NOT NULL
  )`,
      // Rides along on this migration rather than its own — EI-106 P3's
      // first-run seed and P1's entity are one change in practice, and one
      // migration is cheaper than two. Same NOT NULL + DEFAULT reasoning as
      // migration 3/7: every existing row comes out unseeded, matching the
      // Zod default and the actual behaviour before this field existed.
      "ALTER TABLE settings ADD COLUMN reminder_presets_seeded integer DEFAULT false NOT NULL",
    ],
  },
  {
    id: 12,
    name: "todos-add-source",
    statements: [
      // Nullable, pre-serialized JSON blob — same convention as
      // recurrence_rule (migration 1's bootstrap). Groundwork for D5
      // (context capture); nothing writes this column yet.
      "ALTER TABLE todos ADD COLUMN source text",
    ],
  },
  {
    id: 13,
    name: "settings-add-overdrive-tunables",
    statements: [
      // NOT NULL with a DEFAULT matching the Zod default, same reasoning as
      // migration 3/7/11: every existing row comes out with the exact
      // behaviour it had before these were settings — the hardcoded
      // `OVERDRIVE_MIN_TODOS` constant's value, and auto-confirm OFF.
      "ALTER TABLE settings ADD COLUMN overdrive_min_todos integer DEFAULT 5 NOT NULL",
      "ALTER TABLE settings ADD COLUMN overdrive_auto_confirm_ms integer DEFAULT 0 NOT NULL",
    ],
  },
  {
    id: 14,
    name: "lists-add-default-reminder-preset",
    statements: [
      "ALTER TABLE lists ADD COLUMN default_reminder_preset_id text",
    ],
  },
  {
    id: 15,
    name: "sync-meta-add-server-hlc",
    statements: [
      // Nullable: no server-originated write has happened yet for any
      // existing account, and `serverHlcClock`'s persistence adapter treats
      // NULL as "no prior stamp" exactly like a brand-new DO would (see
      // `hlc.ts`'s `localEvent(null, ...)` case). A4, EI-229 —
      // `UserDurableObject.nextServerHlc()` is the only writer.
      "ALTER TABLE sync_meta ADD COLUMN server_last_hlc text",
    ],
  },
  {
    id: 16,
    name: "lists-add-description",
    statements: [
      // Nullable, same convention as tabs.description (migration 1) — no
      // existing row needs a value, and there is no natural FIELD_DEFAULTS
      // fallback for freeform prose.
      "ALTER TABLE lists ADD COLUMN description text",
    ],
  },
  {
    id: 17,
    name: "settings-add-visible-activity-kinds",
    statements: [
      // Same reasoning as migration 7/13: NOT NULL with a DEFAULT matching
      // the Zod default, so every existing row comes out with the global
      // activity feed showing every kind, same as a fresh account.
      `ALTER TABLE settings ADD COLUMN visible_activity_kinds text DEFAULT '["created","scheduled","unscheduled","moved","done","dropped","reopened","edited","deleted","rolledOver","overflowed"]' NOT NULL`,
    ],
  },
  {
    id: 18,
    name: "add-attachments",
    statements: [
      // A whole new table, not added to `bootstrap.ts` — same reasoning as
      // `add-day-notes`/`add-places`/`add-todo-events`/`add-reminder-presets`
      // above: a fresh DO runs the WHOLE ledger, so new accounts get this
      // table from here exactly like existing ones do, and `bootstrap.ts`
      // keeps its frozen fingerprint.
      //
      // Every payload column is nullable despite being required in Zod — see
      // the doc comment on `attachments` in `user-schema.ts`, and migration
      // 10's identical reasoning for `todo_events`.
      `CREATE TABLE IF NOT EXISTS attachments (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    version integer NOT NULL,
    todo_id text,
    filename text,
    mime_type text,
    byte_size integer,
    storage_key text
  )`,
      // Reads are always "every attachment for this todo" — the sheet renders
      // one todo at a time, and the orphan sweep walks a todo's rows on
      // delete. Without this it is a full table scan per open.
      "CREATE INDEX IF NOT EXISTS attachments_todo_id_idx ON attachments (todo_id)",
    ],
  },
  {
    id: 19,
    name: "attachments-add-swept-at",
    statements: [
      // Nullable, server-only. Marks a tombstoned attachment whose R2 object
      // the sweep has already deleted, so the alarm's query stays bounded
      // instead of re-deleting long-gone objects forever. See the column's
      // doc comment in `user-schema.ts` and `SERVER_ONLY_FIELDS` in
      // `lib/sync/wire.ts` — it is never sent to a client.
      "ALTER TABLE attachments ADD COLUMN swept_at text",
    ],
  },
  {
    id: 20,
    name: "settings-add-good-job-mode",
    statements: [
      // NOT NULL with a DEFAULT matching the Zod default, same reasoning as
      // migrations 3/7/11/13: every existing row comes out with the exact
      // behaviour it had before this was a setting — confetti off.
      "ALTER TABLE settings ADD COLUMN good_job_mode integer NOT NULL DEFAULT 0",
    ],
  },
  // Add new migrations here. Never edit one above this line.
  //
  // Example — adding a nullable column (the safe, ordinary case):
  //   {
  //     id: 2,
  //     name: "todos-add-energy",
  //     statements: ["ALTER TABLE todos ADD COLUMN energy text"],
  //   },
  //
  // A NOT NULL column needs a DEFAULT, because existing rows must get a
  // value: `ALTER TABLE todos ADD COLUMN energy text NOT NULL DEFAULT 'medium'`.
  // Prefer nullable anyway — `upsert.ts` has to synthesize a placeholder for
  // every NOT NULL column missing from a partial create, and those arrive at
  // clients under `FLOOR_HLC`.
];

/** Thrown only from `assertMigrationsWellFormed`, i.e. only in tests. */
export class MigrationDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationDefinitionError";
  }
}

/**
 * Validates the migration list's shape. Deliberately NOT called at boot: a
 * malformed list is a programming error that a test must catch before deploy,
 * and throwing here at runtime would brick every Durable Object at once.
 */
export function assertMigrationsWellFormed(
  migrations: readonly UserDbMigration[] = USER_DB_MIGRATIONS,
): void {
  if (migrations.length === 0) {
    throw new MigrationDefinitionError("at least one migration (the initial schema) is required");
  }
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (!Number.isInteger(migration.id)) {
      throw new MigrationDefinitionError(`migration "${migration.name}" has a non-integer id`);
    }
    if (migration.id !== expected) {
      throw new MigrationDefinitionError(
        `migrations must be contiguous and 1-based: expected id ${expected} at index ${index}, got ${migration.id}`,
      );
    }
    if (migration.name.trim() === "") {
      throw new MigrationDefinitionError(`migration ${migration.id} needs a name`);
    }
    if (migration.statements.length === 0) {
      throw new MigrationDefinitionError(`migration ${migration.id} ("${migration.name}") has no statements`);
    }
  });
}

/**
 * Which migrations still need to run, in order. Pure — this is the decision
 * layer, so it can be tested without any SQLite at all.
 *
 * Filters on membership rather than `id > max(applied)` so a ledger with a
 * hole (only reachable by hand-editing, but still) heals instead of silently
 * skipping the missing one forever.
 */
export function planMigrations(
  appliedIds: ReadonlySet<number>,
  migrations: readonly UserDbMigration[] = USER_DB_MIGRATIONS,
): UserDbMigration[] {
  return migrations.filter((migration) => !appliedIds.has(migration.id));
}

/** The narrow slice of `SqlStorage` this needs, so tests can fake it. */
export interface MigrationSql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export interface MigrationResult {
  /** Ids applied by this call. Empty on every boot after the first. */
  applied: number[];
  /** Ids already present in the ledger when this call started. */
  alreadyApplied: number[];
}

/**
 * Brings the DO's storage up to date. Safe to call on every cold start —
 * after the first, it is one `CREATE TABLE IF NOT EXISTS` plus one `SELECT`.
 *
 * Each migration runs inside its own transaction together with its ledger
 * row, so a crash mid-migration can never leave the schema half-changed with
 * the ledger claiming success. `runInTransaction` is injected rather than
 * reached for, both to keep this testable and because `transactionSync`'s
 * closure must be synchronous.
 */
export function runUserDbMigrations(
  sql: MigrationSql,
  runInTransaction: (fn: () => void) => void,
  migrations: readonly UserDbMigration[] = USER_DB_MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): MigrationResult {
  sql.exec(MIGRATIONS_TABLE_DDL);

  const appliedIds = new Set<number>();
  for (const row of sql.exec("SELECT id FROM schema_migrations").toArray()) {
    appliedIds.add(Number(row.id));
  }

  const pending = planMigrations(appliedIds, migrations);
  const applied: number[] = [];

  for (const migration of pending) {
    runInTransaction(() => {
      for (const statement of migration.statements) {
        sql.exec(statement);
      }
      sql.exec(
        "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
        migration.id,
        migration.name,
        now(),
      );
    });
    applied.push(migration.id);
  }

  if (applied.length > 0) {
    console.log(`[faite] applied user-db migrations: ${applied.join(", ")}`);
  }

  return { applied, alreadyApplied: [...appliedIds].sort((a, b) => a - b) };
}
