import { getTableColumns, getTableName } from "drizzle-orm";
import type { SyncKind } from "@/lib/sync/wire";
import { SERVER_ONLY_FIELDS, SETTINGS_SYNCED_FIELDS } from "@/lib/sync/wire";
import { labels, lists, projects, settings, tabs, todos } from "../db/user-schema";

/**
 * Whitelists and JS↔SQLite coercion for the sync tables, derived from the
 * drizzle schema rather than hand-maintained — a patch key that isn't a real
 * column (including `__proto__`/`constructor`) is dropped by construction,
 * not by a list someone has to remember to update.
 */

const TABLES = {
  todo: todos,
  list: lists,
  label: labels,
  project: projects,
  tab: tabs,
  settings,
} as const;

export const TABLE_NAME_BY_KIND: Record<SyncKind, string> = Object.fromEntries(
  Object.entries(TABLES).map(([kind, table]) => [kind, getTableName(table)]),
) as Record<SyncKind, string>;

type DataType = "string" | "number" | "boolean" | "json" | "date";

export interface ColumnMeta {
  /** The physical SQL column name (`ownerId` -> `"owner_id"`). */
  sqlName: string;
  dataType: DataType;
  notNull: boolean;
  hasDefault: boolean;
}

/**
 * Fields stored as a plain `text()` column holding a JSON-encoded string by
 * convention (see `labelIds`'s comment in `user-schema.ts`), not via
 * drizzle's `{mode: "json"}` — so `column.dataType` reads `"string"`, not
 * `"json"`, and can't be trusted alone to signal the coercion this needs.
 * Deliberately not switching the schema to `{mode: "json"}` instead: it
 * wouldn't change the DDL (`getSQLType()` returns `"text"` either way), but
 * `.default("[]")`'s interaction with the json mapper at DDL-generation time
 * is untested territory this sync path doesn't need to risk, since it
 * bypasses drizzle's query builder for the dynamic, whitelisted upsert
 * anyway (see `upsert.ts`).
 */
const JSON_ENCODED_FIELDS = new Set(["labelIds", "workdays"]);

function buildColumnsByKind(): Record<SyncKind, Record<string, ColumnMeta>> {
  const result = {} as Record<SyncKind, Record<string, ColumnMeta>>;
  for (const [kind, table] of Object.entries(TABLES) as Array<[SyncKind, (typeof TABLES)[SyncKind]]>) {
    const columns = getTableColumns(table);
    const meta: Record<string, ColumnMeta> = {};
    for (const [tsName, column] of Object.entries(columns)) {
      meta[tsName] = {
        sqlName: column.name,
        dataType: JSON_ENCODED_FIELDS.has(tsName) ? "json" : (column.dataType as DataType),
        notNull: column.notNull,
        hasDefault: column.hasDefault,
      };
    }
    result[kind] = meta;
  }
  return result;
}

/** TS field name -> column metadata, per sync kind. Built once at module load. */
export const COLUMNS_BY_KIND: Record<SyncKind, Record<string, ColumnMeta>> = buildColumnsByKind();

function buildSqlToTsByKind(): Record<SyncKind, Record<string, string>> {
  const result = {} as Record<SyncKind, Record<string, string>>;
  for (const [kind, columns] of Object.entries(COLUMNS_BY_KIND) as Array<
    [SyncKind, Record<string, ColumnMeta>]
  >) {
    const reverse: Record<string, string> = {};
    for (const [tsName, meta] of Object.entries(columns)) reverse[meta.sqlName] = tsName;
    result[kind] = reverse;
  }
  return result;
}

const SQL_TO_TS_BY_KIND: Record<SyncKind, Record<string, string>> = buildSqlToTsByKind();

/**
 * Drops any patch key that isn't a real, sync-eligible column: unknown keys
 * (including prototype-pollution attempts), and the server-owned fields in
 * `SERVER_ONLY_FIELDS` (`version`, `id`, `ownerId`) which are never
 * client-writable — `id` is identity (the caller already has `entityId`),
 * `ownerId` is set from the authenticated session at INSERT time only (see
 * `upsert.ts`), and `version` is the server's own allocator.
 *
 * For `settings`, also enforces `SETTINGS_SYNCED_FIELDS` — `activeTabId` is
 * a real column (so it'd otherwise pass the whitelist check above) but must
 * never sync, and enforcing that here rather than only in the client's
 * `drain.ts` means a stale client can't leak it through.
 */
export function sanitizePatch(
  kind: SyncKind,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const columns = COLUMNS_BY_KIND[kind];
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (SERVER_ONLY_FIELDS.has(key)) continue;
    if (!Object.hasOwn(columns, key)) continue;
    if (kind === "settings" && !SETTINGS_SYNCED_FIELDS.has(key)) continue;
    result[key] = patch[key];
  }
  return result;
}

/**
 * JS value -> SQLite bind value for one column. Keeps the boolean/JSON
 * coercion (`isBacklog`/`isDefault` <-> 0/1, `labelIds` <-> JSON text) in one
 * tested place rather than smeared across the merge and the SQL builder.
 */
export function toColumnValue(kind: SyncKind, field: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  const meta = COLUMNS_BY_KIND[kind][field];
  switch (meta?.dataType) {
    case "boolean":
      return value ? 1 : 0;
    case "json":
      return JSON.stringify(value);
    case "number":
      return value as number;
    default:
      return value as string;
  }
}

/** The inverse of `toColumnValue` — SQLite row value -> JS value for the wire. */
export function fromColumnValue(kind: SyncKind, field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const meta = COLUMNS_BY_KIND[kind][field];
  switch (meta?.dataType) {
    case "boolean":
      return value === 1 || value === true;
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    default:
      return value;
  }
}

/**
 * Converts one raw `SELECT *` row (keyed by SQL column names, SQLite-typed
 * values) into a JS-typed object keyed by TS field names — the shape
 * `changesFromRow` (`wire.ts`) expects. The inverse direction of
 * `buildInsertColumns`'s TS-keyed input.
 */
export function rowFromSqlRow(kind: SyncKind, sqlRow: Record<string, unknown>): Record<string, unknown> {
  const sqlToTs = SQL_TO_TS_BY_KIND[kind];
  const result: Record<string, unknown> = {};
  for (const [sqlName, value] of Object.entries(sqlRow)) {
    const tsName = sqlToTs[sqlName];
    if (!tsName) continue;
    result[tsName] = fromColumnValue(kind, tsName, value);
  }
  return result;
}
