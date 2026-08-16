"use client";

import { useState } from "react";
import { Bookmark, ChevronDown, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Straight from `owner.ts` rather than re-exported through `repositories.ts` —
// same reasoning `view-settings.tsx` gives for the identical import.
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { mutateSettings } from "@/lib/store/mutate";
import { applySavedView, captureSavedView, useSavedViews } from "@/lib/saved-views";
import type { Settings } from "@/lib/schema";
import { cn } from "@/lib/utils";

interface SavedViewsMenuProps {
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
 * Sits next to `ViewSettings` in `DateNav` rather than replacing it: this menu
 * only ever reads/applies a snapshot, it never edits the live settings
 * directly, so the two stay complementary the same way `TabStrip` and
 * `ViewSettings` already are.
 */
export function SavedViewsMenu({ settings }: SavedViewsMenuProps) {
  const [views, setViews] = useSavedViews();
  const [draftName, setDraftName] = useState("");

  const handleSave = () => {
    const name = draftName.trim();
    if (!name || !settings) return;
    setViews((prev) => [...prev, captureSavedView(name, settings)]);
    setDraftName("");
  };

  const handleDelete = (id: string, event: React.MouseEvent) => {
    // Keeps the click from also bubbling into the sibling DropdownMenuItem's
    // own click handler, which would apply the view it was just deleted from.
    event.stopPropagation();
    setViews((prev) => prev.filter((view) => view.id !== id));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Saved views"
        className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "text-muted-foreground")}
      >
        <Bookmark aria-hidden />
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-64">
        {views.length === 0 ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">No saved views yet</p>
        ) : (
          <DropdownMenuGroup>
            {views.map((view) => (
              <div key={view.id} className="flex items-center gap-1">
                <DropdownMenuItem
                  className="flex-1"
                  onClick={() =>
                    void mutateSettings(LOCAL_OWNER_ID, applySavedView(view))
                  }
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
            ))}
          </DropdownMenuGroup>
        )}

        <DropdownMenuSeparator />

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
