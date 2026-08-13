"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  useComboboxFilter,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { createLabel } from "@/lib/store/repositories";
import { edge, tint } from "@/lib/colors";
import type { Label as LabelRecord, Todo } from "@/lib/schema";

/** Same sentinel-item trick `LocationField` uses to keep "create new" reachable
 * by keyboard — except the query is baked into the entry itself, computed
 * fresh every render, rather than read back out of `query` state at pick
 * time: `onValueChange` and `onInputValueChange` both fire out of the same
 * click, and reading a shared `query` closure from inside the former risks
 * racing whichever already cleared it. */
function createSentinel(name: string) {
  return { kind: "create" as const, name };
}
type CreateEntry = ReturnType<typeof createSentinel>;
type LabelEntry = LabelRecord | CreateEntry;

const isCreateEntry = (entry: LabelEntry): entry is CreateEntry =>
  "kind" in entry && entry.kind === "create";

interface LabelPickerProps {
  todo: Todo;
  labels: LabelRecord[];
  onToggleLabel: (todoId: string, labelId: string) => void;
}

/**
 * Type-ahead, chip-based replacement for the old flat grid of toggle badges
 * — that grid rendered every label in the workspace at once, which stops
 * being usable once a user has dozens of them. This narrows to a filtered
 * dropdown and renders only what's applied, as removable chips.
 *
 * Built on `Combobox` (`ui/combobox.tsx`) in `multiple` mode rather than
 * `Autocomplete` (which `LocationField` uses) — see that file's header
 * comment for why: `Autocomplete` always overwrites the input with a picked
 * item's name, which fights a field that's supposed to clear itself and
 * accumulate chips. `Combobox`'s value is the applied labels themselves
 * (`todo.labelIds`, projected through `labels`), always controlled from the
 * todo, not a separate local selection — `onValueChange` just diffs the
 * next array against the current one and calls `onToggleLabel` per
 * difference, so this component owns no selection state of its own, only
 * the in-progress query text.
 */
export function LabelPicker({ todo, labels, onToggleLabel }: LabelPickerProps) {
  const [query, setQuery] = useState("");
  const { contains } = useComboboxFilter({ sensitivity: "base" });

  const appliedLabels = useMemo(
    () => labels.filter((l) => todo.labelIds.includes(l.id)),
    [labels, todo.labelIds],
  );

  const items = useMemo((): LabelEntry[] => {
    const q = query.trim();
    const available = labels.filter((l) => !todo.labelIds.includes(l.id));
    const matches = q ? available.filter((l) => contains(l.name, q)) : available;
    if (!q) return matches;
    // No create row once an existing label — applied or not — already has
    // this exact name; offering to create a duplicate would be a trap.
    const hasExactMatch = labels.some((l) => l.name.toLowerCase() === q.toLowerCase());
    return hasExactMatch ? matches : [...matches, createSentinel(q)];
  }, [labels, todo.labelIds, query, contains]);

  const createAndApply = async (name: string) => {
    const id = await createLabel(name);
    onToggleLabel(todo.id, id);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="todo-label-input">Labels</Label>

      <Combobox
        items={items}
        multiple
        value={appliedLabels}
        onValueChange={(next: LabelEntry[]) => {
          const sentinel = next.find(isCreateEntry);
          if (sentinel) void createAndApply(sentinel.name);

          const picked = next.filter((entry): entry is LabelRecord => !isCreateEntry(entry));
          const nextIds = new Set(picked.map((l) => l.id));
          for (const label of appliedLabels) {
            if (!nextIds.has(label.id)) onToggleLabel(todo.id, label.id);
          }
          for (const label of picked) {
            if (!todo.labelIds.includes(label.id)) onToggleLabel(todo.id, label.id);
          }
        }}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(entry: LabelEntry) => entry.name}
        filter={null}
        openOnInputClick
      >
        <ComboboxChips>
          {appliedLabels.map((label) => (
            <ComboboxChip
              key={label.id}
              style={
                label.color
                  ? { backgroundColor: tint(label.color), borderColor: edge(label.color), color: label.color }
                  : undefined
              }
            >
              {label.emoji ? `${label.emoji} ` : ""}
              {label.name}
              <ComboboxChipRemove aria-label={`Remove ${label.name}`} />
            </ComboboxChip>
          ))}
          <ComboboxInput
            id="todo-label-input"
            placeholder={appliedLabels.length === 0 ? "Type to add a label…" : "Add a label…"}
          />
        </ComboboxChips>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              {/* Always mounted — see ComboboxEmpty's own comment for why
                  skipping it lets Escape bubble past this popup and close
                  the whole sheet instead of just the popup. */}
              <ComboboxEmpty>No labels match.</ComboboxEmpty>
              <ComboboxList>
                {(entry: LabelEntry) =>
                  isCreateEntry(entry) ? (
                    <ComboboxItem key="create" value={entry} className="text-muted-foreground">
                      <Plus className="size-3.5" aria-hidden />
                      Create label “{entry.name}”
                    </ComboboxItem>
                  ) : (
                    <ComboboxItem key={entry.id} value={entry}>
                      {entry.emoji ? `${entry.emoji} ` : ""}
                      {entry.name}
                    </ComboboxItem>
                  )
                }
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  );
}
