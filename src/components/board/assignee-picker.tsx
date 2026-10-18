"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Assignee } from "@/lib/schema";

/** `Select` values cannot be null; this stands for "me" (assigneeId null). */
const ME = "__me__";

interface AssigneePickerProps {
  /** `Todo.assigneeId` — null is the account owner. */
  value: string | null;
  assignees: Assignee[];
  onChange: (assigneeId: string | null) => void;
  id?: string;
}

/**
 * The "Who" field: me, or one of the agents and people in Settings → Assignees.
 *
 * A `Select`, not the label picker's type-ahead `Combobox`: a workspace has a
 * handful of assignees, not dozens of labels, and the choice is exactly one.
 * Changing it writes only `assigneeId` — the Done checklist and Access list
 * stay on the to-do when it is handed back to me (EI-402).
 */
export function AssigneePicker({
  value,
  assignees,
  onChange,
  id = "todo-assignee",
}: AssigneePickerProps) {
  return (
    <Select value={value ?? ME} onValueChange={(v) => onChange(v === ME ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue>
          {(current: string) => {
            if (current === ME) return "Me";
            const assignee = assignees.find((a) => a.id === current);
            return assignee ? assignee.name : "Removed assignee";
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ME}>Me</SelectItem>
        {assignees.map((assignee) => (
          <SelectItem key={assignee.id} value={assignee.id}>
            {assignee.name}
            <span className="text-muted-foreground">
              {assignee.kind === "agent" ? " · agent" : ""}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
