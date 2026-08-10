"use client";

import { useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Tab } from "@/lib/schema";

export type TabPatch = Partial<Pick<Tab, "name" | "description" | "color">>;

interface TabInfoDialogProps {
  /** The tab whose settings are open, or null when the dialog is closed. */
  tab: Tab | null;
  onClose: () => void;
  onSave: (tab: Tab, patch: TabPatch) => void;
  onArchive: (tab: Tab) => void;
  onDelete: (tab: Tab) => void;
}

/**
 * Everything you can do to a tab, in one place — the sibling of
 * ListInfoDialog, and deliberately the same shape so the two feel like one
 * idea at two levels.
 *
 * Neither destructive action confirms; both are undoable and both raise a toast
 * carrying Undo. Archiving a tab takes its lists with it, which is a bigger
 * blast radius than archiving one list, so the description says so plainly
 * rather than relying on the toast to explain after the fact.
 */
export function TabInfoDialog({ tab, ...rest }: TabInfoDialogProps) {
  if (!tab) return null;
  // Keyed remount re-seeds the drafts per tab, same reason ListInfoDialog does.
  return <TabInfoDialogContent key={tab.id} tab={tab} {...rest} />;
}

function TabInfoDialogContent({
  tab,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: TabInfoDialogProps & { tab: Tab }) {
  const [name, setName] = useState(tab.name);
  const [description, setDescription] = useState(tab.description ?? "");
  const [color, setColor] = useState<string | null>(tab.color);

  const trimmedName = name.trim();
  // Empty prose is absence, not an empty string — the schema is nullable.
  const nextDescription = description.trim() || null;

  const patch: TabPatch = {};
  if (trimmedName && trimmedName !== tab.name) patch.name = trimmedName;
  if (nextDescription !== (tab.description ?? null)) patch.description = nextDescription;
  if (color !== tab.color) patch.color = color;

  const canSave = Object.keys(patch).length > 0;

  const save = () => {
    if (canSave) onSave(tab, patch);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tab settings</DialogTitle>
          <DialogDescription>
            {tab.isDefault
              ? "Your default tab. It can be renamed and recolored, but not put away — it is where lists from a deleted tab go."
              : "Rename this tab, give it a color, or put it away along with its lists."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="tab-name">Name</Label>
          <Input
            id="tab-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              save();
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tab-description">Description</Label>
          <Textarea
            id="tab-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this tab is for"
          />
          {/* Enter commits in the name field but must not here, so say where it shows. */}
          <p className="text-xs text-muted-foreground">Shown when you hover the tab.</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="tab-color">Color</Label>
            <ColorPicker
              id="tab-color"
              value={color}
              onChange={setColor}
              label="Tab color"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Used to differentiate this list as an accent.
          </p>
        </div>

        <DialogFooter className="sm:justify-between">
          {/*
            The default tab gets neither destructive action — the same reasoning
            as Backlog having no column menu at all: a button whose every action
            is refused is worse than no button. The empty span keeps Save at the
            right edge where it is in every other state.
          */}
          {tab.isDefault ? (
            <span />
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onArchive(tab)}>
                <Archive aria-hidden />
                Archive
              </Button>
              <Button variant="destructive" onClick={() => onDelete(tab)}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            </div>
          )}
          <Button onClick={save} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
