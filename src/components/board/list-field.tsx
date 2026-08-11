"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { List, Tab, Todo } from "@/lib/schema";

const NONE = "__none__";

interface ListFieldProps {
  todo: Todo;
  /** Live, non-archived lists across EVERY tab — not just the active one. */
  lists: List[];
  tabs: Tab[];
  onSave: (id: string, patch: Partial<Todo>) => void;
}

/**
 * "{tabName} > {listName}" — Backlog excepted, since it's pinned into every
 * tab (`List.tabId` null) rather than owned by one, so prefixing it with a
 * tab would misname it.
 */
function listLabel(list: List, tabsById: ReadonlyMap<string, Tab>): string {
  const name = list.emoji ? `${list.emoji} ${list.name}` : list.name;
  if (list.isBacklog) return name;
  const tab = list.tabId ? tabsById.get(list.tabId) : undefined;
  return tab ? `${tab.name} > ${name}` : name;
}

/**
 * The "List" field, grouped into sections by tab — "My Lists / Brain Dump,
 * Grocery List", "Work / Project 1, Project 2", etc. — with Backlog pinned
 * ungrouped at the top, matching how it's pinned leftmost on the board
 * itself.
 *
 * Base UI's `Select.Value` renders the raw `value` string by default (an id
 * or seed slug) unless given a way to resolve a label — there is no path
 * from a `<Select.Item>`'s JSX children back to the closed trigger. This
 * uses the function-as-children form (`<SelectValue>{(value) => ...}</SelectValue>`)
 * rather than the `items` prop, since it also needs to render something
 * sensible for a DANGLING reference: archiving a list (unlike deleting one)
 * leaves every todo's `listId` pointing at it unchanged, and `lists` here —
 * like `useLists()` everywhere else — excludes archived rows, so that id
 * has no entry to resolve a label from at all.
 */
export function ListField({ todo, lists, tabs, onSave }: ListFieldProps) {
  const tabsById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const listsById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const backlog = useMemo(() => lists.find((l) => l.isBacklog), [lists]);
  const listsByTab = useMemo(() => {
    const map = new Map<string, List[]>();
    for (const list of lists) {
      if (list.isBacklog || !list.tabId) continue;
      const bucket = map.get(list.tabId);
      if (bucket) bucket.push(list);
      else map.set(list.tabId, [list]);
    }
    return map;
  }, [lists]);

  return (
    <Select
      value={todo.listId ?? NONE}
      onValueChange={(v) => onSave(todo.id, { listId: v === NONE ? null : v })}
    >
      <SelectTrigger id="todo-list">
        <SelectValue>
          {(value: string) => {
            if (value === NONE) return "None";
            const list = listsById.get(value);
            return list ? listLabel(list, tabsById) : "Archived list";
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {backlog && <SelectItem value={backlog.id}>{listLabel(backlog, tabsById)}</SelectItem>}
        {tabs.map((tab) => {
          const tabLists = listsByTab.get(tab.id);
          if (!tabLists || tabLists.length === 0) return null;
          return (
            <SelectGroup key={tab.id}>
              <SelectLabel>{tab.name}</SelectLabel>
              {tabLists.map((list) => (
                <SelectItem key={list.id} value={list.id}>
                  {list.emoji ? `${list.emoji} ` : ""}
                  {list.name}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
