import type { EntityKind } from "@/lib/schema";
import { type ApplyPlan, planApply } from "@/lib/sync/apply-plan";
import type { WireChange } from "@/lib/sync/wire";
import { getDb } from "./db";
import { now } from "./mutate";
import { getCurrentOwnerId } from "./owner";

/**
 * Writes a pulled page locally WITHOUT touching the outbox — the whole point
 * of this being a separate path from `mutate()`. Appending an outbox entry
 * here would echo every remote change straight back into the next push,
 * forever; `apply-remote.test.ts`'s anti-echo test guards exactly that.
 *
 * One `rw` transaction so `useLiveQuery` repaints once per pulled page rather
 * than once per row, and so a crash can't leave the page half-applied.
 */

type RecordTable = "todos" | "lists" | "labels" | "projects" | "tabs";

const TABLE_BY_KIND: Record<Exclude<EntityKind, "settings">, RecordTable> = {
  todo: "todos",
  list: "lists",
  label: "labels",
  project: "projects",
  tab: "tabs",
};

export async function applyPulledChanges(changes: WireChange[]): Promise<ApplyPlan> {
  const db = getDb();
  const ownerId = getCurrentOwnerId();

  return db.transaction(
    "rw",
    [db.todos, db.lists, db.labels, db.projects, db.tabs, db.outbox],
    async () => {
      // Read-only: this is the local field clock every pulled change merges
      // against, but nothing here is ever added to, updated, or deleted.
      const pending = await db.outbox.toArray();

      const locals = new Map<string, Record<string, unknown> | undefined>();
      for (const change of changes) {
        if (locals.has(change.entityId)) continue;
        const table = TABLE_BY_KIND[change.kind];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = await (db[table] as any).get(change.entityId);
        locals.set(change.entityId, row);
      }

      const plan = planApply(changes, pending, locals, { ownerId, now: now() });

      for (const write of plan.writes) {
        const table = TABLE_BY_KIND[write.kind];
        if (write.op === "put") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db[table] as any).put(write.row);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db[table] as any).update(write.entityId, write.changes);
        }
      }

      return plan;
    },
  );
}
