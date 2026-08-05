import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { BOOTSTRAP_STATEMENTS } from "./db/bootstrap";
import * as schema from "./db/user-schema";

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
 * P3 status: storage schema only (`src/server/db/user-schema.ts`), bootstrapped
 * here on construction. No RPC, no fetch routes, no client calls yet — `fetch`
 * is still the P0 stub. The sync protocol itself (outbox drain, `since=version`
 * pull, WebSocket push) is later P3/P4 work; see `src/server/sync/apply-patch.ts`
 * for the pure per-field merge logic it will call into.
 */
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
}
