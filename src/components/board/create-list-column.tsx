"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createList } from "@/lib/store/repositories";
import { createUndoStep, pushUndo, undoById } from "@/lib/undo";

/**
 * The end-of-track slot for adding a list.
 *
 * ⌘K can already create one, but only if you know it can. This sits exactly
 * where the eye lands after the last column — and exactly where the new list
 * will appear, since `createList` positions at the end — so scrolling to the
 * right of the board is enough to discover it.
 *
 * Deliberately NOT a droppable. It is a button that happens to be column-sized;
 * making it a drop target would mean answering what "drop a to-do on Create
 * list" does, and every answer is worse than not offering it.
 */
export function CreateListColumn() {
  /** `null` is idle. A string — including "" — means the field is open. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = async () => {
    const name = draft?.trim();
    setDraft(null);
    if (!name) return;

    const id = await createList(name);
    const label = `List "${name}" created`;
    const entryId = pushUndo(label, [createUndoStep("list", id)]);

    /**
     * A toast for something you can already see, unlike the palette's creates.
     * It earns its place by carrying Undo: the new column can land past the
     * right edge of the track, so this is the only reachable way back.
     */
    toast.success(label, {
      action: { label: "Undo", onClick: () => void undoById(entryId) },
    });
  };

  return (
    <div
      className={cn(
        // Sized exactly like a list column so it shares the track's rhythm and
        // inherits the planning half's wider --column-min.
        "flex flex-1 flex-col rounded-md",
        "min-w-(--column-min) max-w-(--column-max)",
      )}
    >
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-md",
            "border border-dashed border-border text-muted-foreground",
            "transition-colors hover:border-foreground/30 hover:bg-background/60",
            "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          )}
        >
          <Plus className="size-4" aria-hidden />
          <span className="font-heading text-sm font-bold uppercase tracking-tight">
            Create list
          </span>
        </button>
      ) : (
        <div
          className={cn(
            "flex flex-1 flex-col rounded-md border border-dashed",
            "border-foreground/30 bg-background/60 px-2 pt-2",
          )}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
              // Escape abandons the name outright. Blur is the forgiving path.
              if (e.key === "Escape") setDraft(null);
            }}
            // Matches the quick-add fields: clicking away keeps what you typed
            // rather than discarding it.
            onBlur={() => void commit()}
            placeholder="List name"
            aria-label="New list name"
            className={cn(
              "w-full bg-transparent text-sm outline-none",
              "font-heading font-bold uppercase tracking-tight",
              "placeholder:font-sans placeholder:font-normal placeholder:normal-case",
              "placeholder:tracking-normal placeholder:text-muted-foreground/60",
            )}
          />
        </div>
      )}
    </div>
  );
}
