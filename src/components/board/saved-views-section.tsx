"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
// Straight from `owner.ts` rather than re-exported through `repositories.ts` —
// same reasoning `view-settings.tsx` gives for the identical import.
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { mutateSettings } from "@/lib/store/mutate";
import { applySavedView, captureSavedView, useSavedViews } from "@/lib/saved-views";
import { setAssigneeFilter, useAssigneeFilter } from "@/lib/assignee-filter";
import type { Settings } from "@/lib/schema";

interface SavedViewsSectionProps {
  /** Raw Dexie row; undefined until the store has read it. */
  settings: Settings | undefined;
}

/**
 * A named snapshot of `ViewSettings`/`TabStrip`'s current selection — which
 * tab, which statuses, how many day columns, weekends on/off — switchable
 * from one menu instead of re-clicking four separate controls. See
 * `lib/saved-views.ts`'s module doc for what this deliberately is not
 * (a saved search, a label filter, a synced entity).
 *
 * A section of the View menu (`view-settings.tsx`), not a menu of its own
 * (EI-392): it was a bare bookmark icon beside View, one more peer in a date
 * row that already had ten. A saved view IS a view, so it lives where the
 * statuses and weekends it snapshots are set. It only ever reads/applies a
 * snapshot and never edits the live settings directly, so it stays
 * complementary to the controls above it in the same menu.
 *
 * Renders inside a `DropdownMenuContent` — the caller owns the menu.
 */
export function SavedViewsSection({ settings }: SavedViewsSectionProps) {
  const [views, setViews] = useSavedViews();
  const [draftName, setDraftName] = useState("");
  const assigneeFilter = useAssigneeFilter();

  const handleSave = () => {
    const name = draftName.trim();
    if (!name || !settings) return;
    setViews((prev) => [...prev, captureSavedView(name, settings, assigneeFilter)]);
    setDraftName("");
  };

  const handleDelete = (id: string, event: React.MouseEvent) => {
    // Keeps the click from also bubbling into the sibling DropdownMenuItem's
    // own click handler, which would apply the view it was just deleted from.
    event.stopPropagation();
    setViews((prev) => prev.filter((view) => view.id !== id));
  };

  return (
    <>
      {/*
        The group is load-bearing: `DropdownMenuLabel` is Base UI's
        Menu.GroupLabel, which throws without a Menu.Group around it.
      */}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Saved views</DropdownMenuLabel>
        {views.length === 0 ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">No saved views yet</p>
        ) : (
          views.map((view) => (
            <div key={view.id} className="flex items-center gap-1">
              <DropdownMenuItem
                className="flex-1"
                onClick={() => {
                  void mutateSettings(LOCAL_OWNER_ID, applySavedView(view));
                  // Absent on views saved before the filter existed: everyone.
                  setAssigneeFilter(view.assigneeFilter ?? null);
                }}
              >
                <span className="truncate">{view.name}</span>
              </DropdownMenuItem>
              <button
                type="button"
                aria-label={`Delete ${view.name}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={(event) => handleDelete(view.id, event)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))
        )}
      </DropdownMenuGroup>

      {/*
        A plain form, not a `DropdownMenuItem` — typing into the input and
        clicking Save must not select/close the menu the way an Item click
        would. Base UI's menu only closes on an Item click (or Escape/
        outside click), so ordinary form controls inside the popup are safe
        here.
      */}
      <div className="flex items-center gap-1 p-1">
        <Input
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Save current view as…"
          aria-label="New saved view name"
          className="h-7 text-xs"
          disabled={!settings}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
            // Keeps the menu's typeahead and arrow-key roving from taking
            // keys meant for the field — it shares a menu with checkbox
            // items that typeahead would otherwise jump to. Escape and Tab
            // still reach the menu, so it closes the way it always does.
            if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!draftName.trim() || !settings}
          onClick={handleSave}
        >
          Save
        </Button>
      </div>
    </>
  );
}
