"use client";

import { useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
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
import { RepeatDialog } from "@/components/board/repeat-dialog";
import { cn } from "@/lib/utils";
import { TITLE_LINES } from "@/lib/title";
import { formatShortDate } from "@/lib/scheduling";
import { Repeat } from "lucide-react";
import type { RecurrenceRule } from "@/lib/recurrence";
import type {
  CivilDate,
  Label as LabelRecord,
  List,
  Priority,
  Project,
  Todo,
} from "@/lib/schema";

const NONE = "__none__";

/** Read-only summary of the series a materialized occurrence belongs to. */
export interface RecurrenceInfo {
  /** "Every week on Fri", from `summarizeRule` — computed by the caller,
   * which has the template row this todo alone does not carry. */
  summary: string;
  /** Occurrences currently outstanding on this card. Null hides the badge. */
  missedCount: number | null;
  /** Ends the series after this occurrence — "Stop repeating". */
  onStop: () => void;
}

interface TodoSheetProps {
  todo: Todo | null;
  lists: List[];
  labels: LabelRecord[];
  projects: Project[];
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

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== todo.title) onSave(todo.id, { title: next });
    else if (!next) setTitle(todo.title);
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
      <SheetContent className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]">
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
          <div className="space-y-1.5">
            <Label>Notes</Label>
            {/*
              Markdown, finally rendered rather than just stored — the field has
              declared itself markdown since P1 (`todoSchema.description`) while
              being a plain textarea. `MarkdownField` seeds once per mount, which
              is why `TodoSheet` keys this whole subtree by todo id.
            */}
            <MarkdownField
              value={todo.description ?? ""}
              placeholder="Add notes"
              ariaLabel="Notes"
              className="min-h-[50vh]"
              onCommit={(next) =>
                onSave(todo.id, { description: next.trim() ? next : null })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-scheduled">Date</Label>
              <Input
                id="todo-scheduled"
                type="date"
                value={todo.scheduledDate ?? ""}
                onChange={(e) =>
                  onSave(todo.id, { scheduledDate: e.target.value || null })
                }
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

          <div className="space-y-1.5">
            <Label htmlFor="todo-location">Location</Label>
            <Input
              id="todo-location"
              defaultValue={todo.location ?? ""}
              onBlur={(e) =>
                e.target.value !== (todo.location ?? "") &&
                onSave(todo.id, { location: e.target.value || null })
              }
              placeholder="Grocery store, the in-laws' house…"
            />
          </div>

          {(recurrence || (onStartSeries && todo.scheduledDate)) && (
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              {recurrence ? (
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Repeat className="size-3.5" aria-hidden />
                    {recurrence.summary}
                    {recurrence.missedCount !== null && recurrence.missedCount > 1 && (
                      <Badge variant="outline" className="ml-1">
                        ×{recurrence.missedCount}
                      </Badge>
                    )}
                  </span>
                  <Button variant="ghost" size="sm" onClick={recurrence.onStop}>
                    Stop repeating
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRepeatDialogOpen(true)}
                  className="w-fit"
                >
                  <Repeat className="size-3.5" aria-hidden />
                  Repeat…
                </Button>
              )}
            </div>
          )}

          <Separator />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onSetStatus(todo.id, todo.status === "done" ? "open" : "done");
                onClose();
              }}
            >
              {todo.status === "done" ? "Reopen" : "Mark done"}
            </Button>
            {/*
              "Won't do" is a distinct status from done, not a delete. It keeps
              the item in history as abandoned rather than completed.
            */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onSetStatus(todo.id, "dropped");
                onClose();
              }}
            >
              Won&apos;t do
            </Button>
          </div>
        </div>

        <SheetFooter className="border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              onDelete(todo.id);
              onClose();
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
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
