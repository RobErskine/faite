"use client";

import { useMemo, useState } from "react";
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
} from "@/components/ui/command";
import {
  createLabel,
  createList,
  createProject,
  createTodo,
  deleteList,
  LOCAL_OWNER_ID,
} from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { createUndoStep, deleteListUndoSteps, pushUndo, undoById } from "@/lib/undo";
import { DEFAULT_FONT_PAIRING, FONT_PAIRINGS } from "@/lib/fonts";
import { formatShortDate } from "@/lib/scheduling";
import { searchTodos } from "@/lib/search";
import type { List, Settings, Todo } from "@/lib/schema";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: List[];
  todos: Todo[];
  settings: Settings | undefined;
  /** Opens a search hit. Board owns which to-do the sheet is showing. */
  onSelectTodo: (todo: Todo) => void;
}

type Mode =
  | { kind: "root" }
  | { kind: "new-list" }
  | { kind: "new-label" }
  | { kind: "new-project" }
  | { kind: "new-todo" }
  | { kind: "delete-list" };

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
  todos,
  settings,
  onSelectTodo,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>({ kind: "root" });
  const [value, setValue] = useState("");

  const query = value.trim();

  /**
   * Search runs only at the root. In the entry modes the input is a name being
   * typed, not a query, and in delete-list it filters that list instead.
   */
  const results = useMemo(
    () => (mode.kind === "root" ? searchTodos(query, todos) : []),
    [mode.kind, query, todos],
  );

  const listNameById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.name])),
    [lists],
  );

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

  /** Files a to-do straight into Backlog, titled with whatever was typed. */
  const createFromQuery = async () => {
    const backlog = lists.find((l) => l.isBacklog);
    recordCreate(
      "To-do added to Backlog",
      "todo",
      await createTodo({ title: query, listId: backlog?.id ?? null }),
    );
    close();
  };

  const submit = async () => {
    const name = value.trim();
    if (!name && mode.kind !== "root") return;

    switch (mode.kind) {
      case "new-list":
        recordCreate(`List "${name}" created`, "list", await createList(name));
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
        recordCreate(
          "To-do added to Backlog",
          "todo",
          await createTodo({ title: name, listId: backlog?.id ?? null }),
        );
        break;
      }
      default:
        return;
    }
    close();
  };

  const placeholder =
    mode.kind === "new-list"
      ? "List name…"
      : mode.kind === "new-label"
        ? "Label name…"
        : mode.kind === "new-project"
          ? "Project name…"
          : mode.kind === "new-todo"
            ? "What needs doing?"
            : "Search to-dos or run a command…";

  const isEntryMode = mode.kind !== "root" && mode.kind !== "delete-list";

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Create and manage to-dos, lists, labels, and projects"
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
      <CommandInput
        placeholder={placeholder}
        value={value}
        onValueChange={setValue}
        onKeyDown={(e) => {
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
      <CommandList>
        {isEntryMode ? (
          <CommandGroup heading="Press Enter to create">
            <CommandItem onSelect={() => void submit()} disabled={!value.trim()}>
              {value.trim() || "Start typing…"}
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
                      const result = await deleteList(list.id);
                      if (!result) return; // Backlog, or already gone
                      /**
                       * One entry covers the list AND every todo that moved,
                       * so a single undo puts it back whole. Undoing only the
                       * list would restore it empty and strand its to-dos in
                       * Backlog — worse than not offering undo at all.
                       */
                      const entryId = pushUndo(
                        `Deleted "${list.name}"`,
                        deleteListUndoSteps(result.listId, result.movedTodoIds),
                      );
                      toast.success(`Deleted "${list.name}"`, {
                        description: "Its to-dos moved to Backlog.",
                        // The most destructive action in the app, and there is
                        // no confirmation step before it. Give it room.
                        duration: 10000,
                        action: {
                          label: "Undo",
                          onClick: () => void undoById(entryId),
                        },
                      });
                      close();
                    }}
                  >
                    {list.name}
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
                  {results.map((todo) => {
                    const where = todo.scheduledDate
                      ? formatShortDate(todo.scheduledDate)
                      : (listNameById.get(todo.listId ?? "") ?? "Unfiled");
                    return (
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
                        onSelect={() => {
                          onSelectTodo(todo);
                          close();
                        }}
                      >
                        <span
                          className={
                            todo.status === "open"
                              ? undefined
                              : "text-muted-foreground line-through"
                          }
                        >
                          {todo.title}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {where}
                        </span>
                      </CommandItem>
                    );
                  })}
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
                  Create to-do “{query}”
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
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Manage">
              <CommandItem onSelect={() => { setMode({ kind: "delete-list" }); setValue(""); }}>
                Delete a list…
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
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Typography">
              {FONT_PAIRINGS.map((pairing) => (
                <CommandItem
                  key={pairing.id}
                  // Preview each option in its own pairing — choosing a
                  // typeface from a list rendered in a different typeface is
                  // guesswork.
                  data-font={pairing.id}
                  onSelect={async () => {
                    await mutateSettings(LOCAL_OWNER_ID, {
                      fontPairing: pairing.id,
                    });
                    close();
                  }}
                >
                  <span className="font-heading">{pairing.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {pairing.description}
                  </span>
                  {/*
                    Settings rows written before this feature existed have no
                    fontPairing, and useSettings hands back the raw Dexie row
                    rather than a schema-parsed one — so fall back explicitly
                    instead of showing no current option at all.
                  */}
                  {(settings?.fontPairing ?? DEFAULT_FONT_PAIRING) ===
                  pairing.id ? (
                    <span className="text-xs text-muted-foreground">
                      (current)
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
