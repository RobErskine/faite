import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { USER_DB_MIGRATIONS } from "./migrations";

/**
 * Migration 21 is the only one in the ledger that rewrites existing DATA
 * rather than adding a column, and it does it with string surgery — splice
 * before the closing bracket — because a Durable Object's SQLite is the only
 * engine it will ever run on and core string functions are the safe floor
 * there.
 *
 * `migrations.test.ts` runs against a fake SQL object that records statements
 * without executing them, which is right for testing ordering and atomicity
 * and useless for testing whether a string splice produces valid JSON. This
 * file runs the real statement against a real SQLite, because the failure
 * mode is a silently corrupted preference on a live account.
 */
const MIGRATION_21 = USER_DB_MIGRATIONS.find((m) => m.id === 21)!;

function seeded(values: string[]) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE settings (visible_activity_kinds text NOT NULL)");
  const insert = db.prepare("INSERT INTO settings VALUES (?)");
  for (const value of values) insert.run(value);
  return db;
}

function run(db: DatabaseSync) {
  for (const statement of MIGRATION_21.statements) db.exec(statement);
}

function read(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT visible_activity_kinds AS v FROM settings")
    .all()
    .map((row) => (row as { v: string }).v);
}

const SHIPPED_DEFAULT =
  '["created","scheduled","unscheduled","moved","done","dropped","reopened","edited","deleted","rolledOver","overflowed"]';

describe("migration 21 — attachment kinds reach accounts that predate them", () => {
  it("appends both kinds to the array every existing account already has", () => {
    const db = seeded([SHIPPED_DEFAULT]);
    run(db);
    expect(JSON.parse(read(db)[0])).toContain("attached");
    expect(JSON.parse(read(db)[0])).toContain("detached");
  });

  it("leaves the result valid JSON, and keeps every kind that was there", () => {
    const db = seeded([SHIPPED_DEFAULT]);
    run(db);
    const after = JSON.parse(read(db)[0]) as string[];
    for (const kind of JSON.parse(SHIPPED_DEFAULT) as string[]) {
      expect(after).toContain(kind);
    }
    expect(after).toHaveLength(13);
  });

  it("is idempotent — a second boot does not append them twice", () => {
    const db = seeded([SHIPPED_DEFAULT]);
    run(db);
    run(db);
    const after = JSON.parse(read(db)[0]) as string[];
    expect(after.filter((k) => k === "attached")).toHaveLength(1);
  });

  it("works on a hand-narrowed preference, not just the shipped default", () => {
    const db = seeded(['["created","done"]']);
    run(db);
    expect(JSON.parse(read(db)[0])).toEqual(["created", "done", "attached", "detached"]);
  });

  it("leaves an empty array alone — that is a deliberate 'show nothing'", () => {
    const db = seeded(["[]"]);
    run(db);
    expect(read(db)[0]).toBe("[]");
  });

  it("leaves a row that already has the kinds untouched", () => {
    const already = '["created","attached","detached"]';
    const db = seeded([already]);
    run(db);
    expect(read(db)[0]).toBe(already);
  });

  it("skips anything that is not an array rather than corrupting it", () => {
    const db = seeded(["null"]);
    run(db);
    expect(read(db)[0]).toBe("null");
  });
});
