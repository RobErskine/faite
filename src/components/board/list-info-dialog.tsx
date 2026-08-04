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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { List } from "@/lib/schema";

interface ListInfoDialogProps {
  /** The list whose settings are open, or null when the dialog is closed. */
  list: List | null;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onArchive: (list: List) => void;
  onDelete: (list: List) => void;
}

/**
 * Everything you can do to a list, in one place.
 *
 * A Dialog rather than a menu because renaming needs a text field, and a menu
 * that opens a second surface for its most common action is two steps where one
 * would do. It is also the only screen where archive and delete sit side by
 * side, which is where the difference between them is easiest to explain.
 *
 * Neither destructive action confirms. Both are undoable and both raise a toast
 * carrying Undo, which is a better answer than a confirmation step: it costs
 * nothing on the way in and still recovers a mistake on the way out.
 */
export function ListInfoDialog({ list, ...rest }: ListInfoDialogProps) {
  if (!list) return null;
  // Keyed remount re-seeds the draft name per list, the same reason TodoSheet
  // does it — syncing it in an effect would cascade renders.
  return <ListInfoDialogContent key={list.id} list={list} {...rest} />;
}

function ListInfoDialogContent({
  list,
  onClose,
  onRename,
  onArchive,
  onDelete,
}: ListInfoDialogProps & { list: List }) {
  const [name, setName] = useState(list.name);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== list.name;

  const save = () => {
    if (canSave) onRename(list.id, trimmed);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>List settings</DialogTitle>
          <DialogDescription>
            Rename this list, put it away in the archive, or delete it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="list-name">Name</Label>
          <Input
            id="list-name"
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

        <DialogFooter className="sm:justify-between">
          {/*
            The two ways to remove a list, grouped away from Save so the
            destructive pair is never the button under the cursor after typing.
          */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onArchive(list)}>
              <Archive aria-hidden />
              Archive
            </Button>
            <Button variant="destructive" onClick={() => onDelete(list)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
          <Button onClick={save} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
