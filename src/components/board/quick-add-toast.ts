import { toast } from "sonner";
import { createUndoStep, pushUndo, undoById } from "@/lib/undo";
import type { QuickAddLanding } from "@/lib/quick-add";

/**
 * One id for every quick-add toast, so typing five to-dos in a row replaces
 * one toast five times instead of stacking five (sonner shows three at once,
 * and a stack would push older, unrelated toasts — a move's Undo — off).
 */
export const QUICK_ADD_TOAST_ID = "quick-add";

/**
 * Records the undo for a just-created quick-add to-do and says where it went
 * (EI-375): "Added to Thu, Oct 15 · To Read", with Undo. Shared by the column
 * row (`handleQuickAdd`) and both ⌘K create paths, so no path can forget it.
 *
 * The undo entry names the to-do ("Added “Buy milk”") for the "Undone"
 * toast; this toast names the place, which is what was invisible before.
 */
export function announceQuickAdd(todoId: string, title: string, landing: QuickAddLanding): void {
  const entryId = pushUndo(`Added “${short(title)}”`, [createUndoStep("todo", todoId)]);
  toast.success(landing.message, {
    id: QUICK_ADD_TOAST_ID,
    // `null`, not `undefined`: sonner merges an update into the toast with
    // the same id, so an omitted description would keep the last one's note.
    description: landing.note,
    action: { label: "Undo", onClick: () => void undoById(entryId) },
  });
}

/** Same 40-character cut `use-board-actions.ts` quotes titles with. */
function short(title: string, max = 40): string {
  const trimmed = title.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
