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
  | "todoEvents"
  | "reminderPresets"
  | "attachments"
  | "settings";

const TABLE_BY_KIND: Record<EntityKind, RecordTable> = {
  todo: "todos",
  list: "lists",
  label: "labels",
  project: "projects",
  tab: "tabs",
  dayNote: "dayNotes",
  place: "places",
  todoEvent: "todoEvents",
  reminderPreset: "reminderPresets",
  attachment: "attachments",
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

/**
 * Forward compatibility: a kind this build has never heard of must be
 * SKIPPED, never applied.
 *
 * This is a postmortem, not a hypothetical. A desktop `.app` built on
 * 2026-08-22 predated the `attachment` kind (EI-242, 2026-08-24). The server
 * is deployed continuously and has no idea what version a client is on, so
 * its pull pages started carrying `attachment` rows. `TABLE_BY_KIND` on that
 * old bundle had no `attachment` entry, so `db[undefined].get(...)` threw
 * inside the `rw` transaction — which aborts the whole page, rejects
 * `applyPulledChanges`, and throws out of `runSyncCycle`'s pull loop BEFORE
 * `store.setCursor` runs. The cursor therefore never advanced past the page
 * containing that one row, on every retry, from any starting cursor. Sync was
 * permanently and silently dead, and re-installing or clearing local storage
 * could not fix it: a re-pull from 0 walks straight back into the same record.
 *
 * `SYNC_PROTOCOL_VERSION` did not help — it was never bumped for a new kind,
 * and bumping it would only have swapped a silent wedge for a hard refusal.
 * Skipping is the right default: the rest of the page still applies, the
 * cursor still advances, and the device stays useful on a slightly narrower
 * view of the data until it is upgraded.
 *
 * The cost, and it is real: the cursor is a single scalar per page, not a
 * per-row watermark, so a skipped row is not retried automatically even after
 * the client learns the kind. Recovering it needs a full re-pull (clear
 * `faite:sync-cursor:*`) — the same trade `plan.skipped` already documents
 * below.
 */
function isKnownKind(kind: string): kind is EntityKind {
  return Object.hasOwn(TABLE_BY_KIND, kind);
}

export async function applyPulledChanges(changes: WireChange[]): Promise<ApplyPlan> {
  const db = getDb();
  const ownerId = getCurrentOwnerId();

  // Filtered OUTSIDE the transaction, so an unknown kind can never reach a
  // `db[undefined]` lookup and abort the page — see `isKnownKind`.
  const applicable = changes.filter((change) => isKnownKind(change.kind));
  if (applicable.length !== changes.length) {
    const unknown = [...new Set(changes.filter((c) => !isKnownKind(c.kind)).map((c) => c.kind))];
    console.warn(
      `[faite] skipping ${changes.length - applicable.length} pulled change(s) of unknown kind(s) ` +
        `[${unknown.join(", ")}] — this build is older than the server. Update the app, then ` +
        `re-pull from scratch to pick them up.`,
    );
  }

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
      db.todoEvents,
      db.reminderPresets,
      db.attachments,
      db.settings,
      db.outbox,
    ],
    async () => {
      // Read-only: this is the local field clock every pulled change merges
      // against, but nothing here is ever added to, updated, or deleted.
      const pending = await db.outbox.toArray();

      const locals = new Map<string, Record<string, unknown> | undefined>();
      for (const change of applicable) {
        if (locals.has(change.entityId)) continue;
        const table = TABLE_BY_KIND[change.kind];
        const key = dexieKeyFor(change.kind, change.entityId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = await (db[table] as any).get(key);
        locals.set(change.entityId, row);
      }

      const plan = planApply(applicable, pending, locals, { ownerId, now: now() });

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
