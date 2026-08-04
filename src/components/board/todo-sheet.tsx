"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type {
  Label as LabelRecord,
  List,
  Priority,
  Project,
  Todo,
} from "@/lib/schema";

const NONE = "__none__";

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
}: TodoSheetProps & { todo: Todo }) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== todo.title) onSave(todo.id, { title: next });
    else if (!next) setTitle(todo.title);
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="sr-only">Edit to-do</SheetTitle>
          <SheetDescription className="sr-only">
            Edit the details of this to-do item.
          </SheetDescription>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Title"
            className="border-0 px-0 text-base font-medium shadow-none focus-visible:ring-0"
          />
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="todo-notes">Notes</Label>
            <Textarea
              id="todo-notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                description !== (todo.description ?? "") &&
                onSave(todo.id, { description: description || null })
              }
              placeholder="Markdown supported"
              rows={4}
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
    </Sheet>
  );
}
