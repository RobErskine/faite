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

type Entry = ReminderPreset | TimeEntry | CreateEntry;

const isTimeEntry = (entry: Entry): entry is TimeEntry =>
  "kind" in entry && entry.kind === "time";
const isCreateEntry = (entry: Entry): entry is CreateEntry =>
  "kind" in entry && entry.kind === "create";

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

  const result = useMemo(() => parsePresetQuery(query, presets), [query, presets]);

  const items = useMemo((): Entry[] => {
    switch (result.kind) {
      case "match":
        return result.presets;
      case "time":
        return [timeSentinel(result.time)];
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

  const currentLabel = todo.reminderTime
    ? reminderLabelFor(todo.reminderTime, presets)
    : "Add a reminder…";

  return (
    <div className="space-y-1.5">
      <Label htmlFor="todo-reminder-input">Reminder</Label>
      <div className="flex items-center gap-1.5">
        <Combobox
          items={items}
          value={null}
          onValueChange={(entry: Entry | null) => {
            if (!entry) return;
            if (isCreateEntry(entry)) {
              void createAndApply(entry.name, entry.time);
            } else if (isTimeEntry(entry)) {
              applyTime(entry.time);
            } else {
              applyTime(entry.time);
            }
            setQuery("");
          }}
          inputValue={query}
          onInputValueChange={setQuery}
          itemToStringLabel={(entry: Entry) =>
            isCreateEntry(entry) ? entry.name : isTimeEntry(entry) ? formatReminderTime(entry.time) : entry.name
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
