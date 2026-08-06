import { describe, expect, it } from "vitest";
import { DdlReplayError, replayDdl } from "./ddl";

describe("replayDdl", () => {
  it("reads columns out of a CREATE TABLE", () => {
    expect(replayDdl(["CREATE TABLE labels (id text PRIMARY KEY NOT NULL, name text NOT NULL)"])).toEqual({
      labels: ["id", "name"],
    });
  });

  it("skips table-level constraint clauses without eating their columns", () => {
    expect(
      replayDdl([
        `CREATE TABLE field_clocks (
          entity_id text NOT NULL,
          field text NOT NULL,
          PRIMARY KEY (entity_id, field)
        )`,
      ]),
    ).toEqual({ field_clocks: ["entity_id", "field"] });
  });

  /**
   * REGRESSION. `settings.workdays` is declared
   * `text DEFAULT '[1,2,3,4,5]' NOT NULL`, and a splitter that tracks only
   * parentheses reads those commas as column separators — inventing the
   * columns `2`, `3`, `4` and `5]'`.
   *
   * The damage is not a crash. It is a parity test that passes or fails
   * against a schema that never existed, which is worse than having no parity
   * test at all. Caught by the real bootstrap DDL on the very first run.
   */
  it("REGRESSION: commas inside a string default are not column separators", () => {
    expect(
      replayDdl([`CREATE TABLE settings (owner_id text PRIMARY KEY NOT NULL, workdays text DEFAULT '[1,2,3,4,5]' NOT NULL)`]),
    ).toEqual({ settings: ["owner_id", "workdays"] });
  });

  it("handles SQLite's doubled-quote escape inside a default", () => {
    expect(
      replayDdl([`CREATE TABLE t (a text DEFAULT 'it''s, fine' NOT NULL, b text)`]),
    ).toEqual({ t: ["a", "b"] });
  });

  it("applies ALTER TABLE ADD COLUMN, with or without the COLUMN keyword", () => {
    expect(
      replayDdl([
        "CREATE TABLE todos (id text PRIMARY KEY NOT NULL)",
        "ALTER TABLE todos ADD COLUMN energy text",
        "ALTER TABLE todos ADD mood text",
      ]),
    ).toEqual({ todos: ["energy", "id", "mood"] });
  });

  it("applies ALTER TABLE DROP COLUMN", () => {
    expect(
      replayDdl([
        "CREATE TABLE todos (id text PRIMARY KEY NOT NULL, energy text)",
        "ALTER TABLE todos DROP COLUMN energy",
      ]),
    ).toEqual({ todos: ["id"] });
  });

  /**
   * The behaviour the whole migration ledger exists because of: a second
   * `CREATE TABLE IF NOT EXISTS` cannot deliver a new column. Modelling it
   * faithfully is what lets the parity test detect a missing migration —
   * a replayer that "helpfully" merged the two would report the schema the
   * author intended rather than the one SQLite would actually produce.
   */
  it("treats a repeat CREATE TABLE IF NOT EXISTS as the no-op SQLite makes it", () => {
    expect(
      replayDdl([
        "CREATE TABLE IF NOT EXISTS todos (id text PRIMARY KEY NOT NULL)",
        "CREATE TABLE IF NOT EXISTS todos (id text PRIMARY KEY NOT NULL, energy text)",
      ]),
    ).toEqual({ todos: ["id"] });
  });

  it("ignores data and index statements", () => {
    expect(
      replayDdl([
        "CREATE TABLE sync_meta (id integer PRIMARY KEY NOT NULL, next_version integer NOT NULL)",
        "INSERT OR IGNORE INTO sync_meta (id, next_version) VALUES (1, 1)",
        "CREATE INDEX idx_meta ON sync_meta (next_version)",
      ]),
    ).toEqual({ sync_meta: ["id", "next_version"] });
  });

  it("throws on a statement it cannot read, rather than silently not checking it", () => {
    expect(() => replayDdl(["CREATE TRIGGER whatever BEGIN SELECT 1; END"])).toThrow(DdlReplayError);
  });

  it("throws when a migration alters a table that does not exist yet", () => {
    expect(() => replayDdl(["ALTER TABLE ghosts ADD COLUMN spooky text"])).toThrow(DdlReplayError);
  });
});
