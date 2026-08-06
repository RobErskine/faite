"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import type { Label, List, Project, Settings, Tab, Todo } from "@/lib/schema";
import { byPosition } from "@/lib/ordering";
import { contextFromSettings, type PlacementContext } from "@/lib/scheduling";
import { canUseDb, getDb } from "./db";
import { ensureDefaultTab, LOCAL_OWNER_ID, seedIfEmpty } from "./repositories";

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
      .then((assigned) => {
        if (assigned > 0) {
          console.info(`[faite] moved ${assigned} list(s) onto the default tab`);
        }
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

export function useProjects(): Project[] {
  const rows = useLiveQuery(() => getDb().projects.toArray(), [], [] as Project[]);
  return useMemo(() => alive(rows).sort(byPosition), [rows]);
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
