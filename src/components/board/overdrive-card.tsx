"use client";

import type { Label as LabelRecord, List, ReminderPreset, Todo } from "@/lib/schema";
import { formatShortDateAsOf, type PlacementContext } from "@/lib/scheduling";
import { railEdgeVars } from "@/lib/priority";
import { NO_LIST_NAME } from "@/lib/row-grammar";
import {
  TitleMarkers,
  TodoMetaBadges,
  todoRowDetails,
  todoRowFacts,
  type TodoRowSources,
} from "./todo-row-parts";

/**
 * The single card Overdrive shows at a time — deliberately its OWN
 * component rather than a reuse of `TodoCard`: it needs no drag source, no
 * checkbox, no keyboard-nav stop, and (unlike `TodoCard`) it must never call
 * `useSortable` — that's what lets the overlay stay outside `DndContext`
 * (see `board.tsx`'s doc comment on why `DaySheet` lives there). Presentation
 * only — every write and every key handled lives in `overdrive-overlay.tsx`.
 *
 * Its own component, but not its own anatomy (EI-395): the rail, the title's
 * glyphs, the badges and their words are the board row's parts
 * (`todo-row-parts.tsx`), at display density. It used to show only the
 * title, the list and the Overflow age — no rail, no ↳, no pin, no deadline
 * ahead, no sub-task or attachment counts — so a to-do looked like a
 * different thing the moment it was triaged.
 */
export function OverdriveCard({
  todo,
  list,
  labels,
  reminderPresets,
  ctx,
  rowSources,
  index,
  total,
}: {
  todo: Todo;
  /** Null when the todo has no list: it lives in Backlog (`buildBoard`). */
  list: List | null;
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P5) — see `TodoMetaBadges`. */
  reminderPresets?: ReminderPreset[];
  ctx: PlacementContext;
  /** The board's per-to-do maps — see `todoRowFacts`. */
  rowSources?: TodoRowSources;
  /** 0-based position in the queue, for the "N of M" readout. */
  index: number;
  total: number;
}) {
  // The same derivation as the board card's: the Overflow age for a to-do
  // that has crossed, ↳ for one still rolling (a day's pile, EI-253).
  const facts = todoRowFacts(todo, ctx, rowSources);

  /*
    The badges' and glyphs' words. The heading is the title, so this is the
    rest of `todoRowName` — the board card's name, which a screen reader in
    Overdrive otherwise never hears: the glyphs and badges carry no text.
  */
  const details = todoRowDetails({
    todo,
    labels,
    today: ctx.today,
    reminderPresets,
    ...facts,
  });

  return (
    // `w-full` of the overlay's fixed-width stage, never of its own content:
    // a card that sized to its title made the dialog jump between cards
    // (EI-393). A long title wraps.
    //
    // The rail rides the card's left border, as on the drag chip
    // (`railEdgeVars`): a standalone box has no column edge to keep true.
    <div
      data-overdrive-card
      style={railEdgeVars(todo.priority)}
      className="rail-edge flex w-full flex-col gap-3 rounded-lg border border-border bg-background p-6"
    >
      <p className="num text-xs text-muted-foreground">
        {index + 1} of {total}
      </p>

      <h2 className="font-heading text-2xl font-bold text-pretty wrap-break-word text-foreground">
        {/* 16px glyphs by a 24px title: the row's glyphs, one density up. */}
        <TitleMarkers
          todo={todo}
          today={ctx.today}
          recurrenceSummary={facts.recurrenceSummary}
          rolledFrom={facts.rolledFrom}
          glyphClassName="size-4"
        />
        {todo.title}
      </h2>
      {details.length > 0 && <p className="sr-only">{details.join(", ")}</p>}

      {todo.description && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{todo.description}</p>
      )}

      <p className="text-sm text-muted-foreground">
        {/* "Backlog", the word ⌘K uses too: a to-do with no list is in it. */}
        {list ? list.name : NO_LIST_NAME}
        {todo.scheduledDate && <> · Scheduled {formatShortDateAsOf(todo.scheduledDate, ctx.today)}</>}
      </p>

      <TodoMetaBadges
        todo={todo}
        labels={labels}
        reminderPresets={reminderPresets}
        today={ctx.today}
        overflow={facts.overflow}
        missedCount={facts.missedCount}
        subtaskCount={facts.subtaskCount}
        attachmentCount={facts.attachmentCount}
      />
    </div>
  );
}
