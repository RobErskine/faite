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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { List, ReminderPreset, Tab } from "@/lib/schema";

export type ListPatch = Partial<
  Pick<List, "name" | "description" | "color" | "defaultReminderPresetId">
>;

const NONE = "__none__";

interface ListInfoDialogProps {
  /** The list whose settings are open, or null when the dialog is closed. */
  list: List | null;
  /** Live AND archived tabs — resolves the color shown when unset. */
  tabsById: ReadonlyMap<string, Pick<Tab, "color">>;
  /** Live reminder presets — offered as this list's default (EI-112). */
  reminderPresets: ReminderPreset[];
  onClose: () => void;
  onSave: (list: List, patch: ListPatch) => void;
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
  tabsById,
  reminderPresets,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: ListInfoDialogProps & { list: List }) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? "");
  const [color, setColor] = useState<string | null>(list.color);
  const [defaultReminderPresetId, setDefaultReminderPresetId] = useState<string | null>(
    list.defaultReminderPresetId,
  );
  const inheritedColor = list.tabId ? (tabsById.get(list.tabId)?.color ?? null) : null;

  const trimmed = name.trim();
  // Empty prose is absence, not an empty string — the schema is nullable,
  // same convention as TabInfoDialog's description field.
  const nextDescription = description.trim() || null;

  // Diffed rather than sent wholesale, the same shape TabInfoDialog uses: an
  // undo entry for a field that did not change is an entry ⌘Z spends itself on.
  const patch: ListPatch = {};
  if (trimmed && trimmed !== list.name) patch.name = trimmed;
  if (nextDescription !== (list.description ?? null)) patch.description = nextDescription;
  if (color !== list.color) patch.color = color;
  if (defaultReminderPresetId !== list.defaultReminderPresetId) {
    patch.defaultReminderPresetId = defaultReminderPresetId;
  }

  const canSave = Object.keys(patch).length > 0;

  const save = () => {
    if (canSave) onSave(list, patch);
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

        <div className="space-y-1.5">
          <Label htmlFor="list-description">Description</Label>
          <Textarea
            id="list-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this list is for"
          />
          <p className="text-xs text-muted-foreground">
            Used for smart routing and MCP access — give enough context (a
            project name, ticket prefixes) that a to-do can be routed here
            automatically later.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="list-color">Color</Label>
            <ColorPicker
              id="list-color"
              value={color}
              onChange={setColor}
              inheritedColor={inheritedColor}
              label="List color"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Tints this column&rsquo;s header, and groups this list&rsquo;s to-dos
            in the day columns. Falls back to the tab&rsquo;s color when unset.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="list-default-reminder">Default reminder</Label>
          <Select
            value={defaultReminderPresetId ?? NONE}
            onValueChange={(v) => setDefaultReminderPresetId(v === NONE ? null : v)}
          >
            <SelectTrigger id="list-default-reminder">
              <SelectValue>
                {(value: string) => {
                  if (value === NONE) return "None";
                  const preset = reminderPresets.find((p) => p.id === value);
                  return preset
                    ? preset.emoji
                      ? `${preset.emoji} ${preset.name}`
                      : preset.name
                    : "Deleted preset";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {reminderPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.emoji ? `${preset.emoji} ` : ""}
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            A new to-do created in this list gets this reminder automatically,
            once it has a date. Still easy to change or clear per to-do.
          </p>
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
