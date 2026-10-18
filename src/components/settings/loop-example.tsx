"use client";

import { loopExample, rollStateFor, type LoopExample } from "@/lib/rollover-events";
import { addDays, formatShortDate, type PlacementContext } from "@/lib/scheduling";
import type { CivilDate, Todo } from "@/lib/schema";
import { TitleMarkers, TodoMetaBadges } from "@/components/board/todo-row-parts";
import { cn } from "@/lib/utils";

/** The fake todo every box in the example shares — one task, three moments. */
const EXAMPLE_TODO: Todo = {
  id: "example",
  ownerId: "example",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  title: "Renew passport",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: null,
  scheduledAt: null,
  deadline: null,
  listId: null,
  projectId: null,
  labelIds: [],
  location: null,
  placeId: null,
  parentId: null,
  position: "a0",
  recurrenceRule: null,
  recurrenceParentId: null,
  completedAt: null,
  reminderTime: null,
  source: null,
  duplicateOf: null,
  duplicateHeld: null,
  suggestedListId: null,
  assigneeId: null,
  doneCriteria: [],
  access: null,
};

/** Calendar days after the crossing that the Overflow box is drawn on. */
const OVERFLOW_SHOWN_AFTER = 2;

/**
 * A contextual replacement for the old plain-text worked example: the same
 * fake to-do shown at each of the three moments the Faite Loop can put it
 * in. Each box's icon/badge is rendered by the REAL `TitleMarkers`/
 * `TodoMetaBadges` (`todo-row-parts.tsx`) fed real `rollStateFor()` output —
 * not a lookalike — so hovering behaves exactly as it does on the board,
 * with the same tooltip. Dates come from `loopExample()`, the same primitive
 * `describeLoop`'s sentence is built from, so the two can't disagree.
 *
 * Each caption is "On <day>": the day that box is drawn as of, its "today".
 * The example starts on the reader's real today, so every later box is a day
 * in the future, and saying so is what keeps a badge's "since …" readable.
 */
export function LoopExampleCards({
  ctx,
}: {
  ctx: Pick<PlacementContext, "today" | "overflowAfterDays" | "workdaysOnly" | "workdays">;
}) {
  const { missed, rollDays, overflowDay }: LoopExample = loopExample(ctx);
  const rolls = rollDays.length;
  const lastRollDay = rollDays.at(-1);

  const todo: Todo = { ...EXAMPLE_TODO, scheduledDate: missed };

  // The board card's own derivation, at each step's "today" (EI-387).
  const rolledFrom = lastRollDay
    ? rollStateFor(todo, { ...ctx, today: lastRollDay }).rolledFrom
    : undefined;
  // The Overflow box is drawn two days AFTER the crossing, not on it (EI-390).
  // On the crossing day the badge can only say "since today", and under a
  // date that is not the reader's today that read as a contradiction. Two
  // days on, the badge shows its whole form — "since Oct 19 · 2 days" —
  // and the caption names the box's own day, so the two agree.
  const overflowShownOn = addDays(overflowDay, OVERFLOW_SHOWN_AFTER);
  const overflow = rollStateFor(todo, { ...ctx, today: overflowShownOn }).overflow;

  return (
    <div className={cn("grid gap-2", rolls > 0 ? "grid-cols-3" : "grid-cols-2")}>
      <ExampleStep label="Scheduled" caption={`On ${formatShortDate(missed)}`}>
        <ExampleCard todo={todo} today={missed} />
      </ExampleStep>

      {rolls > 0 && lastRollDay && (
        <ExampleStep
          label="Rolled over"
          caption={`On ${formatShortDate(lastRollDay)} · ${rolls} ${rolls === 1 ? "day" : "days"}`}
        >
          <ExampleCard todo={todo} today={lastRollDay} rolledFrom={rolledFrom} />
        </ExampleStep>
      )}

      <ExampleStep label="Overflow" caption={`On ${formatShortDate(overflowShownOn)}`}>
        <ExampleCard todo={todo} today={overflowShownOn} overflow={overflow} />
      </ExampleStep>
    </div>
  );
}

function ExampleStep({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
      <p data-loop-caption className="nums text-2xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/** A miniature, non-interactive stand-in for a board card — real title
 * markers and meta badges, just without `TodoCard`'s drag/keyboard/checkbox
 * machinery, which a static illustration has no use for. */
function ExampleCard({
  todo,
  today,
  rolledFrom,
  overflow,
}: {
  todo: Todo;
  today: CivilDate;
  rolledFrom?: { from: CivilDate; rolls: number; overflowsIn: number };
  overflow?: { from: CivilDate; since: CivilDate };
}) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center text-xs">
        <TitleMarkers todo={todo} today={today} rolledFrom={rolledFrom} />
        <span className="truncate">{todo.title}</span>
      </div>
      <TodoMetaBadges todo={todo} labels={[]} today={today} overflow={overflow} />
    </div>
  );
}
