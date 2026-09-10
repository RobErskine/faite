"use client";

import { useMemo, useState } from "react";
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
import type { List, Tab, Todo } from "@/lib/schema";

/** The "put this nowhere" row. An object rather than a string sentinel, so it
 * shares `Entry`'s shape and needs no separate branch in `onValueChange`. */
const NONE_ENTRY = { kind: "none" as const };
type NoneEntry = typeof NONE_ENTRY;

interface ListEntry {
  kind: "list";
  list: List;
  /** The owning tab's name. Null for Backlog, which is pinned into every tab
   * (`List.tabId` null) rather than owned by one. */
  tabName: string | null;
}

type Entry = NoneEntry | ListEntry;

const isNone = (entry: Entry): entry is NoneEntry => entry.kind === "none";

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
 * 4. **A "None" row**, to unfile.
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
    if (q === "") return [NONE_ENTRY, ...entries];
    const matched = entries.filter(
      (entry) =>
        entry.list.name.toLowerCase().includes(q) ||
        (entry.tabName?.toLowerCase().includes(q) ?? false),
    );
    // "None" is an action, not a list, so it only shows when the field is
    // resting — a search for "gro" offering to unfile the to-do would be a
    // destructive row nobody was looking for.
    return matched;
  }, [entries, query]);

  const current = todo.listId ? listsById.get(todo.listId) : undefined;
  const restingLabel = todo.listId
    ? current
      ? listLabel(current, tabsById)
      : "Archived list"
    : "None";

  return (
    <Combobox
      items={items}
      value={null}
      onValueChange={(entry: Entry | null) => {
        if (!entry) return;
        onSave(todo.id, { listId: isNone(entry) ? null : entry.list.id });
        setQuery("");
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(entry: Entry) =>
        isNone(entry) ? "None" : listLabel(entry.list, tabsById)
      }
      filter={null}
      openOnInputClick
    >
      <ComboboxInput
        id="todo-list"
        placeholder={restingLabel}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup>
            {/* Always mounted — see ComboboxEmpty's own comment for why
                skipping it lets Escape bubble past this popup and close the
                whole sheet instead of just the popup. */}
            <ComboboxEmpty>No lists match.</ComboboxEmpty>
            <ComboboxList>
              {(entry: Entry) =>
                isNone(entry) ? (
                  <ComboboxItem key="none" value={entry} className="text-muted-foreground">
                    None
                  </ComboboxItem>
                ) : (
                  <ComboboxItem key={entry.list.id} value={entry}>
                    {entry.list.emoji ? `${entry.list.emoji} ` : ""}
                    {entry.list.name}
                    {entry.tabName && (
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        {entry.tabName}
                      </span>
                    )}
                  </ComboboxItem>
                )
              }
            </ComboboxList>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  );
}
