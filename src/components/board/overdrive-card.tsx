"use client";

import type { Label as LabelRecord, List, ReminderPreset, Todo } from "@/lib/schema";
import { formatShortDate, type PlacementContext } from "@/lib/scheduling";
import { rollEventsFor } from "@/lib/rollover-events";
import { TodoMetaBadges } from "./todo-row-parts";

/**
 * The single card Overdrive shows at a time — deliberately its OWN
 * component rather than a reuse of `TodoCard`: it needs no drag source, no
 * checkbox, no keyboard-nav stop, and (unlike `TodoCard`) it must never call
 * `useSortable` — that's what lets the overlay stay outside `DndContext`
 * (see `board.tsx`'s doc comment on why `DaySheet` lives there). Presentation
 * only — every write and every key handled lives in `overdrive-overlay.tsx`.
 */
export function OverdriveCard({
  todo,
  list,
  labels,
  reminderPresets,
  ctx,
  index,
  total,
}: {
  todo: Todo;
  /** Null when the todo has no list (lives in Backlog by omission). */
  list: List | null;
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P5) — see `TodoMetaBadges`. */
  reminderPresets?: ReminderPreset[];
  ctx: PlacementContext;
  /** 0-based position in the queue, for the "N of M" readout. */
  index: number;
  total: number;
}) {
  // Reuses the exact same derivation the board card badge does — Overdrive
  // is always looking at a todo that HAS crossed into Overflow, so this is
  // always the `overflowed` branch, never `rolledOver`.
  const lastRoll = rollEventsFor(todo, ctx).at(-1);
  const overflowInfo =
    lastRoll?.kind === "overflowed"
      ? { from: lastRoll.from, since: lastRoll.day, rolls: lastRoll.rolls }
      : undefined;

  return (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-6">
      <p className="num text-xs text-muted-foreground">
        {index + 1} of {total}
      </p>

      <h2 className="font-heading text-2xl font-bold text-foreground">{todo.title}</h2>

      {todo.description && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{todo.description}</p>
      )}

      <p className="text-sm text-muted-foreground">
        {list ? list.name : "Backlog"}
        {todo.scheduledDate && <> · Scheduled {formatShortDate(todo.scheduledDate)}</>}
      </p>

      <TodoMetaBadges
        todo={todo}
        labels={labels}
        reminderPresets={reminderPresets}
        today={ctx.today}
        overflow={overflowInfo}
      />
    </div>
  );
}
