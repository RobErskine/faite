"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createReminderPreset } from "@/lib/store/repositories";
import { formatReminderTime, parsePresetQuery, reminderLabelFor } from "@/lib/reminder-presets";
import type { ReminderPreset, Todo } from "@/lib/schema";

/** A bare parsed time, offered as "Remind at 9:30 AM" — applies `reminderTime`
 * directly, creates no preset. */
function timeSentinel(time: string) {
  return { kind: "time" as const, time };
}
type TimeEntry = ReturnType<typeof timeSentinel>;

/** Same render-time-sentinel trick as `LabelPicker`'s `createSentinel` — see
 * docs/PICKERS.md §3. The name+time are baked into the entry itself rather
 * than read back out of `query` state at pick time. */
function createSentinel(name: string, time: string) {
  return { kind: "create" as const, name, time };
}
type CreateEntry = ReturnType<typeof createSentinel>;

/** Offered alongside a bare parsed time — typing "12:00am" gets both "Remind
 * at 12:00 AM" (apply only) and this (name it, save it, apply it). Unlike
 * `CreateEntry`, there's no name in the query to bake in yet — picking this
 * transitions the picker into an inline naming step (below) rather than
 * committing immediately. */
function saveAsPresetSentinel(time: string) {
  return { kind: "save" as const, time };
}
type SaveEntry = ReturnType<typeof saveAsPresetSentinel>;

type Entry = ReminderPreset | TimeEntry | CreateEntry | SaveEntry;

const isTimeEntry = (entry: Entry): entry is TimeEntry =>
  "kind" in entry && entry.kind === "time";
const isCreateEntry = (entry: Entry): entry is CreateEntry =>
  "kind" in entry && entry.kind === "create";
const isSaveEntry = (entry: Entry): entry is SaveEntry =>
  "kind" in entry && entry.kind === "save";

interface ReminderPickerProps {
  todo: Todo;
  presets: ReminderPreset[];
  onSave: (id: string, patch: Partial<Todo>) => void;
}

/**
 * Type-ahead replacement for the raw `<input type="time">` (EI-106 P2).
 *
 * Built on `Combobox` (`ui/combobox.tsx`) in **single** mode — one reminder
 * per todo, unlike `LabelPicker`'s `multiple`. No chips: the current value
 * shows as the input's placeholder (`reminderLabelFor`), the same "current
 * state as resting text" pattern `LabelPicker` uses for its own placeholder,
 * rather than a persistent chip with nothing else to sit next to.
 *
 * Owns no selection state beyond the query string — `todo.reminderTime` is
 * the single source of truth, exactly like `LabelPicker` derives
 * `appliedLabels` from `todo.labelIds`.
 *
 * Rows come from `parsePresetQuery()` (`lib/reminder-presets.ts`): a preset
 * name match, a bare parsed time, a name+time "create" combo, or none.
 * Non-negotiable carryovers from `LabelPicker`, per docs/PICKERS.md §2/§3:
 * `filter={null}` (filtering happens in `items`), the create sentinel's
 * name/time baked in at render rather than read from `query` state at pick
 * time, `ComboboxEmpty` always mounted so Escape doesn't bubble past the
 * popup and close the Sheet, and `empty:hidden` on that wrapper.
 */
export function ReminderPicker({ todo, presets, onSave }: ReminderPickerProps) {
  const [query, setQuery] = useState("");
  // Set once "Save as preset reminder time" is picked on a bare time — swaps
  // the combobox for an inline name field rather than committing right away,
  // since (unlike `CreateEntry`) there's no name in the query to bake in.
  const [namingTime, setNamingTime] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");

  const result = useMemo(() => parsePresetQuery(query, presets), [query, presets]);

  const items = useMemo((): Entry[] => {
    switch (result.kind) {
      case "match":
        return result.presets;
      case "time":
        return [timeSentinel(result.time), saveAsPresetSentinel(result.time)];
      case "create":
        return [createSentinel(result.name, result.time)];
      case "none":
        return [];
    }
  }, [result]);

  const applyTime = (time: string) => {
    onSave(todo.id, { reminderTime: time });
  };

  const createAndApply = async (name: string, time: string) => {
    await createReminderPreset(name, time);
    applyTime(time);
  };

  const cancelNaming = () => {
    setNamingTime(null);
    setPresetName("");
  };

  const saveNamedPreset = async () => {
    const trimmed = presetName.trim();
    if (!trimmed || namingTime === null) return;
    await createAndApply(trimmed, namingTime);
    cancelNaming();
  };

  const currentLabel = todo.reminderTime
    ? reminderLabelFor(todo.reminderTime, presets)
    : "Add a reminder…";

  if (namingTime !== null) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="todo-reminder-preset-name">
          Name this reminder time ({formatReminderTime(namingTime)})
        </Label>
        <div className="flex items-center gap-1.5">
          <Input
            id="todo-reminder-preset-name"
            autoFocus
            placeholder="Midnight, Bedtime…"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveNamedPreset();
              if (e.key === "Escape") cancelNaming();
            }}
            className="h-8 w-44"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!presetName.trim()}
            onClick={() => void saveNamedPreset()}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel saving preset"
            onClick={cancelNaming}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="todo-reminder-input">Reminder</Label>
      <div className="flex items-center gap-1.5">
        <Combobox
          items={items}
          value={null}
          onValueChange={(entry: Entry | null) => {
            if (!entry) return;
            if (isSaveEntry(entry)) {
              setNamingTime(entry.time);
              setQuery("");
              return;
            }
            // A ReminderPreset and a TimeEntry both carry `.time` — a bare
            // time and a picked preset apply the same way, only a create
            // entry needs the extra step of writing the preset first.
            if (isCreateEntry(entry)) {
              void createAndApply(entry.name, entry.time);
            } else {
              applyTime(entry.time);
            }
            setQuery("");
          }}
          inputValue={query}
          onInputValueChange={setQuery}
          itemToStringLabel={(entry: Entry) =>
            isTimeEntry(entry) || isCreateEntry(entry) || isSaveEntry(entry)
              ? formatReminderTime(entry.time)
              : entry.name
          }
          filter={null}
          openOnInputClick
        >
          <ComboboxInput
            id="todo-reminder-input"
            placeholder={currentLabel}
            className="h-8 w-44 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup>
                {/* Always mounted — see ComboboxEmpty's own comment for why
                    skipping it lets Escape bubble past this popup and close
                    the whole sheet instead of just the popup. */}
                <ComboboxEmpty>No reminder presets match.</ComboboxEmpty>
                <ComboboxList>
                  {(entry: Entry) =>
                    isCreateEntry(entry) ? (
                      <ComboboxItem key="create" value={entry} className="text-muted-foreground">
                        <Plus className="size-3.5" aria-hidden />
                        Create preset &ldquo;{entry.name}&rdquo; at {formatReminderTime(entry.time)}
                      </ComboboxItem>
                    ) : isSaveEntry(entry) ? (
                      <ComboboxItem key="save" value={entry} className="text-muted-foreground">
                        <Plus className="size-3.5" aria-hidden />
                        Save as preset reminder time
                      </ComboboxItem>
                    ) : isTimeEntry(entry) ? (
                      <ComboboxItem key="time" value={entry}>
                        Remind at {formatReminderTime(entry.time)}
                      </ComboboxItem>
                    ) : (
                      <ComboboxItem key={entry.id} value={entry}>
                        {entry.emoji ? `${entry.emoji} ` : ""}
                        {entry.name}
                        <span className="ml-auto text-muted-foreground">
                          {formatReminderTime(entry.time)}
                        </span>
                      </ComboboxItem>
                    )
                  }
                </ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>
        {todo.reminderTime && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear reminder"
            onClick={() => onSave(todo.id, { reminderTime: null })}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
