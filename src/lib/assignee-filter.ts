"use client";

import { useSyncExternalStore } from "react";

/**
 * The board's assignee filter (EI-402): which to-dos show, by who they are
 * for. `null` is everyone; `"me"` is the unassigned to-dos (null assignee =
 * the account owner); anything else is an `Assignee` id.
 *
 * Device-local on purpose, in `localStorage` like saved views: a synced
 * `Settings` field would be a schema change for a view preference, and "which
 * agent am I looking at" is as device-relevant as `activeTabId`. A saved view
 * can snapshot it (`lib/saved-views.ts`).
 */
export const ASSIGNEE_FILTER_ME = "me";
export type AssigneeFilter = string | null;

const STORAGE_KEY = "faite:assignee-filter";

const listeners = new Set<() => void>();

function read(): AssigneeFilter {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setAssigneeFilter(next: AssigneeFilter): void {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Privacy modes can throw; the filter then just does not persist.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAssigneeFilter(): AssigneeFilter {
  return useSyncExternalStore(subscribe, read, () => null);
}
