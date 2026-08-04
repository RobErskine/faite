"use client";

import { toast } from "sonner";
import type { Tab } from "@/lib/schema";
import {
  archiveTab,
  createTab,
  deleteTab,
  starterListName,
  unarchiveTab,
  updateTab,
} from "@/lib/store/repositories";
import {
  createUndoStep,
  deleteTabUndoSteps,
  inversePatch,
  pushUndo,
  undoById,
  type UndoStep,
} from "@/lib/undo";

/**
 * Tab mutations bundled with the undo entry and toast they are never correct
 * without — the sibling of list-actions.ts, and for the same reason: these are
 * reachable from both the tab dialog and ⌘K, and the part that drifts between
 * two copies is the undo step, not the write.
 *
 * Every archive and delete here fans out across the tab's lists. That fan-out
 * is exactly what a second implementation would forget.
 */

/** Silent: the pill updates under the dialog as you save. */
export function updateTabWithUndo(
  tab: Tab,
  patch: Partial<Pick<Tab, "name" | "description" | "color">>,
  label: string,
): void {
  pushUndo(label, [
    { kind: "tab", entityId: tab.id, patch: inversePatch(tab, patch) },
  ]);
  void updateTab(tab.id, patch);
}

export async function createTabWithUndo(name: string): Promise<string> {
  const { tabId, listId } = await createTab(name);

  /**
   * One entry covers the tab AND the starter list it was born with, so undoing
   * a create does not leave an orphan column behind on the default tab.
   *
   * The list is tombstoned first: same ordering rule as `deleteTabUndoSteps`
   * read backwards, so there is never a rendered frame where a live list points
   * at a tab that has already gone.
   */
  const entryId = pushUndo(`Created “${name}”`, [
    createUndoStep("list", listId),
    createUndoStep("tab", tabId),
  ]);
  toast.success(`Created “${name}”`, {
    description: `Started with “${starterListName(name)}”.`,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
  return tabId;
}

export async function archiveTabWithUndo(tab: Tab): Promise<void> {
  // Await first, so a refused archive (the default tab, or already gone) cannot
  // leave a no-op entry on the undo stack for ⌘Z to spend itself on.
  const archived = await archiveTab(tab.id);
  if (!archived) return;

  /**
   * One entry covers the tab AND every list that went away with it. Undoing
   * only the tab would return an empty strip entry and leave its columns
   * stranded in the archive.
   *
   * Only the lists `archiveTab` actually stamped appear here — one archived
   * last week is absent from `listIds`, so undo correctly leaves it filed.
   */
  const steps: UndoStep[] = [
    { kind: "tab", entityId: tab.id, patch: { archivedAt: null } },
    ...archived.listIds.map((id) => ({
      kind: "list" as const,
      entityId: id,
      // Clearing the group marker alongside the date matters: leaving it set
      // on a live list would make a later archive-and-restore of this tab pick
      // it up again even if the user had since filed it separately.
      patch: { archivedAt: null, archivedWithTabId: null },
    })),
  ];

  const count = archived.listIds.length;
  const entryId = pushUndo(`Archived “${tab.name}”`, steps);
  toast.success(`Archived “${tab.name}”`, {
    description:
      count === 0
        ? "It had no lists."
        : `Its ${count === 1 ? "list" : `${count} lists`} went with it.`,
    duration: 6000,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
}

export async function restoreTabWithUndo(tab: Tab): Promise<void> {
  const restored = await unarchiveTab(tab.id);
  if (!restored) return;

  pushUndo(`Restored “${tab.name}”`, [
    // Back to the instant it was filed, not null — and the group marker goes
    // back on the lists that came with it, so undoing a restore re-files the
    // whole group as one and a later `unarchiveTab` still finds them.
    { kind: "tab", entityId: tab.id, patch: { archivedAt: tab.archivedAt } },
    ...restored.listIds.map((id) => ({
      kind: "list" as const,
      entityId: id,
      patch: { archivedAt: tab.archivedAt, archivedWithTabId: tab.id },
    })),
  ]);
  // The tab returns behind the open sheet, so say so.
  toast.success(`Restored “${tab.name}”`);
}

export async function deleteTabWithUndo(tab: Tab): Promise<void> {
  const result = await deleteTab(tab.id);
  if (!result) return; // the default tab, or already gone

  const entryId = pushUndo(
    `Deleted “${tab.name}”`,
    deleteTabUndoSteps(result.tabId, result.movedListIds),
  );
  toast.success(`Deleted “${tab.name}”`, {
    description: "Its lists moved to your default tab.",
    // No confirmation step precedes this. Give the undo room.
    duration: 10000,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
}
