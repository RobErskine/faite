"use client";

import { toast } from "sonner";
import type { List } from "@/lib/schema";
import {
  archiveList,
  deleteList,
  unarchiveList,
  updateList,
} from "@/lib/store/repositories";
import { deleteListUndoSteps, inversePatch, pushUndo, undoById } from "@/lib/undo";

/**
 * List mutations bundled with the undo entry and toast they are never correct
 * without.
 *
 * These live together because the same actions are reachable from two places —
 * the column header dialog and the ⌘K palette — and the part that is easy to
 * get subtly wrong is not the write, it is the undo step beside it. Two copies
 * would drift, and the copy that drifted would be the one that quietly stops
 * restoring a list's to-dos.
 */

/**
 * Silent: the column header updates under the dialog as you save.
 *
 * A patch rather than a name, mirroring `updateTabWithUndo` — a list has carried
 * `color` since `decorationSchema` was written, and the caller decides both what
 * changed and what the undo entry should read, since "Renamed" is wrong for a
 * recolor and the write is otherwise identical.
 */
export function updateListWithUndo(
  list: List,
  patch: Partial<Pick<List, "name" | "color">>,
  label: string,
): void {
  pushUndo(label, [
    { kind: "list", entityId: list.id, patch: inversePatch(list, patch) },
  ]);
  void updateList(list.id, patch);
}

export async function archiveListWithUndo(list: List): Promise<void> {
  // Await first, so a refused archive (Backlog, or already gone) cannot leave a
  // no-op entry on the undo stack for ⌘Z to spend itself on.
  const archived = await archiveList(list.id);
  if (!archived) return;

  const entryId = pushUndo(`Archived “${list.name}”`, [
    { kind: "list", entityId: list.id, patch: { archivedAt: null } },
  ]);
  toast.success(`Archived “${list.name}”`, {
    description: "Its to-dos went with it.",
    duration: 6000,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
}

export function restoreListWithUndo(list: List): void {
  pushUndo(`Restored “${list.name}”`, [
    // Back to the instant it was filed, not null — undoing a restore should
    // return it to the archive in the position it was found, and back into its
    // tab's group if that is how it got there.
    {
      kind: "list",
      entityId: list.id,
      patch: {
        archivedAt: list.archivedAt,
        archivedWithTabId: list.archivedWithTabId ?? null,
      },
    },
  ]);
  void unarchiveList(list.id);
  // The column returns behind the open sheet, so say so.
  toast.success(`Restored “${list.name}”`);
}

export async function deleteListWithUndo(list: List): Promise<void> {
  const result = await deleteList(list.id);
  if (!result) return; // Backlog, or already gone

  /**
   * One entry covers the list AND every todo that moved, so a single undo puts
   * it back whole. Undoing only the list would restore it empty and strand its
   * to-dos in Backlog — worse than not offering undo at all.
   */
  const entryId = pushUndo(
    `Deleted “${list.name}”`,
    deleteListUndoSteps(result.listId, result.movedTodoIds),
  );
  toast.success(`Deleted “${list.name}”`, {
    description: "Its to-dos moved to Backlog.",
    // The most destructive action in the app, and there is no confirmation step
    // before it. Give it room.
    duration: 10000,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
}
