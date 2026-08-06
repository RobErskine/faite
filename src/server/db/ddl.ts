/**
 * A tiny DDL replayer: fold a list of SQL statements into the table/column
 * shape they produce.
 *
 * This exists so `schema-parity.test.ts` can answer the one question that
 * `docs/SCHEMA-CHANGES.md` currently answers only in prose — *does the
 * migration ledger actually produce the schema `user-schema.ts` describes?* —
 * without a running SQLite, and therefore without
 * `@cloudflare/vitest-pool-workers` (banned; see `docs/SYNC.md`).
 *
 * It is deliberately not a SQL parser. The only input it ever sees is
 * `BOOTSTRAP_STATEMENTS` and `USER_DB_MIGRATIONS` — statements we write
 * ourselves, in a house style, in this repo. It handles that dialect and
 * throws on anything it does not recognise as schema-affecting, which is the
 * right failure: a statement this cannot read is a statement the parity test
 * would otherwise silently ignore.
 */

/** Keywords that begin a table CONSTRAINT clause rather than a column. */
const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "foreign",
  "unique",
  "check",
  "constraint",
]);

/**
 * Splits a `CREATE TABLE` body on commas that are neither inside parentheses
 * nor inside a string literal.
 *
 * Both exclusions are load-bearing, and the second was found the hard way:
 * `PRIMARY KEY (entity_id, field)` must stay one part, and so must
 * `workdays text DEFAULT '[1,2,3,4,5]' NOT NULL` — which, split naively,
 * yields the phantom columns `2`, `3`, `4`, and `5]'`. That produces a
 * *wrong* schema rather than an error, which is the worst failure this file
 * can have: the parity test would then be checking a fiction.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (inString) {
      current += char;
      // SQLite escapes a quote by doubling it: '[1,2]''s'. Consume both so
      // the pair is not read as close-then-reopen.
      if (char === "'") {
        if (body[i + 1] === "'") {
          current += body[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** Strips the quoting styles SQLite accepts around an identifier. */
function unquote(identifier: string): string {
  return identifier.replace(/^["`[]|["`\]]$/g, "");
}

const CREATE_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s*\(([\s\S]*)\)\s*$/i;
const ALTER_ADD = /^ALTER\s+TABLE\s+(\S+)\s+ADD\s+(?:COLUMN\s+)?(\S+)/i;
const ALTER_DROP = /^ALTER\s+TABLE\s+(\S+)\s+DROP\s+(?:COLUMN\s+)?(\S+)/i;
const DROP_TABLE = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\S+)/i;
/** Schema-irrelevant but legal in a migration — data seeding, indexes. */
const IGNORED = /^(INSERT|UPDATE|DELETE|CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|PRAGMA)\b/i;

export class DdlReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DdlReplayError";
  }
}

/**
 * Replays `statements` in order and returns `table -> sorted column names`.
 *
 * `CREATE TABLE IF NOT EXISTS` on a table that already exists is a no-op,
 * matching SQLite — which is exactly the behaviour that makes migration 1
 * safely re-runnable against an account that predates the ledger, and exactly
 * the behaviour that makes it unable to deliver a new *column*. Modelling it
 * faithfully is the point: this replayer has to agree with the real thing
 * about the failure mode the whole ledger exists to prevent.
 */
export function replayDdl(statements: readonly string[]): Record<string, string[]> {
  const tables = new Map<string, Set<string>>();

  for (const raw of statements) {
    const statement = raw.trim().replace(/;$/, "").trim();
    if (statement === "" || IGNORED.test(statement)) continue;

    const created = CREATE_TABLE.exec(statement);
    if (created) {
      const table = unquote(created[1]);
      // `IF NOT EXISTS` semantics — see the doc comment.
      if (tables.has(table)) continue;
      const columns = new Set<string>();
      for (const part of splitTopLevel(created[2])) {
        const first = part.split(/\s+/)[0];
        if (CONSTRAINT_KEYWORDS.has(first.toLowerCase())) continue;
        columns.add(unquote(first));
      }
      tables.set(table, columns);
      continue;
    }

    const added = ALTER_ADD.exec(statement);
    if (added) {
      const table = unquote(added[1]);
      const columns = tables.get(table);
      if (!columns) {
        throw new DdlReplayError(`ALTER TABLE ${table} ADD COLUMN before the table is created`);
      }
      columns.add(unquote(added[2]));
      continue;
    }

    const dropped = ALTER_DROP.exec(statement);
    if (dropped) {
      const table = unquote(dropped[1]);
      const columns = tables.get(table);
      if (!columns) {
        throw new DdlReplayError(`ALTER TABLE ${table} DROP COLUMN before the table is created`);
      }
      columns.delete(unquote(dropped[2]));
      continue;
    }

    const droppedTable = DROP_TABLE.exec(statement);
    if (droppedTable) {
      tables.delete(unquote(droppedTable[1]));
      continue;
    }

    // Not recognised. Throwing rather than skipping is deliberate: a silently
    // ignored schema statement is a hole in the parity check, and a hole in
    // the parity check is how a missing migration reaches production.
    throw new DdlReplayError(
      `unrecognised schema statement (teach ddl.ts about it, or it will not be checked): ${statement.slice(0, 80)}`,
    );
  }

  return Object.fromEntries(
    [...tables.entries()]
      .map(([table, columns]) => [table, [...columns].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
