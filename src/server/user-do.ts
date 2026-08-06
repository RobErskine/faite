import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { PullResponse, PushRequest, PushResponse } from "@/lib/sync/wire";
import { SETTINGS_ENTITY_ID, SYNC_KINDS, SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import type { ServerMessage } from "@/lib/sync/ws-protocol";
import {
  decodeClient,
  encode,
  MAX_SOCKET_AGE_MS,
  WS_CLOSE_ACCOUNT_DELETED,
  WS_CLOSE_REAUTH_REQUIRED,
} from "@/lib/sync/ws-protocol";
import { runUserDbMigrations } from "./db/migrations";
import * as schema from "./db/user-schema";
import type { FieldClockMap } from "./sync/apply-patch";
import { COLUMNS_BY_KIND, rowFromSqlRow, TABLE_NAME_BY_KIND, toColumnValue } from "./sync/columns";
import { type KindPage, mergePages } from "./sync/pull";
import { groupByEntity, resolveEntityPush, validateEntries } from "./sync/push";
import { chunkForInClause } from "./sync/sql-limits";
import { buildInsertColumns } from "./sync/upsert";
import { clampPullArgs, parsePushRequest } from "./sync/validate";
import { isWebSocketUpgrade, USER_ID_HEADER } from "./sync/ws-server";

/**
 * Per-connection state that survives hibernation. In-memory fields do not —
 * the constructor re-runs when the object wakes — so anything a socket needs
 * to be served correctly after a wake-up has to live here.
 *
 * Structured-cloneable, 16,384-byte cap. Both fields are tiny; do not grow
 * this into a cache.
 */
interface SocketAttachment {
  /** Verified by the worker at handshake time, never by this object. */
  userId: string;
  /** `Date.now()` at handshake. Drives `MAX_SOCKET_AGE_MS`. */
  connectedAt: number;
}

/**
 * What `schemaInfo()` reports. Purely diagnostic — nothing in the sync path
 * reads this, which is why it lives here rather than in `wire.ts` (that file
 * is the push/pull contract and should stay that).
 */
export interface SchemaInfo {
  /** The ledger, in order. The last id is the schema version this DO is on. */
  migrations: Array<{ id: number; name: string; appliedAt: string }>;
  /** Physical table name -> its actual columns and row count. */
  tables: Record<string, { columns: string[]; rows: number }>;
  /** `sync_meta`'s allocator. A client's cursor above this means a reset happened. */
  nextVersion: number;
}

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
export class UserDurableObject extends DurableObject {
  db: DrizzleSqliteDODatabase<typeof schema>;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });

    // Runs before any other request to this DO instance is handled — see
    // `blockConcurrencyWhile`'s contract. After the first cold start this is
    // one CREATE TABLE IF NOT EXISTS plus one SELECT.
    //
    // NOT a plain bootstrap loop any more: `CREATE TABLE IF NOT EXISTS` can
    // only ever deliver NEW TABLES, so an account that already has data would
    // never receive a new COLUMN, and the first push carrying that field
    // would throw `no such column` inside `push()` forever. See
    // `migrations.ts` and `docs/SCHEMA-CHANGES.md`.
    ctx.blockConcurrencyWhile(async () => {
      runUserDbMigrations(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn));
    });
  }

  /**
   * The WebSocket upgrade seam (P4/EI-49). This is the only thing `fetch()`
   * is for — push/pull remain RPC, because the worker already owns HTTP.
   *
   * `this.ctx.acceptWebSocket(server)`, NOT `server.accept()`: the former
   * makes the socket hibernation-eligible, so an idle connection costs
   * nothing and does not pin this object in memory. The latter would hold
   * the DO resident for as long as any tab is open anywhere.
   *
   * Ping/pong is handled by the runtime and does not wake us, so there is no
   * keepalive protocol here and there should never be one.
   */
  async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request.headers.get("Upgrade"))) {
      return Response.json(
        { ok: true, note: "This Durable Object speaks RPC (push/pull) and WebSocket upgrades only" },
        { status: 200 },
      );
    }

    // Set by the worker on every upgrade it forwards (`ws-server.ts`), which
    // is the only way a request can reach this object at all. Absent means a
    // bug in our own routing, not a hostile client — fail loudly.
    const userId = request.headers.get(USER_ID_HEADER);
    if (!userId) {
      console.error("[faite] upgrade reached the DO with no user id header");
      return new Response("missing user id", { status: 500 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // In-memory fields do not survive hibernation; the attachment does
    // (structured-cloneable, 16 KiB cap). This is how the object remembers
    // whose socket this is after waking up, and when it was authenticated.
    server.serializeAttachment({ userId, connectedAt: Date.now() } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Dispatches one framed request from a socket.
   *
   * **This function is total by design — it must never throw.** An uncaught
   * exception out of a Durable Object handler can leave the stub in a broken
   * state, and a broken stub takes down every OTHER socket attached to this
   * object too. One tab sending a truncated frame must not be able to
   * disconnect a different device, so every failure path here ends in either
   * a correlated `error` reply or a silent drop.
   *
   * Requests are routed through the SAME validators the HTTP route uses
   * (`validate.ts`). Calling `this.push`/`this.pull` directly is safe — they
   * are ordinary methods and RPC is merely an additional exposure — but
   * their guards live in `routes.ts`, not in them, so skipping the
   * validators would hand a socket an unclamped `LIMIT` and an uncapped
   * batch size.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let requestId: string | null = null;
    try {
      const attachment = this.readAttachment(ws);
      if (!attachment) {
        // Should be unreachable: `fetch()` attaches before returning the 101.
        // A socket we can't identify is one we must not serve.
        ws.close(WS_CLOSE_REAUTH_REQUIRED, "no-attachment");
        return;
      }

      // The HTTP path re-authenticates on every request; this socket was
      // authenticated once, at the handshake. Bound how long that stays
      // good — the reconnect goes back through the worker, which re-checks
      // the session cookie. See `MAX_SOCKET_AGE_MS`.
      if (Date.now() - attachment.connectedAt > MAX_SOCKET_AGE_MS) {
        ws.close(WS_CLOSE_REAUTH_REQUIRED, "reauth");
        return;
      }

      const decoded = decodeClient(message);
      // Undecodable: drop silently. There is no id to correlate an error to,
      // and replying to noise only invites more of it. The sender's own
      // request timeout is what surfaces this.
      if (!decoded) return;
      requestId = decoded.id;

      if (decoded.type === "push") {
        const parsed = parsePushRequest(decoded.payload);
        if (!parsed) {
          this.reply(ws, { id: requestId, type: "error", payload: { message: "invalid-request" } });
          return;
        }
        // `ws` as origin: this device already has the write it just sent.
        const result = await this.push(attachment.userId, parsed, ws);
        this.reply(ws, { id: requestId, type: "push-response", payload: result });
        return;
      }

      const args = clampPullArgs(decoded.payload.cursor, decoded.payload.limit);
      if (!args) {
        this.reply(ws, { id: requestId, type: "error", payload: { message: "invalid-cursor" } });
        return;
      }
      const result = await this.pull(args.cursor, args.limit);
      this.reply(ws, { id: requestId, type: "pull-response", payload: result });
    } catch (error) {
      console.error("[faite] webSocketMessage failed", error);
      if (requestId) {
        this.reply(ws, { id: requestId, type: "error", payload: { message: "internal-error" } });
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Nothing to clean up: the attachment dies with the socket and
    // `getWebSockets()` stops returning it automatically. `close()` is not
    // called back — `web_socket_auto_reply_to_close` handles the close frame
    // at our compatibility date (>= 2026-04-07; wrangler.jsonc is
    // 2026-08-01).
    console.log(`[faite] socket closed code=${code} clean=${wasClean} reason=${reason}`);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("[faite] socket error", error);
  }

  /**
   * `send()` throws on a socket that closed since we last looked. Never let
   * that escape: on the reply path it would turn one dead peer into a failed
   * push for the peer that is still alive.
   */
  private reply(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(encode(message));
    } catch (error) {
      console.warn("[faite] failed to reply on a socket", error);
    }
  }

  private readAttachment(ws: WebSocket): SocketAttachment | null {
    const raw: unknown = ws.deserializeAttachment();
    if (typeof raw !== "object" || raw === null) return null;
    const { userId, connectedAt } = raw as Record<string, unknown>;
    if (typeof userId !== "string" || userId.length === 0) return null;
    if (typeof connectedAt !== "number" || !Number.isFinite(connectedAt)) return null;
    return { userId, connectedAt };
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
   * 3. **Re-run the MIGRATION LEDGER — not `BOOTSTRAP_STATEMENTS`.** The
   *    constructor's `blockConcurrencyWhile` already ran for this instance
   *    and will not run again until a cold start, so without this the object
   *    is left alive with no schema at all.
   *
   *    It has to be the full ledger, and this is not a stylistic preference.
   *    `deleteAll()` drops `schema_migrations` along with everything else, so
   *    replaying only the v1 bootstrap leaves the object on the v1 schema
   *    with no ledger — while `COLUMNS_BY_KIND` (derived from
   *    `user-schema.ts`) still names every column added since. The next push
   *    then throws `no such column` inside `push()`'s `transactionSync`, and
   *    keeps throwing until a cold start happens to heal it. That was latent
   *    while `wipe()` ran only on account deletion — nothing could
   *    authenticate back in afterwards — and stops being latent the moment a
   *    live account can reset itself (`/api/sync/reset`).
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
    runUserDbMigrations(this.ctx.storage.sql, (fn) => this.ctx.storage.transactionSync(fn));
  }

  /**
   * Read-only introspection of this object's own storage, for
   * `GET /api/sync/schema` (see `routes.ts`) and `npm run schema:info`.
   *
   * A Durable Object's SQLite has **no external query endpoint** — unlike D1,
   * which is reachable through the Cloudflare API. So after deploying a
   * migration there is otherwise no way to confirm it actually applied to a
   * real account short of shipping a change and watching `wrangler tail`.
   * That is the entire reason this exists.
   *
   * Columns come from `SELECT * … LIMIT 0` and the cursor's `columnNames`
   * rather than `PRAGMA table_info`, deliberately: `migrations.ts` already
   * avoids depending on which PRAGMAs Cloudflare's SQLite happens to permit,
   * and this does not need to be the place that finds out.
   */
  async schemaInfo(): Promise<SchemaInfo> {
    const migrations = this.ctx.storage.sql
      .exec<{ id: number; name: string; applied_at: string }>(
        "SELECT id, name, applied_at FROM schema_migrations ORDER BY id",
      )
      .toArray()
      .map((row) => ({ id: Number(row.id), name: row.name, appliedAt: row.applied_at }));

    // Read the table list from `sqlite_master` rather than from
    // `TABLE_NAME_BY_KIND`, so this reports what the storage ACTUALLY holds.
    // Deriving it from our own constants would make the output agree with the
    // code by construction and hide the exact discrepancy the caller is
    // looking for — a table a migration was supposed to create and didn't.
    //
    // `sqlite_%` is SQLite's own bookkeeping, `_cf_%` is Cloudflare's, and
    // `__miniflare_%` is local-dev-only (it shows up under `wrangler dev` and
    // not in production — confirmed live, so filtering it here is what makes
    // local and production output comparable at a glance).
    const tableNames = this.ctx.storage.sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
           AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
           AND name NOT LIKE '\\_\\_miniflare\\_%' ESCAPE '\\'
         ORDER BY name`,
      )
      .toArray()
      .map((row) => row.name);

    const tables: SchemaInfo["tables"] = {};
    for (const tableName of tableNames) {
      const cursor = this.ctx.storage.sql.exec(`SELECT * FROM "${tableName}" LIMIT 0`);
      // `columnNames` is only populated once the cursor has been consumed;
      // on a LIMIT 0 that is free.
      cursor.toArray();
      const count = this.ctx.storage.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${tableName}"`)
        .one();
      tables[tableName] = { columns: [...cursor.columnNames].sort(), rows: Number(count.n) };
    }

    const meta = this.ctx.storage.sql
      .exec<{ next_version: number }>("SELECT next_version FROM sync_meta WHERE id = 1")
      .one();

    return { migrations, tables, nextVersion: Number(meta.next_version) };
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
  async push(userId: string, request: PushRequest, originWs?: WebSocket): Promise<PushResponse> {
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

    // `highestVersion === 0` is precisely "nothing was written" — a
    // duplicate re-push whose every field lost the LWW comparison allocates
    // no version at all (see the `continue` above). Broadcasting on those
    // would wake every device on every retry to pull nothing.
    if (highestVersion > 0) this.broadcastChanged(highestVersion, originWs);

    return {
      acked: accepted.map((entry) => entry.id),
      rejected,
      highestVersion,
      conflicts,
    };
  }

  /**
   * Tells every other connected device that something changed. This is the
   * point of P4 — without it, a device waits up to a full poll interval.
   *
   * Ordering is safe by platform contract, not by luck: the runtime pauses
   * outgoing messages from a Durable Object until all preceding writes have
   * been confirmed flushed to disk. A `changed` frame therefore provably
   * cannot arrive before the write that caused it is durable, so a receiver
   * that pulls immediately cannot read stale state.
   *
   * `originWs` is the socket the push arrived on, when it arrived on one.
   * Skipping it avoids telling a device about its own write. An HTTP push
   * has no origin socket and so notifies everyone, which is required rather
   * than incidental: a device on the polling fallback must still be able to
   * wake a device on a socket.
   */
  private broadcastChanged(version: number, originWs?: WebSocket): void {
    const message = encode({ type: "changed", version });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === originWs) continue;
      try {
        ws.send(message);
      } catch (error) {
        // A socket can close between `getWebSockets()` and here, and `send`
        // throws on a closed socket. Unguarded, that would escape `push()`
        // AFTER the transaction committed: the pusher would see an error and
        // re-push forever while the dead socket lingered. Re-push is
        // idempotent so no data is lost, but the pushes would never ack.
        console.warn("[faite] broadcast to a socket failed", error);
      }
    }
  }

  /** `since=version` pull across every sync kind — see `pull.ts`'s `mergePages`. */
  async pull(cursor: number, limit: number): Promise<PullResponse> {
    // Every row's `version` is allocated from `sync_meta` and is therefore
    // strictly below `next_version`, so a legitimate cursor can never reach
    // it. `cursor >= next_version` is provably only possible when this
    // object's storage was wiped out from under a client that had already
    // synced — `wipe()` resets the counter to 1 while the client keeps its
    // old watermark.
    //
    // Left undetected, that client asks for "everything above 42" forever,
    // gets nothing, and concludes it is up to date. Silently. On every device
    // at once. Telling it to start over is a three-line fix for the worst
    // failure mode in this codebase; see `PullResponse.reset`.
    const nextVersion = this.ctx.storage.sql
      .exec<{ next_version: number }>("SELECT next_version FROM sync_meta WHERE id = 1")
      .one().next_version;
    if (cursor >= nextVersion) {
      console.warn(
        `[faite] pull cursor ${cursor} is above next_version ${nextVersion} — storage was reset; telling the client to re-pull from 0`,
      );
      return { protocol: SYNC_PROTOCOL_VERSION, changes: [], cursor: 0, hasMore: true, reset: true };
    }

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
