"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
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
import type { List, Settings } from "@/lib/schema";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: List[];
  settings: Settings | undefined;
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
  settings,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>({ kind: "root" });
  const [value, setValue] = useState("");

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

  const submit = async () => {
    const name = value.trim();
    if (!name && mode.kind !== "root") return;

    switch (mode.kind) {
      case "new-list":
        await createList(name);
        toast.success(`List "${name}" created`);
        break;
      case "new-label":
        await createLabel(name);
        toast.success(`Label "${name}" created`);
        break;
      case "new-project":
        await createProject(name);
        toast.success(`Project "${name}" created`);
        break;
      case "new-todo": {
        const backlog = lists.find((l) => l.isBacklog);
        await createTodo({ title: name, listId: backlog?.id ?? null });
        toast.success("To-do added to Backlog");
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
            : "Type a command or search…";

  const isEntryMode = mode.kind !== "root" && mode.kind !== "delete-list";

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Create and manage to-dos, lists, labels, and projects"
    >
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
                      await deleteList(list.id);
                      toast.success(`Deleted "${list.name}"`, {
                        description: "Its to-dos moved to Backlog.",
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
            <CommandGroup heading="Create">
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
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
