import type { EntityKind } from "@/lib/schema";
import { type ApplyPlan, planApply } from "@/lib/sync/apply-plan";
import type { WireChange } from "@/lib/sync/wire";
import { getDb } from "./db";
import { now } from "./mutate";
import { getCurrentOwnerId, LOCAL_OWNER_ID } from "./owner";

/**
 * Writes a pulled page locally WITHOUT touching the outbox — the whole point
 * of this being a separate path from `mutate()`. Appending an outbox entry
 * here would echo every remote change straight back into the next push,
 * forever; `apply-remote.test.ts`'s anti-echo test guards exactly that.
 *
 * One `rw` transaction so `useLiveQuery` repaints once per pulled page rather
 * than once per row, and so a crash can't leave the page half-applied.
 */

type RecordTable =
  | "todos"
  | "lists"
  | "labels"
  | "projects"
  | "tabs"
  | "dayNotes"
  | "places"
  | "settings";

const TABLE_BY_KIND: Record<EntityKind, RecordTable> = {
  todo: "todos",
  list: "lists",
  label: "labels",
  project: "projects",
  tab: "tabs",
  dayNote: "dayNotes",
  place: "places",
  settings: "settings",
};

/**
 * Settings' Dexie primary key is permanently `LOCAL_OWNER_ID` (never
 * adopted into a real account, ARCHITECTURE §2.12) — the wire's `entityId`
 * for settings is just a shared sentinel (`SETTINGS_ENTITY_ID`, see
 * `wire.ts`), never a real Dexie key.
 */
function dexieKeyFor(kind: EntityKind, entityId: string): string {
  return kind === "settings" ? LOCAL_OWNER_ID : entityId;
}

export async function applyPulledChanges(changes: WireChange[]): Promise<ApplyPlan> {
  const db = getDb();
  const ownerId = getCurrentOwnerId();

  return db.transaction(
    "rw",
    [
      db.todos,
      db.lists,
      db.labels,
      db.projects,
      db.tabs,
      db.dayNotes,
      db.places,
      db.settings,
      db.outbox,
    ],
    async () => {
      // Read-only: this is the local field clock every pulled change merges
      // against, but nothing here is ever added to, updated, or deleted.
      const pending = await db.outbox.toArray();

      const locals = new Map<string, Record<string, unknown> | undefined>();
      for (const change of changes) {
        if (locals.has(change.entityId)) continue;
        const table = TABLE_BY_KIND[change.kind];
        const key = dexieKeyFor(change.kind, change.entityId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = await (db[table] as any).get(key);
        locals.set(change.entityId, row);
      }

      const plan = planApply(changes, pending, locals, { ownerId, now: now() });

      if (plan.skipped.length > 0) {
        // A skipped row's version is still below the cursor this cycle
        // advances to (the cursor is a single scalar per page, not a
        // per-row watermark), so this device will not automatically retry
        // it. Rare post-Phase-2 (see hydrate.ts's REQUIRED_FALLBACKS note),
        // but worth being loud about rather than silent — a genuinely
        // unhydratable row is a data anomaly worth investigating, not
        // something to paper over with an invented value.
        console.warn("[faite] skipped applying pulled changes for entities:", plan.skipped);
      }

      for (const write of plan.writes) {
        const table = TABLE_BY_KIND[write.kind];
        const key = dexieKeyFor(write.kind, write.entityId);
        if (write.op === "put") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db[table] as any).put(write.row);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db[table] as any).update(key, write.changes);
        }
      }

      return plan;
    },
  );
}
