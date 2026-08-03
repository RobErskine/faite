"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import type { Label, List, Project, Settings, Todo } from "@/lib/schema";
import { byPosition } from "@/lib/ordering";
import { contextFromSettings, type PlacementContext } from "@/lib/scheduling";
import { canUseDb, getDb } from "./db";
import { LOCAL_OWNER_ID, repairDuplicateLists, seedIfEmpty } from "./repositories";

/**
 * Reactive reads.
 *
 * useLiveQuery re-runs on any write to the underlying tables, so a mutation
 * updates the UI without an explicit refetch or cache invalidation. Combined
 * with local-only writes, this is what makes interactions feel instant: nothing
 * on the interaction path waits for a network round trip.
 */

/** Seeds default lists on first run and reports readiness. */
export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canUseDb()) return;
    seedIfEmpty()
      .then(repairDuplicateLists)
      .then((removed) => {
        if (removed > 0) {
          console.info(`[faite] removed ${removed} duplicate list(s)`);
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

export function useLists(): List[] {
  const rows = useLiveQuery(() => getDb().lists.toArray(), [], [] as List[]);
  return useMemo(() => alive(rows).sort(byPosition), [rows]);
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
 * Placement context, recomputed when settings change and when the day rolls
 * over.
 *
 * The midnight tick matters: leave the app open overnight and every todo's
 * column changes. Without it the board would silently show yesterday's layout.
 */
export function usePlacementContext(settings: Settings | undefined): PlacementContext | null {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!settings) return;
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, [settings]);

  return useMemo(() => {
    if (!settings) return null;
    return contextFromSettings(settings);
    // `tick` is intentionally a dependency: it forces recomputation so the
    // board follows the clock across midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, tick]);
}
