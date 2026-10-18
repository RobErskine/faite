"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { uuidv7 } from "uuidv7";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { validateAgentSpec } from "@/lib/assignee-rules";
import type { AccessItem, Assignee, DoneCriterion, Todo } from "@/lib/schema";

/** The vocabulary the picker offers. The field is free text server-side; an
 * agent may write another, which still renders (see `statusOptions`). */
const ACCESS_STATUSES = ["needed", "granted", "needs_setup", "blocked"] as const;

const PROBLEM_COPY = {
  "missing-done": "Add at least one line to Done so the agent knows when it is finished.",
  "missing-access": "Declare Access, or choose “Needs nothing”.",
} as const;

interface AgentSpecEditorProps {
  todo: Todo;
  /** The to-do's assignee. The editor renders only for an agent. */
  assignee: Assignee | undefined;
  onSave: (id: string, patch: Partial<Todo>) => void;
}

const statusLabel = (status: string) => status.replace(/_/g, " ");

/**
 * Done checklist + Access list for a to-do assigned to an agent (EI-402).
 *
 * The sheet saves each field as it changes, so "save blocked" is enforced as
 * edits that would leave the spec invalid are refused: the last Done line
 * cannot be removed, and Access cannot go back to undeclared once chosen
 * (removing the last item leaves it declared as "needs nothing").
 * `validateAgentSpec` is the single source for what is still missing, shown
 * inline — assigning an agent to a bare to-do is allowed, but says so.
 *
 * Criteria written here carry `addedBy: null` (the user); an agent's own
 * lines keep theirs, set server-side.
 */
export function AgentSpecEditor({ todo, assignee, onSave }: AgentSpecEditorProps) {
  const [newCriterion, setNewCriterion] = useState("");
  const [newAccess, setNewAccess] = useState("");

  if (!assignee || assignee.kind !== "agent") return null;

  const problems = validateAgentSpec(todo, assignee);
  const criteria = todo.doneCriteria ?? [];
  const access = todo.access ?? null;

  const saveCriteria = (next: DoneCriterion[]) => onSave(todo.id, { doneCriteria: next });
  const saveAccess = (next: AccessItem[]) => onSave(todo.id, { access: next });

  const addCriterion = () => {
    const text = newCriterion.trim();
    if (!text) return;
    saveCriteria([...criteria, { id: uuidv7(), text, done: false, addedBy: null }]);
    setNewCriterion("");
  };

  const addAccess = () => {
    const name = newAccess.trim();
    if (!name) return;
    saveAccess([...(access ?? []), { name, status: "needed" }]);
    setNewAccess("");
  };

  const onEnter = (action: () => void) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
  };

  return (
    <div className="space-y-4" data-testid="agent-spec-editor">
      <section aria-labelledby="agent-done-heading" className="space-y-1.5">
        <h3 id="agent-done-heading" className="text-sm font-medium">
          Done
        </h3>
        <ul className="space-y-1">
          {criteria.map((criterion) => (
            <li key={criterion.id} className="flex items-center gap-2">
              <Checkbox
                checked={criterion.done}
                aria-label={`Done: ${criterion.text}`}
                onCheckedChange={(checked) =>
                  saveCriteria(
                    criteria.map((c) => (c.id === criterion.id ? { ...c, done: checked } : c)),
                  )
                }
              />
              <Input
                key={criterion.text}
                defaultValue={criterion.text}
                aria-label={`Criterion text: ${criterion.text}`}
                className="h-7 flex-1 text-sm"
                onBlur={(event) => {
                  const text = event.target.value.trim();
                  if (text && text !== criterion.text) {
                    saveCriteria(criteria.map((c) => (c.id === criterion.id ? { ...c, text } : c)));
                  } else {
                    event.target.value = criterion.text;
                  }
                }}
              />
              <button
                type="button"
                aria-label={`Remove ${criterion.text}`}
                disabled={criteria.length <= 1}
                title={criteria.length <= 1 ? "An agent to-do needs at least one Done line" : undefined}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                onClick={() => saveCriteria(criteria.filter((c) => c.id !== criterion.id))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1">
          <Input
            value={newCriterion}
            onChange={(event) => setNewCriterion(event.target.value)}
            onKeyDown={onEnter(addCriterion)}
            placeholder="Add a line to Done…"
            aria-label="New Done line"
            className="h-7 text-sm"
          />
          <Button type="button" variant="outline" size="xs" onClick={addCriterion} disabled={!newCriterion.trim()}>
            <Plus aria-hidden />
            Add
          </Button>
        </div>
      </section>

      <section aria-labelledby="agent-access-heading" className="space-y-1.5">
        <h3 id="agent-access-heading" className="text-sm font-medium">
          Access
        </h3>
        {access === null ? (
          <p className="text-xs text-muted-foreground">Not declared yet.</p>
        ) : access.length === 0 ? (
          <p className="text-xs text-muted-foreground">Needs nothing.</p>
        ) : (
          <ul className="space-y-1">
            {access.map((item, index) => {
              const options = ACCESS_STATUSES.includes(item.status as (typeof ACCESS_STATUSES)[number])
                ? ACCESS_STATUSES
                : [...ACCESS_STATUSES, item.status];
              return (
                <li key={`${item.name}-${index}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <select
                    aria-label={`Status of ${item.name}`}
                    value={item.status}
                    className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                    onChange={(event) =>
                      saveAccess(
                        access.map((a, i) => (i === index ? { ...a, status: event.target.value } : a)),
                      )
                    }
                  >
                    {options.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => saveAccess(access.filter((_, i) => i !== index))}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-1">
          <Input
            value={newAccess}
            onChange={(event) => setNewAccess(event.target.value)}
            onKeyDown={onEnter(addAccess)}
            placeholder="Add something it needs access to…"
            aria-label="New access item"
            className="h-7 text-sm"
          />
          <Button type="button" variant="outline" size="xs" onClick={addAccess} disabled={!newAccess.trim()}>
            <Plus aria-hidden />
            Add
          </Button>
          {access === null && (
            <Button type="button" variant="outline" size="xs" onClick={() => saveAccess([])}>
              Needs nothing
            </Button>
          )}
        </div>
      </section>

      {problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive" role="status">
          {problems.map((problem) => (
            <li key={problem}>{PROBLEM_COPY[problem]}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
