import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { PullResponse, PushRequest, PushResponse } from "@/lib/sync/wire";
import { SETTINGS_ENTITY_ID, SYNC_KINDS, SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import { BOOTSTRAP_STATEMENTS } from "./db/bootstrap";
import * as schema from "./db/user-schema";
import type { FieldClockMap } from "./sync/apply-patch";
import { COLUMNS_BY_KIND, rowFromSqlRow, TABLE_NAME_BY_KIND, toColumnValue } from "./sync/columns";
import { type KindPage, mergePages } from "./sync/pull";
import { groupByEntity, resolveEntityPush, validateEntries } from "./sync/push";
import { chunkForInClause } from "./sync/sql-limits";
import { buildInsertColumns } from "./sync/upsert";

/**
 * Per-user Durable Object. Authoritative store for one user's todos/lists/labels
 * and the coordinator for sync (plan P3).
 *
 * Chosen over a single shared D1 because it gives us, for free:
 *   - a monotonic per-user changelog (drives `since=version` pulls)
 *   - single-writer serialization (no cross-user write contention)
 *   - WebSocket hibernation for live push at P4
 *
 * D1 holds only auth/global tables, which need a conventional SQL adapter.
 *
 * EI-46: `push`/`pull` are RPC methods, not `fetch()` routes — the worker
 * already owns HTTP (session, Zod, CORS; see `src/server/sync/routes.ts`),
 * and `env.USER_DO` is typed `DurableObjectNamespace<UserDurableObject>`, so
 * the wire types are `tsc`-enforced at both ends. `fetch()` stays a stub so
 * P4's WebSocket upgrade — which can only arrive there — gets a clean file to
 * extend, not a router.
 */
/**
 * RFC 6455 §7.4.2 application close code — "policy violation". Used when the
 * account behind a socket is deleted out from under it. Moves to
 * `ws-protocol.ts` in P4 phase 1, once the client needs to read it too.
 */
const WS_CLOSE_ACCOUNT_DELETED = 1008;

export class UserDurableObject extends DurableObject {
  db: DrizzleSqliteDODatabase<typeof schema>;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });

    // Runs before any other request to this DO instance is handled — see
    // `blockConcurrencyWhile`'s contract. `IF NOT EXISTS`/`OR IGNORE` make
    // re-running it on every cold start harmless (see bootstrap.ts).
    ctx.blockConcurrencyWhile(async () => {
      for (const statement of BOOTSTRAP_STATEMENTS) {
        ctx.storage.sql.exec(statement);
      }
    });
  }

  async fetch(): Promise<Response> {
    return Response.json(
      { ok: true, phase: "P3", note: "Storage schema only; sync protocol not wired yet" },
      { status: 200 },
    );
  }

  /**
   * Permanently erases this DO's storage. Called from `auth.ts`'s
   * `user.deleteUser.afterDelete` hook — a DO has no foreign key to D1, so
   * deleting a user there leaves this storage orphaned (paid for,
   * unreachable) unless something explicitly wipes it, and a
   * re-registration on the same email would otherwise inherit the previous
   * account's board (`idFromName(userId)` addresses the same DO again). See
   * docs/SYNC.md's "Known traps".
   *
   * Three steps, in this order, and the order matters:
   *
   * 1. **Close every live socket first.** `deleteAll()` drops the tables but
   *    does nothing to connections. A socket accepted before the wipe
   *    survives it, and its next message lands on `no such table: todos`.
   *    Before P4 this was latent — the D1 user row is gone, so nothing could
   *    authenticate back in before the instance was evicted. A live
   *    WebSocket is precisely the thing that removes that protection.
   * 2. `deleteAll()` — on a SQLite-backed DO this drops SQL tables *and*
   *    key-value data.
   * 3. **Re-run the bootstrap.** The constructor's `blockConcurrencyWhile`
   *    already ran for this instance and will not run again until a cold
   *    start, so without this the object is left alive with no schema at
   *    all. Leaving it empty-and-valid instead of broken means a
   *    re-registration on the same user id gets a clean board rather than a
   *    DO that throws on first contact.
   */
  async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(WS_CLOSE_ACCOUNT_DELETED, "account-deleted");
      } catch {
        // Already closing or closed. `getWebSockets()` omits disconnected
        // sockets, but there is no lock between that call and this one.
      }
    }
    await this.ctx.storage.deleteAll();
    for (const statement of BOOTSTRAP_STATEMENTS) {
      this.ctx.storage.sql.exec(statement);
    }
  }

  /**
   * Applies a batch of outbox entries. `userId` comes from the worker's
   * verified session — never from the request body — and is the only source
   * of `owner_id` on an insert (see `columns.ts`'s `SERVER_ONLY_FIELDS`).
   *
   * The whole batch runs inside one `transactionSync` so a crash mid-push
   * can't leave `field_clocks`, a row, and `sync_meta`'s counter mutually
   * inconsistent. `transactionSync`'s closure must be synchronous — every
   * helper below is, since `ctx.storage.sql.exec` itself is synchronous.
   */
  async push(userId: string, request: PushRequest): Promise<PushResponse> {
    const { accepted, rejected } = validateEntries(request.entries);
    const groups = groupByEntity(accepted);
    const conflicts: PushResponse["conflicts"] = [];
    let highestVersion = 0;
    const nowIso = new Date().toISOString();

    this.ctx.storage.transactionSync(() => {
      for (const group of groups) {
        const existingClocks = this.readFieldClocks(group.entityId);
        const resolution = resolveEntityPush(existingClocks, group);

        if (resolution.conflicts.length > 0) {
          conflicts.push({ entityId: group.entityId, fields: resolution.conflicts });
        }
        // Every field lost (a duplicate re-push, most commonly) — nothing to
        // write, so allocate no version. Otherwise a lost-response retry
        // would churn the counter and force every device to re-pull nothing.
        if (Object.keys(resolution.apply).length === 0) continue;

        const version = this.allocateVersion();
        const tableName = TABLE_NAME_BY_KIND[group.kind];
        if (this.rowExists(group.kind, tableName, group.entityId, userId)) {
          this.updateRow(group.kind, tableName, group.entityId, resolution.apply, version, userId);
        } else {
          const row = buildInsertColumns(group.kind, group.entityId, userId, resolution.apply, nowIso, version);
          this.insertRow(group.kind, tableName, row);
        }
        this.writeFieldClocks(group.entityId, group.kind, resolution.clockUpdates);
        highestVersion = Math.max(highestVersion, version);
      }
    });

    return {
      acked: accepted.map((entry) => entry.id),
      rejected,
      highestVersion,
      conflicts,
    };
  }

  /** `since=version` pull across every sync kind — see `pull.ts`'s `mergePages`. */
  async pull(cursor: number, limit: number): Promise<PullResponse> {
    const pages: KindPage[] = SYNC_KINDS.map((kind) => {
      const tableName = TABLE_NAME_BY_KIND[kind];
      const sqlRows = this.ctx.storage.sql
        .exec(`SELECT * FROM ${tableName} WHERE version > ? ORDER BY version LIMIT ?`, cursor, limit)
        .toArray();
      const rows = sqlRows.map((sqlRow) => {
        const row = rowFromSqlRow(kind, sqlRow) as Record<string, unknown> & { id?: string; version: number };
        // `settings` rows carry no `id` column — stand in with the same wire
        // sentinel `push()` uses, so field_clocks lookups (keyed the same
        // way on write) actually match on read.
        if (kind === "settings") row.id = SETTINGS_ENTITY_ID;
        return row as Record<string, unknown> & { id: string; version: number };
      });
      return { kind, rows, exhausted: sqlRows.length === limit };
    });

    const entityIds = pages.flatMap((page) => page.rows.map((row) => row.id));
    const fieldClocksByEntityId = this.readFieldClocksBulk(entityIds);
    const merged = mergePages(pages, cursor, limit, fieldClocksByEntityId);

    return { protocol: SYNC_PROTOCOL_VERSION, ...merged };
  }

  private allocateVersion(): number {
    const row = this.ctx.storage.sql
      .exec<{ next_version: number }>("SELECT next_version FROM sync_meta WHERE id = 1")
      .one();
    this.ctx.storage.sql.exec("UPDATE sync_meta SET next_version = ? WHERE id = 1", row.next_version + 1);
    return row.next_version;
  }

  /**
   * `settings` has no `id` column — it's a singleton keyed by `owner_id`,
   * so its existence/update lookups key off the authenticated session user
   * instead of `entityId` (which is only ever the shared wire sentinel for
   * this kind — see `push.ts`).
   */
  private rowExists(kind: (typeof SYNC_KINDS)[number], tableName: string, entityId: string, userId: string): boolean {
    if (kind === "settings") {
      return this.ctx.storage.sql.exec(`SELECT 1 FROM ${tableName} WHERE owner_id = ?`, userId).toArray().length > 0;
    }
    return (
      this.ctx.storage.sql.exec(`SELECT 1 FROM ${tableName} WHERE id = ?`, entityId).toArray().length > 0
    );
  }

  private insertRow(kind: (typeof SYNC_KINDS)[number], tableName: string, row: Record<string, unknown>): void {
    const columns = COLUMNS_BY_KIND[kind];
    const fields = Object.keys(row);
    const sqlNames = fields.map((field) => columns[field].sqlName);
    const placeholders = fields.map(() => "?").join(", ");
    const values = fields.map((field) => toColumnValue(kind, field, row[field]));
    // `tableName`/`sqlNames` come only from our own whitelisted metadata
    // (COLUMNS_BY_KIND/TABLE_NAME_BY_KIND), never from client input — every
    // actual value is a bound parameter.
    this.ctx.storage.sql.exec(
      `INSERT INTO ${tableName} (${sqlNames.join(", ")}) VALUES (${placeholders})`,
      ...values,
    );
  }

  private updateRow(
    kind: (typeof SYNC_KINDS)[number],
    tableName: string,
    entityId: string,
    apply: Record<string, unknown>,
    version: number,
    userId: string,
  ): void {
    const columns = COLUMNS_BY_KIND[kind];
    const fields = Object.keys(apply);
    const setClauses = [...fields.map((field) => `${columns[field].sqlName} = ?`), "version = ?"];
    const values = [...fields.map((field) => toColumnValue(kind, field, apply[field])), version];
    const whereColumn = kind === "settings" ? "owner_id" : "id";
    const whereValue = kind === "settings" ? userId : entityId;
    this.ctx.storage.sql.exec(
      `UPDATE ${tableName} SET ${setClauses.join(", ")} WHERE ${whereColumn} = ?`,
      ...values,
      whereValue,
    );
  }

  private readFieldClocks(entityId: string): FieldClockMap {
    const rows = this.ctx.storage.sql
      .exec<{ field: string; hlc: string }>("SELECT field, hlc FROM field_clocks WHERE entity_id = ?", entityId)
      .toArray();
    const clocks: FieldClockMap = {};
    for (const row of rows) clocks[row.field] = row.hlc;
    return clocks;
  }

  /**
   * Chunked at `IN_CLAUSE_CHUNK`, not because the id list is large in
   * practice, but because it is UNBOUNDED BY CONSTRUCTION: `pull()` unions up
   * to `limit` rows from each of the six `SYNC_KINDS`, so a `DEFAULT_PULL_
   * LIMIT` pull can reach 600 ids against SQLite's documented 100-bound-
   * parameter ceiling. See `sql-limits.ts` for the full reasoning; it fires
   * first on a long-offline catch-up pull, which is exactly the path P4's
   * reconnect story depends on.
   */
  private readFieldClocksBulk(entityIds: string[]): Record<string, FieldClockMap> {
    const result: Record<string, FieldClockMap> = {};
    for (const batch of chunkForInClause(entityIds)) {
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this.ctx.storage.sql
        .exec<{ entity_id: string; field: string; hlc: string }>(
          `SELECT entity_id, field, hlc FROM field_clocks WHERE entity_id IN (${placeholders})`,
          ...batch,
        )
        .toArray();
      for (const row of rows) {
        (result[row.entity_id] ??= {})[row.field] = row.hlc;
      }
    }
    return result;
  }

  private writeFieldClocks(
    entityId: string,
    kind: (typeof SYNC_KINDS)[number],
    clockUpdates: FieldClockMap,
  ): void {
    for (const [field, hlc] of Object.entries(clockUpdates)) {
      this.ctx.storage.sql.exec(
        `INSERT INTO field_clocks (entity_id, kind, field, hlc) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity_id, field) DO UPDATE SET hlc = excluded.hlc, kind = excluded.kind`,
        entityId,
        kind,
        field,
        hlc,
      );
    }
  }
}
