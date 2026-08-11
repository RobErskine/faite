import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  dayNoteSchema,
  labelSchema,
  listSchema,
  placeSchema,
  projectSchema,
  settingsSchema,
  tabSchema,
  todoSchema,
} from "@/lib/schema";
import { SYNC_KINDS } from "@/lib/sync/wire";
import { COLUMNS_BY_KIND, TABLE_NAME_BY_KIND } from "../sync/columns";
import { BOOTSTRAP_STATEMENTS } from "./bootstrap";
import { replayDdl } from "./ddl";
import { USER_DB_MIGRATIONS } from "./migrations";
import * as userSchema from "./user-schema";

/**
 * The mechanical half of `docs/SCHEMA-CHANGES.md`.
 *
 * A field in Faite is declared in four places and derived in three more, and
 * — this is the part that hurts — **almost none of the mismatches produce a
 * type error.** The worst of them (a column in `user-schema.ts` with no
 * migration) produces no error at all until the first push from an account
 * that already has data, at which point pushes fail *permanently* while pulls
 * keep working, so it presents as "my edits aren't saving on this device".
 *
 * These three assertions turn that class of mistake into a red test.
 *
 * See `docs/SCHEMA-OPS.md` for what to do when one of them fires.
 */

type SyncKindName = (typeof SYNC_KINDS)[number];

/** Only `.shape` is needed, and typing it structurally keeps this independent
 * of which generic parameters the installed Zod major happens to require. */
const ZOD_BY_KIND: Record<SyncKindName, { shape: Record<string, unknown> }> = {
  todo: todoSchema,
  list: listSchema,
  label: labelSchema,
  project: projectSchema,
  tab: tabSchema,
  dayNote: dayNoteSchema,
  place: placeSchema,
  settings: settingsSchema,
};

const TABLES_BY_KIND: Record<SyncKindName, SQLiteTable> = {
  todo: userSchema.todos,
  list: userSchema.lists,
  label: userSchema.labels,
  project: userSchema.projects,
  tab: userSchema.tabs,
  dayNote: userSchema.dayNotes,
  place: userSchema.places,
  settings: userSchema.settings,
};

/** Every table in the DO, including the two that are not sync kinds. */
const ALL_TABLES: SQLiteTable[] = [
  userSchema.todos,
  userSchema.lists,
  userSchema.labels,
  userSchema.projects,
  userSchema.tabs,
  userSchema.dayNotes,
  userSchema.places,
  userSchema.settings,
  userSchema.fieldClocks,
  userSchema.syncMeta,
];

/**
 * Fields that legitimately exist on one side only. Every entry needs a reason
 * — an unexplained divergence here is indistinguishable from the bug this
 * file exists to catch, so "add it to the allow-list" must never be the
 * reflexive fix.
 */
const KNOWN_DIVERGENCES: Record<string, { drizzleOnly?: string[]; zodOnly?: string[] }> = {
  // `version` is the server's own monotonic allocator, stamped from
  // `sync_meta` on every write and never sent to a client
  // (`SERVER_ONLY_FIELDS` in `wire.ts`). It has no client-side meaning, so it
  // is deliberately absent from every Zod schema.
  todo: { drizzleOnly: ["version"] },
  list: { drizzleOnly: ["version"] },
  label: { drizzleOnly: ["version"] },
  project: { drizzleOnly: ["version"] },
  tab: { drizzleOnly: ["version"] },
  dayNote: { drizzleOnly: ["version"] },
  place: { drizzleOnly: ["version"] },
  settings: { drizzleOnly: ["version"] },
};

function drizzleShape(table: SQLiteTable): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const [tsName, column] of Object.entries(getTableColumns(table))) {
    shape[tsName] = column.name;
  }
  return shape;
}

describe("bootstrap fingerprint", () => {
  /**
   * `bootstrap.ts` is the v1 DDL. Changing it is legal but must never be
   * accidental, because the two outcomes are wildly different:
   *
   * - a NEW account gets the change (its tables don't exist yet)
   * - an EXISTING account does NOT (`CREATE TABLE IF NOT EXISTS` is a no-op),
   *   and its next push throws `no such column`, forever
   *
   * So this pins the shape and forces a deliberate choice when it moves. It
   * does not — and should not — prevent the edit. See `docs/SCHEMA-OPS.md`.
   *
   * The day Rob decides to freeze `bootstrap.ts` for good, this assertion is
   * already the enforcement; "frozen" just means never running
   * `npm run schema:snapshot` again. Nothing here changes.
   */
  it("matches the committed snapshot — regenerate deliberately, never reflexively", async () => {
    const shape = replayDdl(BOOTSTRAP_STATEMENTS);
    const header = [
      "// The v1 schema every Durable Object starts from.",
      "// Regenerate with `npm run schema:snapshot` — read docs/SCHEMA-OPS.md first.",
      "",
    ].join("\n");

    try {
      await expect(`${header}${JSON.stringify(shape, null, 2)}\n`).toMatchFileSnapshot(
        "./__snapshots__/bootstrap-schema.json",
      );
    } catch (error) {
      // Vitest's snapshot diff shows only the changed region, so guidance
      // living in the snapshot file's own header is invisible at exactly the
      // moment it is needed. Re-throw with it attached to the message
      // instead, keeping the original diff underneath.
      throw new Error(
        [
          "bootstrap.ts changed. Pick one, ON PURPOSE:",
          "",
          "  (a) TINKER MODE — accept the new v1 shape:",
          "        npm run schema:snapshot && npm run schema:reset",
          "      Valid ONLY while every account is one you personally control,",
          "      because it destroys data on every account you do not reset.",
          "",
          "  (b) ADDITIVE — revert bootstrap.ts and add a migration instead:",
          "        migrations.ts: { id: N, name: '...', statements: ['ALTER TABLE ...'] }",
          "      The only option once anyone else has data. New accounts still",
          "      get it: a fresh DO runs the whole ledger, not just migration 1.",
          "",
          "docs/SCHEMA-OPS.md has the full procedure for both.",
          "",
          error instanceof Error ? error.message : String(error),
        ].join("\n"),
        { cause: error },
      );
    }
  });
});

describe("Zod <-> drizzle parity", () => {
  /**
   * A field declared in `schema.ts` but missing from `user-schema.ts` is
   * stripped by `sanitizePatch` and silently never syncs. There is no error,
   * no warning, and no test failure — it simply doesn't appear on the other
   * device. This is the assertion that makes that loud.
   */
  it.each(SYNC_KINDS)("%s has the same fields on both sides", (kind) => {
    const zodFields = new Set(Object.keys(ZOD_BY_KIND[kind].shape));
    const drizzleFields = new Set(Object.keys(drizzleShape(TABLES_BY_KIND[kind])));
    const allowed = KNOWN_DIVERGENCES[kind] ?? {};

    const missingFromDrizzle = [...zodFields]
      .filter((field) => !drizzleFields.has(field))
      .filter((field) => !allowed.zodOnly?.includes(field));
    const missingFromZod = [...drizzleFields]
      .filter((field) => !zodFields.has(field))
      .filter((field) => !allowed.drizzleOnly?.includes(field));

    expect(
      { missingFromDrizzle, missingFromZod },
      `${kind}: a field on only one side never syncs. Add the column to user-schema.ts ` +
        `(plus a migration), or add a documented entry to KNOWN_DIVERGENCES.`,
    ).toEqual({ missingFromDrizzle: [], missingFromZod: [] });
  });

  it("keeps COLUMNS_BY_KIND in step with the drizzle tables it derives from", () => {
    for (const kind of SYNC_KINDS) {
      expect(Object.keys(COLUMNS_BY_KIND[kind]).sort()).toEqual(
        Object.keys(drizzleShape(TABLES_BY_KIND[kind])).sort(),
      );
    }
  });
});

describe("migration ledger replay", () => {
  /**
   * **The one that catches the permanent-push-break.**
   *
   * Replays every shipped migration in order and asserts the resulting schema
   * is exactly what `user-schema.ts` describes. Add a column to the drizzle
   * schema without a corresponding `ALTER TABLE` and this fails here, in CI,
   * instead of in production on the first push from an account with data.
   *
   * It also replaces `SCHEMA-CHANGES.md` step 5's "hand-diff the generated SQL
   * against bootstrap.ts". That step existed because nothing checked this
   * mechanically. Now something does, and the check is against the thing that
   * actually runs (the ledger) rather than against a generated file that is
   * never loaded at runtime.
   */
  it("produces exactly the schema user-schema.ts declares", () => {
    const replayed = replayDdl(USER_DB_MIGRATIONS.flatMap((migration) => migration.statements));

    const expected: Record<string, string[]> = {};
    for (const table of ALL_TABLES) {
      expected[getTableName(table)] = Object.values(drizzleShape(table)).sort();
    }

    expect(
      replayed,
      "The migration ledger and user-schema.ts disagree. A column present in drizzle but " +
        "not in the ledger will throw `no such column` on the first push from any account " +
        "that already has data — permanently. Add an ALTER TABLE migration.",
    ).toEqual(expected);
  });

  it("names a physical table for every sync kind", () => {
    const replayed = replayDdl(USER_DB_MIGRATIONS.flatMap((migration) => migration.statements));
    for (const kind of SYNC_KINDS) {
      expect(replayed, `no table for kind "${kind}"`).toHaveProperty(TABLE_NAME_BY_KIND[kind]);
    }
  });
});
