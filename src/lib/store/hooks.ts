"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import type {
  Attachment,
  CivilDate,
  DayNote,
  Label,
  List,
  Place,
  Project,
  ReminderPreset,
  Settings,
  Tab,
  Todo,
  TodoEvent,
} from "@/lib/schema";
import { byPosition } from "@/lib/ordering";
import { contextFromSettings, type PlacementContext } from "@/lib/scheduling";
import type { TodoTitleInfo } from "@/lib/global-timeline";
import { canUseDb, getDb } from "./db";
import {
  ensureDefaultTab,
  LOCAL_OWNER_ID,
  seedIfEmpty,
  seedReminderPresetsIfNeeded,
} from "./repositories";

/**
 * Reactive reads.
 *
 * useLiveQuery re-runs on any write to the underlying tables, so a mutation
 * updates the UI without an explicit refetch or cache invalidation. Combined
 * with local-only writes, this is what makes interactions feel instant: nothing
 * on the interaction path waits for a network round trip.
 */

/**
 * Seeds default lists on first run, repairs the store, and reports readiness.
 *
 * `ensureDefaultTab` runs last and on every boot, not just the first: it is
 * what puts pre-tabs databases onto a tab.
 *
 * No longer calls `repairDuplicateLists` — that function hard-deleted any
 * two live lists sharing a name (an ordinary, legal state: "Groceries" on a
 * Personal tab and "Groceries" on a Work tab), with no tombstone and no
 * outbox entry. See `repositories.ts`'s removal commit for the incident.
 */
export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canUseDb()) return;
    seedIfEmpty()
      .then(ensureDefaultTab)
      .then(async (assigned) => {
        if (assigned > 0) {
          console.info(`[faite] moved ${assigned} list(s) onto the default tab`);
        }
        await seedReminderPresetsIfNeeded();
        setReady(true);
      })
      .catch((error) => {
        console.error("[faite] failed to prepare local store", error);
        setReady(true);
      });
  }, []);

  return ready;
}

const alive = <T extends { deletedAt: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deletedAt);

export function useTodos(): Todo[] {
  return useLiveQuery(() => getDb().todos.toArray(), [], [] as Todo[]).filter(
    (t) => !t.deletedAt,
  );
}

/**
 * Every materialized recurrence occurrence — INCLUDING tombstoned and
 * settled ones. Settlement detection (`lib/recurrence-expand.ts`) needs to
 * see a deleted occurrence to know a series moved past it, so this
 * deliberately does NOT filter `deletedAt` the way `useTodos()` does; pair
 * the two rather than using either alone.
 *
 * Queries the `recurrenceParentId` index directly rather than scanning every
 * todo: IndexedDB never indexes a null value, so `.above("")` already
 * excludes every non-occurrence row for free.
 */
export function useRecurrenceChildren(): Todo[] {
  return useLiveQuery(
    () => getDb().todos.where("recurrenceParentId").above("").toArray(),
    [],
    [] as Todo[],
  );
}

/**
 * Live lists, archived ones excluded.
 *
 * Filtering here rather than at each call site is what makes archiving a single
 * change: the board, the ⌘K list pickers, and the to-do sheet's list select all
 * read this hook, so an archived list disappears from every one of them at once.
 */
export function useLists(): List[] {
  const rows = useLiveQuery(() => getDb().lists.toArray(), [], [] as List[]);
  return useMemo(
    () => alive(rows).filter((l) => !l.archivedAt).sort(byPosition),
    [rows],
  );
}

/**
 * Archived lists, most recently archived first.
 *
 * Ordered by when they were put away rather than by `position`: the archive is
 * a history, and the list you just filed is the one you are most likely to want
 * back.
 */
export function useArchivedLists(): List[] {
  const rows = useLiveQuery(() => getDb().lists.toArray(), [], [] as List[]);
  return useMemo(
    () =>
      alive(rows)
        .filter((l) => !!l.archivedAt)
        .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")),
    [rows],
  );
}

/** Live tabs, archived ones excluded. Mirrors `useLists`. */
export function useTabs(): Tab[] {
  const rows = useLiveQuery(() => getDb().tabs.toArray(), [], [] as Tab[]);
  return useMemo(
    () => alive(rows).filter((t) => !t.archivedAt).sort(byPosition),
    [rows],
  );
}

/** Archived tabs, most recently archived first — same rationale as lists. */
export function useArchivedTabs(): Tab[] {
  const rows = useLiveQuery(() => getDb().tabs.toArray(), [], [] as Tab[]);
  return useMemo(
    () =>
      alive(rows)
        .filter((t) => !!t.archivedAt)
        .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")),
    [rows],
  );
}

export function useLabels(): Label[] {
  const rows = useLiveQuery(() => getDb().labels.toArray(), [], [] as Label[]);
  return useMemo(() => alive(rows).sort(byPosition), [rows]);
}

/** Named reminder times (EI-106). Sorted by `position` — the picker itself
 * re-sorts by `time` for its own chronological display (`reminder-presets.ts`). */
export function useReminderPresets(): ReminderPreset[] {
  const rows = useLiveQuery(
    () => getDb().reminderPresets.toArray(),
    [],
    [] as ReminderPreset[],
  );
  return useMemo(() => alive(rows).sort(byPosition), [rows]);
}

export function useProjects(): Project[] {
  const rows = useLiveQuery(() => getDb().projects.toArray(), [], [] as Project[]);
  return useMemo(() => alive(rows).sort(byPosition), [rows]);
}

/** Saved locations, alphabetical by nickname — see `placeSchema` (schema.ts). */
export function usePlaces(): Place[] {
  const rows = useLiveQuery(() => getDb().places.toArray(), [], [] as Place[]);
  return useMemo(
    () => alive(rows).sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );
}

/**
 * Every day that HAS notes, keyed by date.
 *
 * A map rather than an array because the board's only question is "does this
 * column's day have a note?", asked once per rendered column.
 *
 * Blank-bodied rows are filtered out here, which is what makes clearing a note
 * work without a tombstone: this hook is the single source of truth for "has
 * notes", so the sticky-note indicator and the sheet agree by construction.
 * See `setDayNote` in repositories.ts.
 */
export function useDayNotes(): ReadonlyMap<CivilDate, DayNote> {
  const rows = useLiveQuery(() => getDb().dayNotes.toArray(), [], [] as DayNote[]);
  return useMemo(
    () =>
      new Map(
        alive(rows)
          .filter((note) => note.body.trim() !== "")
          .map((note) => [note.date, note]),
      ),
    [rows],
  );
}

/**
 * One todo's history log (EI-94), oldest first isn't guaranteed here —
 * `buildTodoTimeline` (`lib/todo-timeline.ts`) does the ordering; this hook
 * only fetches.
 *
 * `.where("todoId").equals(id)` rather than the `toArray()`-and-filter
 * pattern every other hook here uses — `todoEvents` is the one table where
 * that full scan gets expensive, since it grows without bound while every
 * other table's live-row count stays roughly constant.
 *
 * `null` (no todo open) skips the query entirely rather than querying with a
 * sentinel — Dexie has no "match nothing" value to equal against.
 */
export function useTodoEvents(todoId: string | null): TodoEvent[] {
  const rows = useLiveQuery(
    () =>
      todoId
        ? getDb().todoEvents.where("todoId").equals(todoId).toArray()
        : Promise.resolve([] as TodoEvent[]),
    [todoId],
    [] as TodoEvent[],
  );
  return useMemo(() => alive(rows), [rows]);
}

/**
 * One todo's attachments, oldest first (EI-242).
 *
 * `.where("todoId")` rather than the `toArray()`-and-filter pattern most
 * hooks here use, for the same reason `useTodoEvents` does: this table grows
 * with every file ever attached, while the tables those hooks scan stay
 * roughly constant.
 *
 * These rows are METADATA. The bytes are in R2 and are fetched by the
 * browser from `attachmentUrl(id)` when something renders — nothing here
 * hits the network.
 *
 * `null` (no todo open) skips the query entirely rather than querying with a
 * sentinel — Dexie has no "match nothing" value to equal against.
 */
export function useAttachments(todoId: string | null): Attachment[] {
  const rows = useLiveQuery(
    () =>
      todoId
        ? getDb().attachments.where("todoId").equals(todoId).toArray()
        : Promise.resolve([] as Attachment[]),
    [todoId],
    [] as Attachment[],
  );
  return useMemo(
    () => alive(rows).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [rows],
  );
}

/**
 * How many live attachments each todo has, for the card badge (EI-242).
 *
 * One query for the whole board rather than one per card — a card must never
 * open its own live query. `useAttachments` (above) is the per-todo read, and
 * it exists for the sheet, where exactly one todo is in play.
 *
 * A todo absent from the map has none, which is what keeps the badge off
 * every ordinary card.
 */
export function useAttachmentCounts(): ReadonlyMap<string, number> {
  const rows = useLiveQuery(() => getDb().attachments.toArray(), [], [] as Attachment[]);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of alive(rows)) {
      counts.set(row.todoId, (counts.get(row.todoId) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
}

export interface GlobalEventsPage {
  events: TodoEvent[];
  /**
   * True when the raw fetch (before `alive()` filtering) came back exactly
   * `shown` rows — the caller's signal that older rows likely still exist
   * beyond this page, so a "Load more" affordance should offer to fetch a
   * bigger page.
   *
   * Deliberately computed from the RAW row count, not `events.length`
   * (post-filter). `alive()` drops undo-tombstoned rows, which can land
   * anywhere inside the fetched window — a todo settled-then-undone last
   * week is still `at`-ordered wherever it happened, not clustered at the
   * edge. Gating on the filtered count means every tombstone inside the
   * window silently shrinks it below `shown`, so `hasMore` would read false
   * — "nothing more to load" — even though the query never actually reached
   * the end of the table. The raw count is the only signal that reflects
   * what the query itself did.
   */
  hasMore: boolean;
}

/**
 * The most recent `shown` rows of the WHOLE-app event log (the Global
 * Timeline, todos-only v1), newest first — the second scoped query in this
 * file, for the same reason `useTodoEvents` is one: `todoEvents` grows
 * without bound while every other table's live-row count stays roughly
 * constant, so a `toArray()`-and-filter here would re-scan the whole table
 * on every write to any todo in the account.
 *
 * A growing `limit` over the `at` index, NOT `.offset()` and NOT a
 * `.where("at").below(cursor)` window — `.offset(n)` has no seek-by-ordinal
 * in IndexedDB, so Dexie walks `n` records on every re-run, and a fixed
 * upper-bound cursor would freeze the feed's live edge, hiding a fresh event
 * from what's supposed to be a live view. See `lib/global-timeline.ts`.
 */
export function useGlobalEvents(shown: number): GlobalEventsPage {
  const rows = useLiveQuery(
    () => getDb().todoEvents.orderBy("at").reverse().limit(shown).toArray(),
    [shown],
    [] as TodoEvent[],
  );
  return useMemo(() => ({ events: alive(rows), hasMore: rows.length === shown }), [rows, shown]);
}

/**
 * `id -> { title, deleted }` for EVERY todo, including tombstones —
 * deliberately not `alive()`-filtered, unlike every other hook here. A
 * global feed shows events for todos that no longer exist on the board, and
 * nothing hard-deletes a todo row (`remove()` only ever soft-deletes), so the
 * title is still sitting right there to read.
 */
export function useTodoTitles(): ReadonlyMap<string, TodoTitleInfo> {
  const rows = useLiveQuery(() => getDb().todos.toArray(), [], [] as Todo[]);
  return useMemo(
    () => new Map(rows.map((t) => [t.id, { title: t.title, deleted: !!t.deletedAt }])),
    [rows],
  );
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getDb().settings.get(LOCAL_OWNER_ID), [], undefined);
}

/** Pending outbox size. Becomes the sync indicator at P3. */
export function usePendingCount(): number {
  return useLiveQuery(() => getDb().outbox.count(), [], 0);
}

/**
 * Placement context, recomputed when settings change, when `renderedDays`
 * grows, and when the day rolls over.
 *
 * The midnight tick matters: leave the app open overnight and every todo's
 * column changes. Without it the board would silently show yesterday's layout.
 *
 * `renderedDays` overrides `settings.visibleDays` for the window length — see
 * `contextFromSettings` and `deriveColumn` in lib/scheduling.ts for why the
 * board needs to grow this independently of the setting.
 */
export function usePlacementContext(
  settings: Settings | undefined,
  renderedDays?: number,
): PlacementContext | null {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!settings) return;
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, [settings]);

  return useMemo(() => {
    if (!settings) return null;
    return contextFromSettings(settings, undefined, renderedDays);
    // `tick` is intentionally a dependency: it forces recomputation so the
    // board follows the clock across midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, tick, renderedDays]);
}
