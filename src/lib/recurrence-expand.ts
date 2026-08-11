import type { CivilDate, Todo } from "./schema";
import {
  nextAfterCompletion,
  occurrenceId,
  occurrencesBetween,
  parseOccurrenceId,
  parseRule,
} from "./recurrence";
import { addDays, type PlacementContext } from "./scheduling";

/**
 * Turns recurrence templates into the occurrences the board actually renders.
 *
 * ONE live occurrence per template: the earliest one not yet settled
 * (completed, dropped, or deleted). While it is due today or later it renders
 * normally on its own day. The moment its date passes unsettled, it drops
 * straight into Overflow — no grace period, unlike an ordinary todo — and is
 * badged with how many occurrences have piled up since (`missedCounts`).
 * Settling it (materializing a completion/drop/delete) advances to the NEXT
 * occurrence one at a time; it does not clear a whole backlog in one action.
 *
 * Every occurrence strictly after the live one, up to the visible window,
 * renders normally on its own future day — those are never overdue by
 * definition, so no special placement or badge applies.
 *
 * `anchor: "completed"` has no backlog concept at all: the next occurrence
 * does not exist until the current one settles, so `missedCounts` is never
 * set for it and no future occurrences are ever emitted.
 *
 * Must run downstream of `ctx`, inside the board's render memo — never folded
 * into whatever feeds the window-growth calculation. A daily series always
 * has an occurrence at the window's edge, so growing the window in response
 * would grow it again next render, settling only at the 365-day cap.
 */

function isSettled(child: Pick<Todo, "status" | "deletedAt">): boolean {
  return child.status !== "open" || child.deletedAt !== null;
}

/**
 * A materialized occurrence's row, minus whatever the user changed after the
 * fact — used only to seed a brand new virtual card, never to overwrite an
 * existing real row (see `existing` in `expandRecurrences`).
 *
 * `deadline` is deliberately dropped: a recurring series doesn't carry a
 * fixed one-time deadline forward, or every occurrence would repeat the same
 * "overdue" badge. `position` is the template's own, verbatim — deterministic
 * across devices, and safe to share across occurrences now that
 * `byPriorityThenPosition` (lib/priority.ts) breaks the resulting tie on `id`.
 */
function cloneOccurrence(template: Todo, date: CivilDate): Todo {
  return {
    ...template,
    id: occurrenceId(template.id, date),
    scheduledDate: date,
    scheduledAt: null,
    deadline: null,
    recurrenceRule: null,
    recurrenceParentId: template.id,
    status: "open",
    completedAt: null,
    deletedAt: null,
  };
}

export interface ExpansionResult {
  /**
   * Feed this to `buildBoard` in place of the real, non-template todos passed
   * in: it is those todos, minus any live occurrence pulled out into
   * `forceOverflow`, plus newly synthesized virtual occurrences.
   */
  todos: Todo[];
  /** Feed straight to `buildBoard`'s `forceOverflow` option. */
  forceOverflow: Todo[];
  /** Occurrence id -> total occurrences currently outstanding on that card. */
  missedCounts: ReadonlyMap<string, number>;
}

/**
 * @param templates Real todo rows with `recurrenceRule` set. Never rendered
 *   themselves — the caller must exclude them from whatever it otherwise
 *   feeds `buildBoard`.
 * @param realTodos Every other real (non-template) todo, INCLUDING settled
 *   and tombstoned materialized occurrences — settlement detection needs to
 *   see a deleted occurrence to know the series moved past it. `useTodos()`
 *   alone will not do, since it filters tombstones out; pair it with
 *   `useRecurrenceChildren()` for the children specifically.
 */
export function expandRecurrences(
  templates: readonly Todo[],
  realTodos: readonly Todo[],
  ctx: PlacementContext,
): ExpansionResult {
  const todosById = new Map(realTodos.map((t) => [t.id, t] as const));
  const childrenByTemplate = new Map<string, Todo[]>();
  for (const todo of realTodos) {
    if (!todo.recurrenceParentId) continue;
    const list = childrenByTemplate.get(todo.recurrenceParentId);
    if (list) list.push(todo);
    else childrenByTemplate.set(todo.recurrenceParentId, [todo]);
  }

  const additional: Todo[] = [];
  const forceOverflow: Todo[] = [];
  const forcedIds = new Set<string>();
  const missedCounts = new Map<string, number>();

  const windowEnd = ctx.visibleWindow[ctx.visibleWindow.length - 1] ?? ctx.today;

  for (const template of templates) {
    const rule = parseRule(template.recurrenceRule);
    if (!rule || !template.scheduledDate) continue;
    const seriesStart = template.scheduledDate;
    const kids = childrenByTemplate.get(template.id) ?? [];

    let settledThrough: CivilDate | null = null;
    for (const kid of kids) {
      if (!isSettled(kid)) continue;
      const date = parseOccurrenceId(kid.id)?.date ?? kid.scheduledDate;
      if (date && (!settledThrough || date > settledThrough)) settledThrough = date;
    }

    let liveDate: CivilDate | null;
    if (rule.anchor === "completed") {
      // `ctx.today` is always `<= windowEnd` (it's the window's first day), so
      // an overdue `next` always passes this bound too — the only case this
      // excludes is a future `next` that hasn't entered the rendered window.
      const next = settledThrough ? nextAfterCompletion(rule, settledThrough) : seriesStart;
      liveDate = next <= windowEnd ? next : null;
    } else {
      const scanFrom = settledThrough ? addDays(settledThrough, 1) : seriesStart;
      liveDate = occurrencesBetween(rule, seriesStart, scanFrom, windowEnd)[0] ?? null;
    }

    if (liveDate) {
      const liveId = occurrenceId(template.id, liveDate);
      const isOverdue = liveDate < ctx.today;
      const existing = todosById.get(liveId);
      const liveTodo = existing ?? cloneOccurrence(template, liveDate);

      if (isOverdue) {
        if (rule.anchor === "scheduled") {
          missedCounts.set(
            liveId,
            occurrencesBetween(rule, seriesStart, liveDate, ctx.today).length,
          );
        }
        forcedIds.add(liveId);
        forceOverflow.push(liveTodo);
      } else if (!existing) {
        additional.push(liveTodo);
      }

      if (rule.anchor === "scheduled") {
        const future = occurrencesBetween(rule, seriesStart, addDays(liveDate, 1), windowEnd);
        for (const date of future) {
          if (date <= ctx.today) continue;
          const id = occurrenceId(template.id, date);
          if (todosById.has(id)) continue;
          additional.push(cloneOccurrence(template, date));
        }
      }
    }
  }

  return {
    todos: [...realTodos.filter((t) => !forcedIds.has(t.id)), ...additional],
    forceOverflow,
    missedCounts,
  };
}

/** True for a template row — never rendered directly, only expanded. */
export function isRecurrenceTemplate(todo: Pick<Todo, "recurrenceRule">): boolean {
  return todo.recurrenceRule !== null;
}

/** True for a materialized occurrence — a real row forked off a template. */
export function isRecurrenceOccurrence(todo: Pick<Todo, "recurrenceParentId">): boolean {
  return todo.recurrenceParentId !== null;
}
