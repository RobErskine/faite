"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  createLabel,
  createList,
  createProject,
  createTodo,
  LOCAL_OWNER_ID,
} from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { createUndoStep, pushUndo, undoById } from "@/lib/undo";
import { deleteListWithUndo } from "./list-actions";
import { createTabWithUndo, deleteTabWithUndo } from "./tab-actions";
import { todayIn } from "@/lib/scheduling";
import { parseQuickAdd } from "@/lib/quick-add";
import { useMention, MentionMenu, type MentionSource } from "@/components/mention-menu";
import { searchTodos } from "@/lib/search";
import { cn } from "@/lib/utils";
import { PriorityRail, TitleMarkers, TodoMetaBadges } from "./todo-row-parts";
import { TITLE_CLAMP_CLASS } from "@/lib/title";
import type {
  Label as LabelRecord,
  List,
  ReminderPreset,
  Settings,
  Tab,
  Todo,
  TodoStatus,
} from "@/lib/schema";
import type { MentionLabelOption, MentionListOption, MentionPick } from "./board-column";
import { QuickAddPreview } from "./quick-add-preview";
import { detectPlatform, formatCombo, type Platform } from "@/lib/keyboard";

/** Never changes within a page's life — same rationale as `usePlatform` in todo-sheet.tsx. */
const subscribeToNothing = () => () => {};

/** Display-only platform sniff, client-safe — see todo-sheet.tsx's `usePlatform`. */
function usePlatform(): Platform {
  return useSyncExternalStore(subscribeToNothing, detectPlatform, () => "other");
}

/**
 * The status filter, in the same order and wording as the DateNav control —
 * one vocabulary for one setting, whichever surface you reach it through.
 */
const STATUS_FILTERS: ReadonlyArray<{ value: TodoStatus; label: string }> = [
  { value: "open", label: "todo items" },
  { value: "done", label: "completed items" },
  { value: "dropped", label: "items marked as won't do" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: List[];
  tabs: Tab[];
  todos: Todo[];
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P4) — quick-add vocabulary for "Create
   * to-do…" and the preview chips, same as `matchTime`'s numeric forms. */
  reminderPresets?: ReminderPreset[];
  settings: Settings | undefined;
  activeTabId: string;
  /** Series summaries keyed by `recurrenceParentId` — see `board.tsx`'s
   * `recurrenceSummaries`. Threaded in rather than computed here for the
   * same reason `TodoCard` takes it as a prop: only the template row knows
   * its own rule. */
  recurrenceSummaries?: Map<string, string>;
  /** Opens a search hit. Board owns which to-do the sheet is showing. */
  onSelectTodo: (todo: Todo) => void;
  /** Switches the planning half. Board owns where the active tab is stored. */
  onSelectTab: (tabId: string) => void;
  /** `⌘⏎` toggles done/open, `⌘⌫` marks won't-do, on the highlighted result. */
  onSetTodoStatus: (id: string, status: TodoStatus) => void;
  /** `⌘⇧⌫` on the highlighted result. */
  onDeleteTodo: (id: string) => void;
  /** How many to-dos are currently in Overflow — `board.overflow.todos.length`,
   * the same unfiltered count the column's own Overdrive button (EI-97) uses. */
  overflowCount: number;
  onOpenOverdrive: () => void;
  /** `?` opens the same sheet — see help-sheet.tsx. */
  onOpenHelp: () => void;
}

type Mode =
  | { kind: "root" }
  | { kind: "new-list" }
  | { kind: "new-label" }
  | { kind: "new-project" }
  | { kind: "new-tab" }
  | { kind: "new-todo" }
  | { kind: "delete-list" }
  | { kind: "delete-tab" };

/**
 * Keyboard-first entry point for everything that is not drag-and-drop.
 *
 * Radix's Command handles arrow navigation, type-ahead filtering, and the
 * listbox ARIA roles. Sub-modes reuse the same input rather than opening
 * nested dialogs, so creating a list never costs more than a few keystrokes.
 */
export function CommandPalette({
  open,
  onOpenChange,
  lists,
  tabs,
  todos,
  labels,
  reminderPresets = [],
  settings,
  activeTabId,
  recurrenceSummaries,
  onSelectTodo,
  onSelectTab,
  onSetTodoStatus,
  onDeleteTodo,
  overflowCount,
  onOpenOverdrive,
  onOpenHelp,
}: CommandPaletteProps) {
  const platform = usePlatform();
  const [mode, setMode] = useState<Mode>({ kind: "root" });
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [mentionedList, setMentionedList] = useState<MentionListOption | null>(null);
  const [mentionedLabels, setMentionedLabels] = useState<MentionLabelOption[]>([]);
  /** Same reason `board-column.tsx`'s quick-add row uses one: moves the DOM
   * caret only after the controlled input's value has actually updated. */
  const pendingCaretRef = useRef<number | null>(null);

  const query = value.trim();

  /**
   * Search runs only at the root. In the entry modes the input is a name being
   * typed, not a query, and in delete-list it filters that list instead.
   */
  const results = useMemo(
    () => (mode.kind === "root" ? searchTodos(query, todos) : []),
    [mode.kind, query, todos],
  );

  const today = useMemo(
    () => todayIn(settings?.timezone ?? "UTC"),
    [settings?.timezone],
  );

  /**
   * Parsed once, up front, and reused by both creation paths — the "Create
   * to-do" fallback in root mode and the New to-do entry mode both create
   * from `value`, so they must not be free to disagree on what it parses to.
   */
  const quickAdd = useMemo(
    () => parseQuickAdd(value, today, reminderPresets),
    [value, today, reminderPresets],
  );
  const showQuickAddPreview = mode.kind === "root" ? query.length > 0 : mode.kind === "new-todo";

  const listNameById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.name])),
    [lists],
  );

  /**
   * Quick-add's "@list" mention candidates — color-resolved the same way
   * `board.tsx`'s `mentionLists` is (own color, falling back to the tab's),
   * duplicated locally rather than threaded down as a prop: this component
   * already has both `lists` and `tabs`, and the two other things `lists` is
   * used for here (`listNameById`, `lists.find(l => l.isBacklog)`) need the
   * full record, not this lighter shape.
   */
  const tabsById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const mentionListOptions = useMemo(
    (): MentionListOption[] =>
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        color: list.color ?? (list.tabId ? (tabsById.get(list.tabId)?.color ?? null) : null),
      })),
    [lists, tabsById],
  );

  const mentionedLabelIds = useMemo(() => new Set(mentionedLabels.map((l) => l.id)), [mentionedLabels]);

  /**
   * Only live where typed text becomes a todo — root's search box (via the
   * "Create to-do" fallback) and the "New to-do" entry mode. An empty source
   * list keeps `useMention` permanently closed everywhere else, rather than
   * gating the hook call itself (hooks cannot be conditional).
   */
  const mentionSources = useMemo((): MentionSource<MentionPick>[] => {
    if (mode.kind !== "root" && mode.kind !== "new-todo") return [];
    return [
      {
        trigger: "@",
        items: mentionListOptions.map((list) => ({
          id: list.id,
          label: list.name,
          data: { kind: "list" as const, list },
        })),
      },
      {
        trigger: "#",
        items: labels
          .filter((label) => !mentionedLabelIds.has(label.id))
          .map((label) => ({
            id: label.id,
            label: label.emoji ? `${label.emoji} ${label.name}` : label.name,
            data: { kind: "label" as const, label },
          })),
        onNoMatch: (q) => ({
          id: "__create-label__",
          label: `Create label "${q}"`,
          data: { kind: "create-label" as const, name: q },
        }),
      },
    ];
  }, [mode.kind, mentionListOptions, labels, mentionedLabelIds]);
  const mention = useMention({ value, cursor, sources: mentionSources });

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    inputRef.current?.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    pendingCaretRef.current = null;
  });

  const syncCursor = (el: HTMLInputElement) => setCursor(el.selectionStart ?? el.value.length);

  const applyMention = async (resolved: ReturnType<typeof mention.resolve>) => {
    setValue(resolved.text);
    setCursor(resolved.caretIndex);
    pendingCaretRef.current = resolved.caretIndex;

    const pick = resolved.item.data;
    if (pick.kind === "list") setMentionedList(pick.list);
    else if (pick.kind === "label") setMentionedLabels((ls) => [...ls, pick.label]);
    else if (pick.kind === "create-label") {
      const id = await createLabel(pick.name);
      setMentionedLabels((ls) => [...ls, { id, name: pick.name, color: null, emoji: null }]);
    }
  };

  /**
   * Reset to the root menu on dismissal.
   *
   * Done in the change handler rather than an effect on `open` — syncing state
   * to a prop in an effect causes a cascading render, which React 19 lints
   * against.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode({ kind: "root" });
      setValue("");
      setCursor(0);
      setMentionedList(null);
      setMentionedLabels([]);
    }
    onOpenChange(next);
  };

  const close = () => handleOpenChange(false);

  /**
   * Undoing a create is the same soft delete `remove()` performs.
   *
   * These toasts already existed; they gain an Undo button rather than a new
   * notification. Worth having even though a create is not destructive: the
   * palette can drop a row into a column that is scrolled out of view, so
   * the toast is the only place the user sees it happen.
   */
  const recordCreate = (
    label: string,
    kind: "todo" | "list" | "label" | "project",
    id: string,
  ) => {
    const entryId = pushUndo(label, [createUndoStep(kind, id)]);
    toast.success(label, {
      action: { label: "Undo", onClick: () => void undoById(entryId) },
    });
  };

  /**
   * Files a to-do titled with whatever was typed — into Backlog, unless the
   * "@list" mention picked somewhere else.
   */
  const createFromQuery = async () => {
    const backlog = lists.find((l) => l.isBacklog);
    const listId = mentionedList?.id ?? backlog?.id ?? null;
    recordCreate(
      `To-do added to ${mentionedList?.name ?? "Backlog"}`,
      "todo",
      await createTodo({
        title: quickAdd.title,
        listId,
        scheduledDate: quickAdd.scheduledDate,
        deadline: quickAdd.deadline,
        priority: quickAdd.priority,
        reminderTime: quickAdd.reminderTime,
        labelIds: mentionedLabels.map((l) => l.id),
      }),
    );
    close();
  };

  const submit = async () => {
    const name = value.trim();
    if (!name && mode.kind !== "root") return;

    switch (mode.kind) {
      case "new-list":
        // Lands on the tab currently showing, matching the create-list column.
        recordCreate(
          `List "${name}" created`,
          "list",
          await createList(name, {}, activeTabId),
        );
        break;
      case "new-tab":
        // Delegated rather than routed through recordCreate: creating a tab is
        // also a navigation, and switching to it is what makes it visible.
        onSelectTab(await createTabWithUndo(name));
        break;
      case "new-label":
        recordCreate(`Label "${name}" created`, "label", await createLabel(name));
        break;
      case "new-project":
        recordCreate(
          `Project "${name}" created`,
          "project",
          await createProject(name),
        );
        break;
      case "new-todo": {
        const backlog = lists.find((l) => l.isBacklog);
        const listId = mentionedList?.id ?? backlog?.id ?? null;
        recordCreate(
          `To-do added to ${mentionedList?.name ?? "Backlog"}`,
          "todo",
          await createTodo({
            title: quickAdd.title,
            listId,
            scheduledDate: quickAdd.scheduledDate,
            deadline: quickAdd.deadline,
            priority: quickAdd.priority,
            reminderTime: quickAdd.reminderTime,
            labelIds: mentionedLabels.map((l) => l.id),
          }),
        );
        break;
      }
      default:
        return;
    }
    close();
  };

  /**
   * The id of the row cmdk currently has selected, read straight off the
   * DOM the way cmdk itself resolves it (its internal `aria-selected`
   * lookup) rather than by controlling `<Command value>` — a controlled
   * value that stops matching any item leaves nothing selected, since
   * cmdk's "select first" only runs when the value is empty.
   */
  const highlightedTodoId = () =>
    listRef.current
      ?.querySelector('[cmdk-item][aria-selected="true"]')
      ?.getAttribute("data-todo-id") ?? null;

  const placeholder =
    mode.kind === "new-list"
      ? "List name…"
      : mode.kind === "new-label"
        ? "Label name…"
        : mode.kind === "new-project"
          ? "Project name…"
          : mode.kind === "new-tab"
            ? "Tab name…"
            : mode.kind === "new-todo"
              ? "What needs doing?"
              : "Search to-dos or run a command…";

  /** The picker modes filter an existing set; the rest take free text. */
  const isEntryMode =
    mode.kind !== "root" &&
    mode.kind !== "delete-list" &&
    mode.kind !== "delete-tab";

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Create and manage to-dos, lists, labels, and projects"
      className="sm:max-w-2xl"
    >
      {/*
        CommandDialog renders children straight into DialogContent without a
        <Command> wrapper, so the cmdk context has to be established here or
        CommandInput has no store to subscribe to.

        shouldFilter is off in entry modes: there the input is free text (a new
        list name), not a search query, and cmdk's built-in filtering would hide
        the single "create" item as soon as the typed value stopped matching.
      */}
      <Command shouldFilter={!isEntryMode}>
      <div className="relative">
        <CommandInput
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onValueChange={(next) => {
            setValue(next);
            setCursor(inputRef.current?.selectionStart ?? next.length);
          }}
          onSelect={(e) => syncCursor(e.currentTarget)}
          onKeyDown={(e) => {
            if (mention.isOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                mention.moveHighlight(1);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                mention.moveHighlight(-1);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const resolved = mention.resolveHighlighted();
                if (resolved) void applyMention(resolved);
                return;
              }
              if (e.key === "Escape") {
                // Closes the popover only — same as quick-add's row. A second
                // Escape (mention now closed) falls through to the existing
                // "back to root" case below.
                e.preventDefault();
                mention.dismiss();
                return;
              }
            }

            /*
              Row actions on the highlighted to-do — ⌘⏎ toggles done/open,
              ⌘⌫ marks won't-do, ⌘⇧⌫ deletes. Mirrors `TodoSheet`'s bindings
              (`todo-sheet.tsx`), with one deliberate divergence: the sheet
              exempts text-entry targets from ⌘⌫ because that combo means
              "delete to line start" natively. This input IS the palette's
              only focus target, so exempting it would just disable the
              shortcut outright — the override is intentional here.
            */
            const modOnly = e.metaKey !== e.ctrlKey && !e.altKey;
            if (mode.kind === "root" && modOnly && (e.key === "Enter" || e.key === "Backspace")) {
              const id = highlightedTodoId();
              const todo = id ? todos.find((t) => t.id === id) : undefined;
              if (todo) {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSetTodoStatus(todo.id, todo.status === "done" ? "open" : "done");
                  return;
                }
                if (e.key === "Backspace") {
                  e.preventDefault();
                  if (e.shiftKey) onDeleteTodo(todo.id);
                  else onSetTodoStatus(todo.id, "dropped");
                  return;
                }
              }
            }

            if (e.key === "Enter" && isEntryMode) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape" && mode.kind !== "root") {
              e.preventDefault();
              setMode({ kind: "root" });
              setValue("");
            }
          }}
        />
        {mention.isOpen && (
          <MentionMenu
            results={mention.results}
            highlightedIndex={mention.highlightedIndex}
            onHighlight={mention.setHighlightedIndex}
            onSelect={(item) => void applyMention(mention.resolve(item))}
            side="down"
            ariaLabel={mention.sigil === "#" ? "Labels" : "Lists"}
          />
        )}
      </div>
      {showQuickAddPreview && (
        <QuickAddPreview
          chips={[
            ...quickAdd.matches.map((m) => ({ key: `${m.kind}:${m.raw}`, label: m.label })),
            ...(mentionedList
              ? [
                  {
                    key: `list:${mentionedList.id}`,
                    label: `→ ${mentionedList.name}`,
                    color: mentionedList.color,
                  },
                ]
              : []),
            ...mentionedLabels.map((label) => ({
              key: `label:${label.id}`,
              label: label.emoji ? `#${label.emoji} ${label.name}` : `#${label.name}`,
              color: label.color,
              onRemove: () =>
                setMentionedLabels((ls) => ls.filter((l) => l.id !== label.id)),
            })),
          ]}
        />
      )}
      <CommandList ref={listRef} className="max-h-[60vh]">
        {isEntryMode ? (
          <CommandGroup heading="Press Enter to create">
            <CommandItem onSelect={() => void submit()} disabled={!value.trim()}>
              {(mode.kind === "new-todo" ? quickAdd.title : value.trim()) || "Start typing…"}
            </CommandItem>
          </CommandGroup>
        ) : mode.kind === "delete-list" ? (
          <>
            <CommandEmpty>No lists found.</CommandEmpty>
            <CommandGroup heading="Delete a list (its to-dos move to Backlog)">
              {lists
                .filter((l) => !l.isBacklog)
                .map((list) => (
                  <CommandItem
                    key={list.id}
                    onSelect={async () => {
                      // Shared with the column header's list dialog so the two
                      // entry points cannot diverge. See ./list-actions.
                      await deleteListWithUndo(list);
                      close();
                    }}
                  >
                    {list.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        ) : mode.kind === "delete-tab" ? (
          <>
            <CommandEmpty>No tabs found.</CommandEmpty>
            <CommandGroup heading="Delete a tab (its lists move to your default tab)">
              {tabs
                .filter((t) => !t.isDefault)
                .map((tab) => (
                  <CommandItem
                    key={tab.id}
                    onSelect={async () => {
                      // Shared with the tab dialog, same reason as lists.
                      await deleteTabWithUndo(tab);
                      close();
                    }}
                  >
                    {tab.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        ) : (
          <>
            <CommandEmpty>No results found.</CommandEmpty>

            {results.length > 0 ? (
              <>
                <CommandGroup heading="To-dos">
                  {results.map((todo) => (
                    <CommandItem
                      key={todo.id}
                      /*
                        Titles repeat ("Follow up"), and cmdk keys its
                        selection off `value` — so the id rides along to keep
                        rows distinct. It also scores the value, hence title
                        first. The description travels as a keyword so
                        description-only hits survive cmdk's own filter.
                      */
                      value={`${todo.title} ${todo.id}`}
                      keywords={todo.description ? [todo.description] : undefined}
                      // How the row-action shortcuts (⌘⏎/⌘⌫/⌘⇧⌫) find the
                      // highlighted to-do without controlling `<Command value>`.
                      data-todo-id={todo.id}
                      onSelect={() => {
                        onSelectTodo(todo);
                        close();
                      }}
                      className="items-start overflow-hidden py-2 pl-4"
                    >
                      <PriorityRail priority={todo.priority} />
                      <span className="min-w-0 flex-1 text-sm leading-snug">
                        <span
                          className={cn(
                            "wrap-break-word",
                            TITLE_CLAMP_CLASS,
                            todo.status !== "open" && "text-muted-foreground",
                            todo.status === "done" && "line-through",
                            todo.status === "dropped" && "opacity-70",
                          )}
                        >
                          <TitleMarkers
                            todo={todo}
                            today={today}
                            recurrenceSummary={
                              todo.recurrenceParentId
                                ? recurrenceSummaries?.get(todo.recurrenceParentId)
                                : undefined
                            }
                          />
                          {todo.title}
                        </span>
                        <TodoMetaBadges
                          todo={todo}
                          labels={labels}
                          today={today}
                          showScheduledDate
                        />
                      </span>
                      <span className="ml-auto shrink-0 self-center text-xs text-muted-foreground">
                        {listNameById.get(todo.listId ?? "") ?? "Unfiled"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
              </>
            ) : null}

            <CommandGroup heading="Create">
              {/*
                The fallback the whole search exists for: nothing matched what
                you typed, so turn it into the to-do instead of making you
                retype it behind "New to-do".
              */}
              {query ? (
                <CommandItem
                  value={`Create to-do ${query}`}
                  onSelect={() => void createFromQuery()}
                >
                  Create to-do “{quickAdd.title}”
                </CommandItem>
              ) : null}
              <CommandItem onSelect={() => { setMode({ kind: "new-todo" }); setValue(""); }}>
                New to-do
              </CommandItem>
              <CommandItem onSelect={() => { setMode({ kind: "new-list" }); setValue(""); }}>
                New list
              </CommandItem>
              <CommandItem onSelect={() => { setMode({ kind: "new-label" }); setValue(""); }}>
                New label
              </CommandItem>
              <CommandItem onSelect={() => { setMode({ kind: "new-project" }); setValue(""); }}>
                New project
              </CommandItem>
              <CommandItem onSelect={() => { setMode({ kind: "new-tab" }); setValue(""); }}>
                New tab
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/*
              Switching by name, for when the strip has scrolled or there are
              more tabs than fit. The active one is listed too — cheaper to read
              past than to explain its absence.
            */}
            {tabs.length > 1 ? (
              <>
                <CommandGroup heading="Tabs">
                  {tabs.map((tab) => (
                    <CommandItem
                      key={tab.id}
                      value={`Switch to tab ${tab.name}`}
                      onSelect={() => {
                        onSelectTab(tab.id);
                        close();
                      }}
                    >
                      {tab.name}
                      {tab.id === activeTabId ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          current
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
              </>
            ) : null}

            <CommandGroup heading="Manage">
              <CommandItem onSelect={() => { setMode({ kind: "delete-list" }); setValue(""); }}>
                Delete a list…
              </CommandItem>
              <CommandItem onSelect={() => { setMode({ kind: "delete-tab" }); setValue(""); }}>
                Delete a tab…
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onOpenHelp();
                  close();
                }}
              >
                Keyboard shortcuts
                <CommandShortcut>{formatCombo("shift+slash", platform)}</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="View">
              {[1, 3, 5, 7].map((days) => (
                <CommandItem
                  key={days}
                  // On the item, not a wrapper span: CommandItem is a flex row
                  // with a gap, so a span would break the phrase into columns.
                  // font-variant-numeric inherits, and `nums` keeps the body font.
                  className="nums"
                  onSelect={async () => {
                    await mutateSettings(LOCAL_OWNER_ID, { visibleDays: days });
                    close();
                  }}
                >
                  Show {days} day{days > 1 ? "s" : ""}
                  {settings?.visibleDays === days ? " (current)" : ""}
                </CommandItem>
              ))}
              {/*
                Mirrors the status checkboxes in the DateNav's ViewSettings.
                Same guard, too: the last remaining status cannot be turned
                off, because an empty board looks broken rather than filtered.
              */}
              {STATUS_FILTERS.map((option) => {
                const current = settings?.visibleStatuses ?? ["open"];
                const on = current.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    disabled={on && current.length <= 1}
                    onSelect={async () => {
                      const next = on
                        ? current.filter((s) => s !== option.value)
                        : STATUS_FILTERS.filter(
                            (o) => o.value === option.value || current.includes(o.value),
                          ).map((o) => o.value);
                      if (next.length === 0) return;
                      await mutateSettings(LOCAL_OWNER_ID, { visibleStatuses: next });
                      close();
                    }}
                  >
                    {on ? "Hide" : "Show"} {option.label}
                  </CommandItem>
                );
              })}
              <CommandItem
                onSelect={async () => {
                  const next = !(settings?.showWeekends ?? true);
                  await mutateSettings(LOCAL_OWNER_ID, { showWeekends: next });
                  toast.success(
                    next ? "Weekends shown" : "Weekends collapsed into a strip",
                  );
                  close();
                }}
              >
                {settings?.showWeekends === false ? "Show weekends" : "Hide weekends"}
              </CommandItem>
              <CommandItem
                onSelect={async () => {
                  await mutateSettings(LOCAL_OWNER_ID, {
                    workdaysOnly: !settings?.workdaysOnly,
                  });
                  toast.success(
                    settings?.workdaysOnly
                      ? "Rollover uses every day"
                      : "Rollover skips weekends",
                  );
                  close();
                }}
              >
                {settings?.workdaysOnly
                  ? "Roll over on every day"
                  : "Roll over on workdays only"}
              </CommandItem>
              <CommandItem
                disabled={overflowCount === 0}
                onSelect={() => {
                  onOpenOverdrive();
                  close();
                }}
              >
                {overflowCount > 0 ? `Open Overdrive (${overflowCount})` : "Overdrive — Overflow is empty"}
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
      {mode.kind === "root" && results.length > 0 ? (
        <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{formatCombo("mod+enter", platform)} complete</span>
          <span>{formatCombo("mod+backspace", platform)} won&apos;t do</span>
          <span>{formatCombo("shift+mod+backspace", platform)} delete</span>
        </div>
      ) : null}
      </Command>
    </CommandDialog>
  );
}
