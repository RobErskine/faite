import { describe, expect, it } from "vitest";
import { BOOTSTRAP_STATEMENTS } from "./bootstrap";
import type { MigrationSql, UserDbMigration } from "./migrations";
import {
  assertMigrationsWellFormed,
  MigrationDefinitionError,
  planMigrations,
  runUserDbMigrations,
  USER_DB_MIGRATIONS,
} from "./migrations";

/**
 * A deliberately dumb SQL stand-in: it records statements and models the one
 * behaviour these tests care about — the `schema_migrations` ledger. Enough
 * to pin ordering, atomicity, and idempotence without a Durable Object.
 * The real SQL is exercised by `scripts/sync-smoke/`.
 */
function fakeSql(seedLedger: number[] = []) {
  const executed: string[] = [];
  const ledger = new Map<number, string>();
  for (const id of seedLedger) ledger.set(id, `seeded-${id}`);

  const sql: MigrationSql & { executed: string[]; ledger: Map<number, string> } = {
    executed,
    ledger,
    exec(query: string, ...bindings: unknown[]) {
      executed.push(query);
      // Sentinel so a test can make a migration fail mid-transaction.
      if (query.includes("EXPLODES")) throw new Error(`near "EXPLODES": syntax error`);
      if (query.startsWith("SELECT id FROM schema_migrations")) {
        return { toArray: () => [...ledger.keys()].map((id) => ({ id })) };
      }
      if (query.startsWith("INSERT INTO schema_migrations")) {
        ledger.set(bindings[0] as number, bindings[1] as string);
      }
      return { toArray: () => [] };
    },
  };
  return sql;
}

const passthrough = (fn: () => void) => fn();

const FIXTURE: UserDbMigration[] = [
  { id: 1, name: "initial", statements: ["CREATE TABLE IF NOT EXISTS todos (id text)"] },
  { id: 2, name: "add-energy", statements: ["ALTER TABLE todos ADD COLUMN energy text"] },
  { id: 3, name: "add-effort", statements: ["ALTER TABLE todos ADD COLUMN effort integer"] },
];

describe("the shipped migration list", () => {
  it("is well formed", () => {
    expect(() => assertMigrationsWellFormed()).not.toThrow();
  });

  it("starts with the initial schema, which must be exactly bootstrap.ts", () => {
    // Migration 1 re-runs against every account created before this ledger
    // existed. It is only safe to do that because every bootstrap statement
    // is IF NOT EXISTS / INSERT OR IGNORE.
    //
    // NB this is an IDENTITY check, and identity is all it can be: it pins
    // that migration 1 *is* the bootstrap list, not what that list contains.
    // Editing `bootstrap.ts` keeps this green while silently changing what
    // migration 1 means — the exact hole `docs/SCHEMA-CHANGES.md` warns
    // about. `schema-parity.test.ts`'s bootstrap fingerprint is what closes
    // it; do not treat this assertion as covering that.
    expect(USER_DB_MIGRATIONS[0].id).toBe(1);
    expect(USER_DB_MIGRATIONS[0].statements).toBe(BOOTSTRAP_STATEMENTS);
  });

  it("keeps migration 1 idempotent", () => {
    for (const statement of USER_DB_MIGRATIONS[0].statements) {
      const safe = /IF NOT EXISTS|INSERT OR IGNORE/i.test(statement);
      expect(safe, `not idempotent: ${statement.slice(0, 60)}`).toBe(true);
    }
  });
});

describe("assertMigrationsWellFormed", () => {
  it("rejects an empty list", () => {
    expect(() => assertMigrationsWellFormed([])).toThrow(MigrationDefinitionError);
  });

  it("rejects a gap", () => {
    expect(() => assertMigrationsWellFormed([FIXTURE[0], FIXTURE[2]])).toThrow(/contiguous/);
  });

  it("rejects a duplicate id", () => {
    expect(() => assertMigrationsWellFormed([FIXTURE[0], FIXTURE[0]])).toThrow(/contiguous/);
  });

  it("rejects a list that does not start at 1", () => {
    expect(() => assertMigrationsWellFormed([FIXTURE[1]])).toThrow(/expected id 1/);
  });

  it("rejects an empty statement list or a blank name", () => {
    expect(() => assertMigrationsWellFormed([{ id: 1, name: "x", statements: [] }])).toThrow(/no statements/);
    expect(() => assertMigrationsWellFormed([{ id: 1, name: " ", statements: ["SELECT 1"] }])).toThrow(/needs a name/);
  });
});

describe("planMigrations", () => {
  it("returns everything for a fresh object", () => {
    expect(planMigrations(new Set(), FIXTURE).map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("returns nothing when fully applied", () => {
    expect(planMigrations(new Set([1, 2, 3]), FIXTURE)).toEqual([]);
  });

  it("returns only the tail when partially applied", () => {
    expect(planMigrations(new Set([1]), FIXTURE).map((m) => m.id)).toEqual([2, 3]);
  });

  it("heals a hole rather than skipping it forever", () => {
    // Filters on membership, not `id > max(applied)`. Only reachable by hand-
    // editing the ledger, but the alternative silently never repairs.
    expect(planMigrations(new Set([1, 3]), FIXTURE).map((m) => m.id)).toEqual([2]);
  });

  it("preserves declaration order", () => {
    expect(planMigrations(new Set([2]), FIXTURE).map((m) => m.id)).toEqual([1, 3]);
  });
});

describe("runUserDbMigrations", () => {
  it("creates the ledger table before reading it", () => {
    const sql = fakeSql();
    runUserDbMigrations(sql, passthrough, FIXTURE);
    const createIndex = sql.executed.findIndex((q) => q.includes("CREATE TABLE IF NOT EXISTS schema_migrations"));
    const selectIndex = sql.executed.findIndex((q) => q.startsWith("SELECT id FROM schema_migrations"));
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeLessThan(selectIndex);
  });

  it("applies everything on a fresh object and records it", () => {
    const sql = fakeSql();
    const result = runUserDbMigrations(sql, passthrough, FIXTURE);
    expect(result.applied).toEqual([1, 2, 3]);
    expect([...sql.ledger.keys()]).toEqual([1, 2, 3]);
  });

  it("is a no-op on the next boot", () => {
    const sql = fakeSql();
    runUserDbMigrations(sql, passthrough, FIXTURE);
    const before = sql.executed.length;
    const second = runUserDbMigrations(sql, passthrough, FIXTURE);
    expect(second.applied).toEqual([]);
    // Only the CREATE IF NOT EXISTS and the SELECT.
    expect(sql.executed.length - before).toBe(2);
  });

  it("REGRESSION: an EXISTING object with no ledger gets later migrations", () => {
    // The whole reason this module exists. Before it, an account with data
    // already had every table, so `CREATE TABLE IF NOT EXISTS` was a no-op
    // and a new COLUMN never arrived — then the first push naming that column
    // threw `no such column` inside push()'s transaction, permanently, while
    // pulls kept working.
    const sql = fakeSql(); // empty ledger, pretend the tables already exist
    const result = runUserDbMigrations(sql, passthrough, FIXTURE);
    expect(result.applied).toContain(2);
    expect(sql.executed).toContain("ALTER TABLE todos ADD COLUMN energy text");
  });

  it("runs each migration's statements AND its ledger row in ONE transaction", () => {
    // Atomicity is what makes migrations 2+ safe without being idempotent: a
    // crash mid-migration must not leave the schema changed with the ledger
    // claiming success, or vice versa.
    const sql = fakeSql();
    const transactions: string[][] = [];
    runUserDbMigrations(
      sql,
      (fn) => {
        const start = sql.executed.length;
        fn();
        transactions.push(sql.executed.slice(start));
      },
      FIXTURE,
    );

    expect(transactions).toHaveLength(3);
    for (const [index, statements] of transactions.entries()) {
      expect(statements).toContain(FIXTURE[index].statements[0]);
      expect(statements.some((s) => s.startsWith("INSERT INTO schema_migrations"))).toBe(true);
    }
  });

  it("REGRESSION: a migration whose statement throws records nothing and stops the run", () => {
    // Models `transactionSync`: the wrapper restores the ledger on throw, so
    // this asserts the real guarantee — a failed ALTER must not leave a
    // ledger row claiming it succeeded, because that row would permanently
    // skip the migration and reintroduce the `no such column` break this
    // module exists to prevent. It must also not apply LATER migrations on
    // top of a schema that never got the earlier one.
    const sql = fakeSql();
    const rollingBack = (fn: () => void) => {
      const snapshot = new Map(sql.ledger);
      try {
        fn();
      } catch (error) {
        sql.ledger.clear();
        for (const [id, name] of snapshot) sql.ledger.set(id, name);
        throw error;
      }
    };

    const broken: UserDbMigration[] = [
      FIXTURE[0],
      { id: 2, name: "doomed", statements: ["THIS STATEMENT EXPLODES"] },
      FIXTURE[2],
    ];

    expect(() => runUserDbMigrations(sql, rollingBack, broken)).toThrow(/EXPLODES/);
    expect([...sql.ledger.keys()]).toEqual([1]); // 1 committed, 2 rolled back
    expect(sql.executed).not.toContain(FIXTURE[2].statements[0]); // 3 never ran
  });

  it("applies in ascending order, never out of sequence", () => {
    const sql = fakeSql();
    runUserDbMigrations(sql, passthrough, FIXTURE);
    const energyAt = sql.executed.indexOf("ALTER TABLE todos ADD COLUMN energy text");
    const effortAt = sql.executed.indexOf("ALTER TABLE todos ADD COLUMN effort integer");
    expect(energyAt).toBeGreaterThan(-1);
    expect(effortAt).toBeGreaterThan(energyAt);
  });

  it("reports what was already applied, for diagnosis", () => {
    const sql = fakeSql([1]);
    const result = runUserDbMigrations(sql, passthrough, FIXTURE);
    expect(result.alreadyApplied).toEqual([1]);
    expect(result.applied).toEqual([2, 3]);
  });
});
