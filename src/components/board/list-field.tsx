"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
} from "@/components/ui/combobox";
import type { List, Tab, Todo } from "@/lib/schema";

interface ListEntry {
  kind: "list";
  list: List;
  /** The owning tab's name. Null for Backlog, which is pinned into every tab
   * (`List.tabId` null) rather than owned by one. */
  tabName: string | null;
}

type Entry = ListEntry;

interface ListFieldProps {
  todo: Todo;
  /** Live, non-archived lists across EVERY tab — not just the active one. */
  lists: List[];
  tabs: Tab[];
  onSave: (id: string, patch: Partial<Todo>) => void;
}

/**
 * "{tabName} > {listName}" — Backlog excepted, since it's pinned into every
 * tab rather than owned by one, so prefixing it with a tab would misname it.
 */
function listLabel(list: List, tabsById: ReadonlyMap<string, Tab>): string {
  const name = list.emoji ? `${list.emoji} ${list.name}` : list.name;
  if (list.isBacklog) return name;
  const tab = list.tabId ? tabsById.get(list.tabId) : undefined;
  return tab ? `${tab.name} > ${name}` : name;
}

/**
 * The "List" field: type to search every list you have, across every tab.
 *
 * Was a `Select` (EI-62), which meant scrolling a full inventory of lists to
 * file one to-do. Now a `Combobox` in **single** mode, built the way
 * `ReminderPicker` is — `value={null}` because `todo.listId` is the single
 * source of truth, `filter={null}` because the filtering happens in `items`,
 * and the current selection shown as the input's PLACEHOLDER rather than as
 * text, the same "current state as resting text" pattern the reminder and
 * label pickers already use.
 *
 * ## Four things that had to survive the rewrite
 *
 * 1. **"{tab} > {list}" at rest.** Load-bearing now that the sheet's derived
 *    Tab field is gone (EI-318): this trigger is the only place a to-do's tab
 *    is stated, and it was only safe to delete that field because this says
 *    the same thing.
 * 2. **The dangling reference.** Archiving a list (unlike deleting one)
 *    leaves every to-do's `listId` pointing at it, and `lists` here — like
 *    `useLists()` everywhere else — excludes archived rows. That id resolves
 *    to nothing, and must read "Archived list" rather than blank.
 * 3. **Backlog pinned first, unprefixed**, matching how it is pinned leftmost
 *    on the board.
 * 4. **A way to unfile.** Was a "None" row; it is the chip's own X now — see
 *    below.
 *
 * ## The selection is a chip, not the placeholder
 *
 * It read as placeholder text at first, which is how the reminder and label
 * pickers show their current state — and it was wrong here for a reason
 * neither of those has: placeholder text is not a control. There was no way
 * to take a to-do OUT of a list at all, short of picking a different one, and
 * a greyed-out "My Lists > To Read" looks like an empty field rather than a
 * filled one. A chip with an X says both things at once.
 *
 * Clearing writes `listId: null`, which files the to-do under **Backlog** —
 * `groupTodosByList` (lib/board.ts) has always resolved "no list, or a
 * pointer at a deleted one" that way rather than letting a card vanish. That
 * is what "remove it from this list" means here, and why there is no separate
 * "move to Backlog" row.
 *
 * ## Why the tab is on every row instead of a group header
 *
 * The `Select` grouped lists under a heading per tab. A filtered list cannot:
 * once "proj" has narrowed six tabs down to two rows, a heading is either
 * re-rendered per surviving group (noise, at one row each) or stale. Naming
 * the tab on the row itself survives filtering, and is what lets the query
 * match a TAB name too — typing "Work" surfaces every list in Work, which is
 * how people actually look for a list they cannot name exactly.
 */
export function ListField({ todo, lists, tabs, onSave }: ListFieldProps) {
  const [query, setQuery] = useState("");

  const tabsById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const listsById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  /** Backlog first, then tab by tab in board order, lists in their own order. */
  const entries = useMemo<ListEntry[]>(() => {
    const backlog = lists.filter((l) => l.isBacklog);
    const byTab = tabs.flatMap((tab) =>
      lists.filter((l) => !l.isBacklog && l.tabId === tab.id).map((list) => ({
        kind: "list" as const,
        list,
        tabName: tab.name,
      })),
    );
    // A list whose tab has been archived still has to be reachable, or the
    // only way to move a to-do out of it is to know its name by heart.
    const orphaned = lists
      .filter((l) => !l.isBacklog && (!l.tabId || !tabsById.has(l.tabId)))
      .map((list) => ({ kind: "list" as const, list, tabName: null }));
    return [
      ...backlog.map((list) => ({ kind: "list" as const, list, tabName: null })),
      ...byTab,
      ...orphaned,
    ];
  }, [lists, tabs, tabsById]);

  const items = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return entries;
    return entries.filter(
      (entry) =>
        entry.list.name.toLowerCase().includes(q) ||
        (entry.tabName?.toLowerCase().includes(q) ?? false),
    );
  }, [entries, query]);

  const current = todo.listId ? listsById.get(todo.listId) : undefined;
  // A dangling id — its list was archived — still has to read as SOMETHING.
  const chipLabel = todo.listId
    ? current
      ? listLabel(current, tabsById)
      : "Archived list"
    : null;

  return (
    <Combobox
      items={items}
      value={null}
      onValueChange={(entry: Entry | null) => {
        if (!entry) return;
        onSave(todo.id, { listId: entry.list.id });
        setQuery("");
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(entry: Entry) => listLabel(entry.list, tabsById)}
      filter={null}
      openOnInputClick
      // Highlights the first row as soon as there is one, so Enter commits it.
      // Without this, typing a query that leaves exactly one list and pressing
      // Enter cleared the field instead of picking it — the combobox had
      // nothing highlighted to commit, which is the opposite of what one
      // remaining match means.
      autoHighlight
    >
      <ComboboxChips className="min-h-9 px-2">
        {chipLabel && (
          <ComboboxChip className="border-border bg-muted">
            {chipLabel}
            <button
              type="button"
              // Not `ComboboxChipRemove`, which removes from the value ARRAY
              // this single-mode field deliberately does not keep — the todo
              // is the truth. Same glyph and hit area.
              aria-label={`Remove from ${chipLabel}`}
              onClick={() => onSave(todo.id, { listId: null })}
              className="rounded-full p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-2.5" aria-hidden />
            </button>
          </ComboboxChip>
        )}
        <ComboboxInput
          id="todo-list"
          placeholder={chipLabel ? "Move to…" : "Search lists…"}
        />
      </ComboboxChips>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup>
            {/* Always mounted — see ComboboxEmpty's own comment for why
                skipping it lets Escape bubble past this popup and close the
                whole sheet instead of just the popup. */}
            <ComboboxEmpty>No lists match.</ComboboxEmpty>
            <ComboboxList>
              {(entry: Entry) => (
                <ComboboxItem key={entry.list.id} value={entry}>
                  {entry.list.emoji ? `${entry.list.emoji} ` : ""}
                  {entry.list.name}
                  {entry.tabName && (
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">
                      {entry.tabName}
                    </span>
                  )}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  );
}
