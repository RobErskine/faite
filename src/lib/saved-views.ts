/**
 * Saved views (EI-65): a named snapshot of the board's existing view toggles
 * — which tab is active, which statuses are visible, how many day columns
 * show, and whether weekends are shown — so a user can switch between a few
 * hand-picked configurations instead of re-clicking `ViewSettings`/`TabStrip`
 * controls every time.
 *
 * Deliberately NOT a saved search or a label/list filter: neither exists as a
 * persisted, reusable concept anywhere else in the app today (column text
 * filters are explicitly ephemeral, per `use-board-ui-state.ts`'s
 * `columnFilters` comment — "a filter surviving reload would hide cards with
 * no visible cause" — and per-todo label filtering doesn't exist at all yet).
 * A saved view only ever snapshots fields that are ALREADY persisted,
 * board-wide settings (`Settings.activeTabId`/`visibleStatuses`/
 * `visibleDays`/`showWeekends` — the same four `ViewSettings`/`TabStrip`
 * already write to). Building a general filter/query DSL on top of that is
 * explicitly out of scope for v1 (AGENTS.md's no-over-engineering rule).
 *
 * Local-only, `localStorage`-backed, NOT a synced entity. Two reasons:
 *
 * 1. Every field a saved view snapshots is device-relevant in exactly the way
 *    `activeTabId` already is — `docs/ARCHITECTURE.md` §2.12 documents that
 *    field as deliberately excluded from `SETTINGS_SYNCED_FIELDS`
 *    (`lib/sync/wire.ts`) because "which tab is open" doesn't obviously
 *    transfer across a phone and a desktop the way a percentage split does.
 *    A saved view bundling that same field inherits the same reasoning.
 * 2. There's no stated need yet for a saved view to follow a user to a second
 *    device, and turning it into a synced entity is the full `Place`/
 *    `ReminderPreset` ritual (`docs/SCHEMA-CHANGES.md`'s seven-file
 *    operation) for a feature whose only spec is its title. Local-only is the
 *    conservative default `AGENTS.md` calls for; if cross-device sync turns
 *    out to matter later, migrating this small JSON array into a synced
 *    entity is a contained follow-up, not a foreclosed option.
 *
 * Same `localStorage`-with-try/catch discipline as `lib/onboarding.ts` and
 * `lib/sync/cursor.ts` — privacy modes can throw on any storage access, and a
 * saved view silently failing to persist is a much smaller failure than a
 * crash.
 */

import { useCallback, useState } from "react";
import { uuidv7 } from "uuidv7";
import type { Settings, TodoStatus } from "@/lib/schema";

const STORAGE_KEY = "faite:saved-views";

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  /** Snapshot of `Settings.activeTabId` — may be `null`, same as the field itself. */
  activeTabId: string | null;
  visibleStatuses: TodoStatus[];
  visibleDays: number;
  showWeekends: boolean;
}

function safeGet(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Saved view may not persist across reload. Not worth failing the
    // interaction over — same trade `lib/onboarding.ts` makes.
  }
}

/**
 * Forget every saved view on this device. Called by `clearDeviceData()` on
 * sign-out — view names are user-authored content, so they leak exactly like
 * the board itself does, and there is no server copy to restore them from.
 */
export function clearSavedViews(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort trade as `safeSet` above.
  }
}

/** A row shaped wrong (older version, hand-edited storage) is dropped rather than crashing the read. */
function isSavedView(value: unknown): value is SavedView {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.createdAt === "string" &&
    (v.activeTabId === null || typeof v.activeTabId === "string") &&
    Array.isArray(v.visibleStatuses) &&
    typeof v.visibleDays === "number" &&
    typeof v.showWeekends === "boolean"
  );
}

export function readSavedViews(): SavedView[] {
  const raw = safeGet();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
  } catch {
    return [];
  }
}

function writeSavedViews(views: SavedView[]): void {
  safeSet(JSON.stringify(views));
}

/** Builds a new saved view from the board's current settings. Does not persist it. */
export function captureSavedView(name: string, settings: Settings): SavedView {
  return {
    id: uuidv7(),
    name,
    createdAt: new Date().toISOString(),
    activeTabId: settings.activeTabId,
    visibleStatuses: settings.visibleStatuses,
    visibleDays: settings.visibleDays,
    showWeekends: settings.showWeekends,
  };
}

/**
 * The `Settings` patch that applying a saved view writes via `mutateSettings`.
 * A stale `activeTabId` (its tab was since archived/deleted) is not special-
 * cased here — `use-board-data.ts`'s `activeTabId` resolution already falls
 * back to the default tab when the stored id doesn't resolve, the same
 * safety net an ordinary tab switch relies on.
 */
export function applySavedView(view: SavedView): Partial<Settings> {
  return {
    activeTabId: view.activeTabId,
    visibleStatuses: view.visibleStatuses,
    visibleDays: view.visibleDays,
    showWeekends: view.showWeekends,
  };
}

/**
 * Reactive local list of saved views, backed by `localStorage`. Not
 * `useLiveQuery`/Dexie-backed (this is deliberately not a synced entity —
 * see the module doc comment) and not cross-tab reactive (no `storage` event
 * listener) — the one component that renders this list is the only writer,
 * so a second tab observing a stale list until its own next read is an
 * acceptable trade for the extra listener plumbing it would take to close.
 */
export function useSavedViews(): [SavedView[], (updater: (prev: SavedView[]) => SavedView[]) => void] {
  const [views, setViewsState] = useState<SavedView[]>(() => readSavedViews());

  const setViews = useCallback((updater: (prev: SavedView[]) => SavedView[]) => {
    setViewsState((prev) => {
      const next = updater(prev);
      writeSavedViews(next);
      return next;
    });
  }, []);

  return [views, setViews];
}
