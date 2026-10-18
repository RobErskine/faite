import type { Assignee, Todo } from "./schema";

/**
 * The rule behind "Done + Access are required only for an agent" (EI-402).
 *
 * A pure function over the two rows rather than a Zod refinement on
 * `todoSchema`: the todo cannot know its assignee's kind, and a person's
 * to-do (or one assigned to me) is valid with no checklist at all.
 *
 * Returns the problems, empty when the spec is fine. `access: []` satisfies
 * the rule ("declared: needs nothing"); `access: null` does not.
 */
export type AgentSpecProblem = "missing-done" | "missing-access";

export function validateAgentSpec(
  todo: Pick<Todo, "doneCriteria" | "access">,
  assignee: Pick<Assignee, "kind"> | null | undefined,
): AgentSpecProblem[] {
  if (!assignee || assignee.kind !== "agent") return [];
  const problems: AgentSpecProblem[] = [];
  if (todo.doneCriteria.length < 1) problems.push("missing-done");
  if (todo.access === null || todo.access === undefined) problems.push("missing-access");
  return problems;
}

/** Access statuses that put a red dot on the card: the agent cannot start. */
const ACCESS_BLOCKING = new Set(["blocked", "needs_setup"]);

/** True when any declared access item is blocked or still needs setup. */
export function hasBlockedAccess(todo: Pick<Todo, "access">): boolean {
  return (todo.access ?? []).some((item) => ACCESS_BLOCKING.has(item.status));
}

/** Done checklist progress, for the card chip's "n/m". */
export function doneProgress(todo: Pick<Todo, "doneCriteria">): { done: number; total: number } {
  return {
    done: todo.doneCriteria.filter((c) => c.done).length,
    total: todo.doneCriteria.length,
  };
}
