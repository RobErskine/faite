"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Clock, Repeat, Trash2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RepeatDialog } from "@/components/board/repeat-dialog";
import { RepeatSection, type RecurrenceInfo } from "@/components/board/repeat-section";
import { LocationField } from "@/components/board/location-field";
import { cn } from "@/lib/utils";
import { TITLE_LINES } from "@/lib/title";
import { formatShortDate } from "@/lib/scheduling";
import { isTextEntry } from "@/lib/undo";
import { detectPlatform, formatCombo, type Platform } from "@/lib/keyboard";
import type { RecurrenceRule } from "@/lib/recurrence";
import type {
  CivilDate,
  Label as LabelRecord,
  List,
  Place,
  Priority,
  Project,
  Todo,
} from "@/lib/schema";

export type { RecurrenceInfo };

const NONE = "__none__";

interface TodoSheetProps {
  todo: Todo | null;
  lists: List[];
  labels: LabelRecord[];
  projects: Project[];
  /** Saved locations (`lib/schema.ts`'s `Place`) — see the Location field. */
  places: Place[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<Todo>) => void;
  /**
   * Status is separate from onSave because it is not a plain field write: it
   * also stamps `completedAt`. Routing it through onSave left that null on a
   * completed todo here while the card checkbox set it — the same action
   * producing two different records depending on where it was triggered.
   */
  onSetStatus: (id: string, status: Todo["status"]) => void;
  onToggleLabel: (todoId: string, labelId: string) => void;
  onDelete: (id: string) => void;
  /**
   * Set only when this sheet was opened from that day's timeline — renders a
   * "Back to Aug 11" affordance above the title. Absent for every other way of
   * reaching the sheet (a board card, the palette, Overflow), where there is
   * nowhere sensible to go back to.
   */
  backToDay?: CivilDate;
  onBackToDay?: () => void;
  /** Set when this todo is a materialized occurrence of a recurring series. */
  recurrence?: RecurrenceInfo | null;
  /**
   * Start a new series from this (plain, one-off) todo. Omitted — or simply
   * not rendered — when `recurrence` is already set, or the todo has no
   * `scheduledDate` to anchor a series on.
   */
  onStartSeries?: (rule: RecurrenceRule) => void;
}

/** Never changes within a page's life — same rationale as `useIsLocalDev` in settings-sheet.tsx. */
const subscribeToNothing = () => () => {};

/**
 * Display-only platform sniff, client-safe. `Platform` never gates
 * behaviour (the keyboard handler below checks the actual event's
 * modifiers), only which glyphs the footer tooltips show — but `navigator`
 * doesn't exist during the static export's prerender, so reading it
 * directly would still render one string server-side and swap in another on
 * hydration. `useSyncExternalStore` with an explicit server snapshot is the
 * sanctioned way to say "client-only" here — see `useIsLocalDev`.
 */
function usePlatform(): Platform {
  return useSyncExternalStore(subscribeToNothing, detectPlatform, () => "other");
}

/**
 * Full CRUD for a single todo.
 *
 * A Sheet rather than a Dialog: editing a todo is a side task next to the
 * board, and a sheet keeps the board visible for context. Radix handles focus
 * trapping, restore-on-close, and Escape for us.
 *
 * Fields write on blur/change rather than behind a Save button — writes are
 * local and instant, so there is nothing to batch and no request to await.
 */
export function TodoSheet({ todo, ...rest }: TodoSheetProps) {
  if (!todo) return null;
  // Keyed remount re-seeds the draft fields for each todo. Syncing them in an
  // effect instead would cascade renders (and React 19 lints against it).
  return <TodoSheetContent key={todo.id} todo={todo} {...rest} />;
}

function TodoSheetContent({
  todo,
  lists,
  labels,
  projects,
  places,
  onClose,
  onSave,
  onSetStatus,
  onToggleLabel,
  onDelete,
  backToDay,
  onBackToDay,
  recurrence,
  onStartSeries,
}: TodoSheetProps & { todo: Todo }) {
  const [title, setTitle] = useState(todo.title);
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const platform = usePlatform();

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== todo.title) onSave(todo.id, { title: next });
    else if (!next) setTitle(todo.title);
  };

  const markDone = () => {
    onSetStatus(todo.id, todo.status === "done" ? "open" : "done");
    onClose();
  };
  const wontDo = () => {
    onSetStatus(todo.id, "dropped");
    onClose();
  };
  const remove = () => {
    onDelete(todo.id);
    onClose();
  };

  /**
   * Local `onKeyDown`, not a global registry entry — KEYBOARD.md §5 step 1:
   * these three actions are meaningless unless this sheet is open, and the
   * registry's `GuardContext` has no per-surface discriminator, so a global
   * entry would need `allowWhenModalOpen: true` and would ALSO fire behind
   * every other sheet/dialog in the app.
   *
   * `e.defaultPrevented` bails out from under an inner control that already
   * handled the key — the location combobox's Base UI popup is a React
   * child of this element (portals bubble through the React tree, not the
   * DOM tree), so selecting a suggestion with Enter would otherwise also
   * mark the todo done. `RepeatDialog` needs no such guard: it renders as a
   * SIBLING of this element, so its keystrokes never reach this handler.
   */
  const handleSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    // Exactly one of Ctrl/Meta, never both, never Alt — the same rule
    // `hasExactModifiers` (lib/keyboard.ts) enforces for the global registry.
    // Hand-checked here because that helper only serves the registry.
    const modOnly = e.metaKey !== e.ctrlKey && !e.altKey;
    if (!modOnly) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      markDone();
      return;
    }

    if (e.key === "Backspace") {
      // `⌘⌫`/`Ctrl+Backspace` is "delete to line start" / "delete previous
      // word" in a text field on every platform — never steal it there.
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) remove();
      else wontDo();
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/*
        `data-[side=right]:` on the width utilities, not plain `sm:` ones: the
        base `SheetContent` already sets `data-[side=right]:w-3/4` and
        `data-[side=right]:sm:max-w-sm`, both gated on the same attribute
        selector. A plain class loses that specificity fight and silently
        does nothing — matching the modifier is what makes the override win.
        See the matching comment in `day-sheet.tsx`, which shares this sheet
        width so the two don't read as two different components.
      */}
      <SheetContent
        className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]"
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader className={backToDay ? "gap-1.5 pr-10" : undefined}>
          <SheetTitle className="sr-only">Edit to-do</SheetTitle>
          <SheetDescription className="sr-only">
            Edit the details of this to-do item.
          </SheetDescription>
          {backToDay && onBackToDay && (
            <button
              type="button"
              onClick={onBackToDay}
              className="-ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Back to {formatShortDate(backToDay)}
            </button>
          )}
          {/*
            A textarea, not an input, so a long title is readable here rather
            than scrolling sideways one line at a time — and it grows to exactly
            the card's clamp (`TITLE_LINES`) so what the sheet shows in full is
            what the card shows before cutting off.

            `field-sizing-content` (from the Textarea base) does the growing with
            no JS; `rows={1}` is the floor, and `max-h` the ceiling, past which it
            scrolls. Where `field-sizing` is unsupported this degrades to a
            one-row textarea, which is what an `<input>` was anyway.

            Enter still commits rather than inserting a newline: a title is one
            line of text, and `commitTitle` already runs on blur.
          */}
          <Textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            rows={1}
            style={{ maxHeight: `calc(${TITLE_LINES} * 1.5rem)` }}
            aria-label="Title"
            className={cn(
              "min-h-0 resize-none border-0 px-0 py-0 text-base font-medium leading-6",
              "shadow-none focus-visible:border-0 focus-visible:ring-0",
            )}
          />
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-scheduled">Date</Label>
              <Input
                id="todo-scheduled"
                type="date"
                value={todo.scheduledDate ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  // Clearing the date orphans any reminder — it resolves
                  // against `scheduledDate` (lib/reminders.ts) and would
                  // otherwise silently resurrect the moment a date is set
                  // again.
                  onSave(
                    todo.id,
                    next
                      ? { scheduledDate: next }
                      : { scheduledDate: null, reminderTime: null },
                  );
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-deadline">Deadline</Label>
              <Input
                id="todo-deadline"
                type="date"
                value={todo.deadline ?? ""}
                onChange={(e) => onSave(todo.id, { deadline: e.target.value || null })}
              />
            </div>
          </div>

          {todo.scheduledDate && (
            <div className="space-y-1.5">
              <Label htmlFor="todo-reminder">Reminder</Label>
              <div className="flex items-center gap-1.5">
                <div className="relative w-fit">
                  <Clock
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="todo-reminder"
                    type="time"
                    value={todo.reminderTime ?? ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      // The native input emits "" mid-edit — skip rather
                      // than spending an undo entry nulling a reminder that
                      // was never set (⌘Z ⌘Z to type one time otherwise).
                      if (!next && !todo.reminderTime) return;
                      onSave(todo.id, { reminderTime: next || null });
                    }}
                    // The shadcn Base UI time-picker look — NOT `step="1"`.
                    // That example uses it for HH:MM:SS display, but
                    // `reminderTime` is validated as HH:MM
                    // (`todoSchema.reminderTime`) and `zonedInstant` throws
                    // on anything else; `step`'s default (60) already gives
                    // HH:MM.
                    className="w-32 appearance-none bg-background pl-8 [&::-webkit-calendar-picker-indicator]:appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
                  />
                </div>
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
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-list">List</Label>
              <Select
                value={todo.listId ?? NONE}
                onValueChange={(v) =>
                  onSave(todo.id, { listId: v === NONE ? null : v })
                }
              >
                <SelectTrigger id="todo-list">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.emoji ? `${list.emoji} ` : ""}
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="todo-priority">Priority</Label>
              <Select
                value={todo.priority ? String(todo.priority) : NONE}
                onValueChange={(v) =>
                  onSave(todo.id, {
                    priority: v === NONE ? null : (Number(v) as Priority),
                  })
                }
              >
                <SelectTrigger id="todo-priority">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} className="num" value={String(p)}>
                      P{p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-project">Project</Label>
            <Select
              value={todo.projectId ?? NONE}
              onValueChange={(v) =>
                onSave(todo.id, { projectId: v === NONE ? null : v })
              }
            >
              <SelectTrigger id="todo-project">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.emoji ? `${project.emoji} ` : ""}
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Labels</Label>
            <div className="flex flex-wrap gap-1.5">
              {labels.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No labels yet — create one with the command palette.
                </p>
              )}
              {labels.map((label) => {
                const active = todo.labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => onToggleLabel(todo.id, label.id)}
                    aria-pressed={active}
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Badge
                      variant={active ? "default" : "outline"}
                      className={cn("cursor-pointer font-normal")}
                    >
                      {label.emoji ? `${label.emoji} ` : ""}
                      {label.name}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>

          <LocationField todo={todo} places={places} onSave={onSave} />

          {recurrence ? (
            <RepeatSection recurrence={recurrence} />
          ) : (
            onStartSeries &&
            todo.scheduledDate && (
              <div className="space-y-1.5">
                <Label>Repeat</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRepeatDialogOpen(true)}
                  className="w-fit"
                >
                  <Repeat className="size-3.5" aria-hidden />
                  Repeat…
                </Button>
              </div>
            )
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label>Notes</Label>
            {/*
              Markdown, finally rendered rather than just stored — the field has
              declared itself markdown since P1 (`todoSchema.description`) while
              being a plain textarea. `MarkdownField` seeds once per mount, which
              is why `TodoSheet` keys this whole subtree by todo id.

              Last in the scroll body, not first: at `min-h-40` it can grow
              freely under whatever is typed without burying the metadata
              above it — the fields this whole section exists to make more
              usable (Location, Repeat) would otherwise sit a deliberate
              half-screen scroll away.
            */}
            <MarkdownField
              value={todo.description ?? ""}
              placeholder="Add notes"
              ariaLabel="Notes"
              className="min-h-40"
              onCommit={(next) =>
                onSave(todo.id, { description: next.trim() ? next : null })
              }
            />
          </div>
        </div>

        {/*
          3-up, not stacked: `SheetFooter` is `flex-col` by default (one
          button had no reason to fight that), so this overrides to a row and
          gives each button an equal third.
        */}
        <SheetFooter className="grid grid-cols-3 gap-2 border-t">
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={markDone} />}>
              {todo.status === "done" ? "Reopen" : "Mark done"}
            </TooltipTrigger>
            <TooltipContent>
              {todo.status === "done" ? "Reopen" : "Mark done"}
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("mod+enter", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
          {/*
            "Won't do" is a distinct status from done, not a delete. It keeps
            the item in history as abandoned rather than completed.
          */}
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={wontDo} />}>
              Won&apos;t do
            </TooltipTrigger>
            <TooltipContent>
              Won&apos;t do
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("mod+backspace", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                />
              }
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </TooltipTrigger>
            <TooltipContent>
              {recurrence ? "Skip this occurrence" : "Delete"}
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("shift+mod+backspace", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
        </SheetFooter>
      </SheetContent>

      {onStartSeries && todo.scheduledDate && (
        <RepeatDialog
          open={repeatDialogOpen}
          onOpenChange={setRepeatDialogOpen}
          seriesStart={todo.scheduledDate}
          initialRule={null}
          onSave={onStartSeries}
        />
      )}
    </Sheet>
  );
}
