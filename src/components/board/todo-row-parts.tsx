"use client";

import type { ReactNode } from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { labelChipStyle } from "@/lib/colors";
import { priorityRail, railBackgroundImage, railOpacity } from "@/lib/priority";
import type { CivilDate, Label as LabelRecord, ReminderPreset, Todo } from "@/lib/schema";
import {
  formatDeadlineDue,
  formatShortDateAsOf,
  isDeadlineMissed,
  type PlacementContext,
} from "@/lib/scheduling";
import { reminderLabelFor } from "@/lib/reminder-presets";
import {
  describeOverflowAge,
  formatOverflowAge,
  rollStateFor,
  type RollState,
} from "@/lib/rollover-events";
import {
  ROW_BADGES,
  ROW_BADGE_COUNT,
  ROW_BADGE_LABEL,
  ROW_BADGE_TEXT,
  ROW_BADGE_VERDICT,
  ROW_GLYPH,
  ROW_GLYPH_SLOT,
  ROW_ICONS,
  type RowIcon,
} from "@/lib/row-grammar";

/**
 * The anatomy of a to-do, as parts (EI-395): the rail, the title's glyphs, the
 * badge line, and the name that speaks all of them. Every surface that shows a
 * to-do builds it from these — the board card, the ⌘K result row, the
 * Overdrive card and the drag chip — and varies only density:
 *
 * | surface     | rail            | glyphs          | badges | name            |
 * |-------------|-----------------|-----------------|--------|-----------------|
 * | board card  | `PriorityRail`  | 12px            | all    | `todoRowName`   |
 * | ⌘K row      | `PriorityRail`  | 12px            | all, + scheduled date | `todoRowName` + list |
 * | Overdrive   | border, `railBorderStyle` | 16px, by a 24px title | all | `todoRowDetails` |
 * | drag chip   | border, `railBorder` | 12px, no tooltips | all, no tooltips | — (dnd-kit announces the drag) |
 *
 * `todoRowFacts` derives the per-to-do inputs (roll state, counts, the series
 * summary) the same way for all of them. `TodoCard` itself (drag, keyboard
 * nav, checkbox) cannot be reused off the board — see `command-palette.tsx`.
 *
 * The grammar — type, size, icons, order — is `lib/row-grammar.ts`, shared
 * with the homepage's demo board.
 */

/**
 * An absolutely positioned span, not `border-l` — see `TodoCard` for the four
 * reasons (box-sizing alignment, border mitring against `border-b`, the drop
 * indicator's flight target, and same-priority runs reading as one stripe).
 * Callers that don't share those constraints (e.g. the command palette) can
 * override `className`.
 */
export function PriorityRail({
  priority,
  settled = false,
  className,
}: {
  priority: Todo["priority"];
  /** Done or Won't do: the rail steps back with the title. */
  settled?: boolean;
  className?: string;
}) {
  const rail = priorityRail(priority);
  if (!rail) return null;
  return (
    <span
      aria-hidden
      data-priority-rail={priority}
      /*
        Achromatic (docs/DESIGN.md §7, decision A): the rail is `--foreground`
        at the level's opacity, so it inverts with the theme and never collides
        with a list's hue or the urgency red. Every level below P1 is broken to
        its own rhythm — solid, long dash, short dash, sparse dots — so a level
        can be read without a neighbour to compare it against. Drawn as a
        repeating gradient rather than a border, because the rail is a span,
        not a border (see TodoCard for why).
      */
      style={{
        width: rail.width,
        // Steps back on a settled row (EI-395, `SETTLED_RAIL_OPACITY`).
        opacity: railOpacity(rail, settled),
        ...(railBackgroundImage(rail)
          ? { backgroundImage: railBackgroundImage(rail)! }
          : { backgroundColor: "var(--foreground)" }),
      }}
      /*
        `inset-y-1`, not `inset-y-0`. The rail used to run the full row height
        and borrow its gap from the row's `border-b` — a 1px divider that the
        Air pass removed (docs/DESIGN.md, 2026-09-05) without anything here
        noticing. Rows sit flush now, so consecutive rails abutted exactly:
        measured 669.3 → 669.3, 704.5 → 704.5, four separate levels fusing
        into one tapering stripe down the column.

        The 4px is deliberate rather than restoring the old 1px. A 1px gap was
        legible when a divider line sat in it; with nothing there it reads as
        continuous. This makes the tick its own mark, which is what the level
        is supposed to be.
      */
      className={cn("pointer-events-none absolute inset-y-1 left-0", className)}
    />
  );
}

/**
 * The same rail, drawn inline instead of pinned to a card's edge — for a menu
 * row or a select trigger, where it has to sit in text flow beside a word.
 *
 * Deliberately `PriorityRail` with a positioning override rather than a second
 * component: width, opacity and each level's rhythm all come from
 * `PRIORITY_RAILS`, and a copy would drift the first time one of them changed.
 */
export function PriorityGlyph({ priority }: { priority: Todo["priority"] }) {
  return (
    <PriorityRail
      priority={priority}
      className="relative inset-y-auto left-auto h-3.5 shrink-0"
    />
  );
}

/** Per-to-do maps the board already computes (`use-board-data.ts`). */
export interface TodoRowSources {
  /** "Every week on Fri", keyed by the series' template id. */
  recurrenceSummaries?: ReadonlyMap<string, string>;
  /** Outstanding occurrences, keyed by occurrence id (`recurrence-expand.ts`). */
  missedCounts?: ReadonlyMap<string, number>;
  subtaskCounts?: ReadonlyMap<string, { done: number; total: number }>;
  attachmentCounts?: ReadonlyMap<string, number>;
}

export interface TodoRowFacts extends RollState {
  recurrenceSummary?: string;
  missedCount?: number;
  subtaskCount?: { done: number; total: number };
  attachmentCount?: number;
}

/**
 * Everything a row shows beyond the to-do's own fields, looked up one way for
 * every surface — so ⌘K, Overdrive and the drag chip cannot drop a part the
 * board card has (EI-395: ⌘K had no sub-task or attachment counts, Overdrive
 * had neither, nor the ↳).
 *
 * A recurring occurrence's counts are its own: sub-tasks and attachments are
 * keyed by the row's id, as the sheet reads them, and `cloneOccurrence` drops
 * the series' deadline on purpose. So an occurrence showing none of the
 * template's is the data model, not a lost badge.
 */
export function todoRowFacts(
  todo: Todo,
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays" | "overflowAfterDays">,
  sources: TodoRowSources = {},
): TodoRowFacts {
  return {
    ...rollStateFor(todo, ctx),
    recurrenceSummary: todo.recurrenceParentId
      ? sources.recurrenceSummaries?.get(todo.recurrenceParentId)
      : undefined,
    missedCount: sources.missedCounts?.get(todo.id),
    subtaskCount: sources.subtaskCounts?.get(todo.id),
    attachmentCount: sources.attachmentCounts?.get(todo.id),
  };
}

/** One title glyph: its icon, from `ROW_ICONS`, behind its own tooltip. */
function Glyph({
  icon,
  tooltip,
  interactive,
  className,
  ...data
}: {
  icon: RowIcon;
  tooltip: ReactNode;
  interactive: boolean;
  className?: string;
} & Record<`data-${string}`, string>) {
  const Icon = ROW_ICONS[icon];
  const mark = (
    <span {...data} data-row-glyph={icon} className={ROW_GLYPH_SLOT}>
      <Icon className={cn(ROW_GLYPH, className)} aria-hidden />
    </span>
  );
  if (!interactive) return mark;
  return (
    <Tooltip>
      {/*
        A `span` trigger, deliberately: Base UI adds no role and no tabIndex
        of its own, so this stays non-interactive content inside the title
        rather than a control nested in a control.
      */}
      <TooltipTrigger render={mark} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The inline glyph run — rolled, deadline ahead, repeats, location
 * (`ROW_GLYPH_ORDER`) — meant to sit inside a title's inline flow, immediately
 * before the title text. Each glyph is its own tooltip trigger; a missed
 * deadline is NOT included here, it gets the red badge in `TodoMetaBadges`
 * instead. Neither is an overflowed todo's rollover history — see
 * `TodoMetaBadges`'s Overflow age badge for that.
 *
 * Purely visual: the glyphs carry no hidden text. Their words are in
 * `todoRowName`, which the row sets as its name, so a sentence placed here
 * cannot jump ahead of the title (EI-381).
 *
 * The tooltips are hover-only, so on touch the words are reachable only
 * through the name. A deadline ahead stays a glyph rather than "due Thu" in
 * words: at the 168px column floor a second when-badge on every row with a
 * deadline costs more density than the glyph saves.
 */
export function TitleMarkers({
  todo,
  today,
  recurrenceSummary,
  rolledFrom,
  interactive = true,
  glyphClassName,
}: {
  todo: Todo;
  today: CivilDate;
  recurrenceSummary?: string;
  /** Set only while the todo is still rolling — on today's column, not yet
   * in Overflow. See `rollEventsFor` in `lib/rollover-events.ts`. */
  rolledFrom?: { from: CivilDate; rolls: number; overflowsIn: number };
  /**
   * False drops the tooltips and keeps the marks: the drag chip, which
   * follows the pointer, must not open a tooltip under it mid-drag.
   */
  interactive?: boolean;
  /** Density: Overdrive's 24px title takes a 16px glyph. */
  glyphClassName?: string;
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  /** Quiet inline marker for a deadline still ahead; a missed one gets the red badge. */
  const dueAhead = todo.deadline && !deadlineMissed ? todo.deadline : null;
  const g = { interactive, className: glyphClassName };

  return (
    <>
      {rolledFrom && (
        <Glyph
          {...g}
          icon="rolled"
          data-rollover-marker=""
          tooltip={
            /* `TooltipContent`'s popup is `inline-flex` (row), so two direct
              children sit side by side, not stacked — this wrapper is the
              flex item, and stacks its own children as a column. The "·"
              is the row's one separator, as in "since Oct 6 · 9 days". */
            <span className="flex flex-col text-center">
              <span>
                Rolled from {formatShortDateAsOf(rolledFrom.from, today)} ·{" "}
                {plural(rolledFrom.rolls, "day", "days")}
              </span>
              <span>Overflow in {plural(rolledFrom.overflowsIn, "day", "days")}</span>
            </span>
          }
        />
      )}
      {dueAhead && (
        <Glyph
          {...g}
          icon="deadline"
          data-deadline-marker=""
          tooltip={formatDeadlineDue(dueAhead, today)}
        />
      )}
      {todo.recurrenceParentId && (
        <Glyph
          {...g}
          icon="recurring"
          data-recurrence-marker=""
          tooltip={recurrenceSummary ?? "Part of a repeating series"}
        />
      )}
      {todo.location && (
        <Glyph {...g} icon="location" data-location-pin="" tooltip={todo.location} />
      )}
    </>
  );
}

export interface TodoRowNameInput {
  todo: Todo;
  labels: LabelRecord[];
  today: CivilDate;
  recurrenceSummary?: string;
  rolledFrom?: { from: CivilDate; rolls: number; overflowsIn: number };
  showScheduledDate?: boolean;
  missedCount?: number | null;
  overflow?: { from: CivilDate; since: CivilDate };
  reminderPresets?: ReminderPreset[];
  subtaskCount?: { done: number; total: number } | null;
  attachmentCount?: number;
  /** "Completed Oct 14, 3:12 PM · planned Oct 12" — `formatCompletionStamp`. */
  completionStamp?: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything after the title in `todoRowName`, as clauses — for a surface
 * whose title is already its own element (Overdrive's heading), which then
 * needs only the rest.
 */
export function todoRowDetails({
  todo,
  labels,
  today,
  recurrenceSummary,
  rolledFrom,
  showScheduledDate,
  missedCount,
  overflow,
  reminderPresets,
  subtaskCount,
  attachmentCount,
  completionStamp,
}: TodoRowNameInput): string[] {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  const parts: string[] = [];
  const push = (part: string | null | undefined | false) => {
    if (part) parts.push(part);
  };

  push(priorityRail(todo.priority)?.label);
  // "Completed Oct 14 · 3:12 PM · planned Oct 12": the dots are visual
  // punctuation, so the spoken form uses the same commas as everything else.
  push(completionStamp?.split(" · ").join(", "));

  // TitleMarkers, in its order (`ROW_GLYPH_ORDER`).
  if (rolledFrom) {
    push(
      `Rolled from ${formatShortDateAsOf(rolledFrom.from, today)}, ${plural(rolledFrom.rolls, "day", "days")} ago`,
    );
    push(`Overflow in ${plural(rolledFrom.overflowsIn, "day", "days")}`);
  }
  if (todo.deadline && !deadlineMissed) push(formatDeadlineDue(todo.deadline, today));
  if (todo.recurrenceParentId) push(`Repeats: ${recurrenceSummary ?? "part of a repeating series"}`);
  if (todo.location) push(`Location: ${todo.location}`);

  // TodoMetaBadges, in its order (`ROW_BADGE_ORDER`): verdict, when,
  // progress, identity. A clause for a badge with words starts with those
  // words (EI-391): "Deadline Oct 12, …", "Missed 3 times …". The Overflow
  // age is the full sentence here ("In Overflow since Oct 6, 9 days"), not
  // the badge's "since Oct 6 · 9 days": a screen reader has no column around
  // the card to supply it.
  if (deadlineMissed && todo.deadline) push(formatDeadlineDue(todo.deadline, today));
  if ((missedCount ?? 0) > 1) push(`Missed ${missedCount} times in a row`);
  if (overflow) push(describeOverflowAge(overflow.since, today));
  if (showScheduledDate && todo.scheduledDate) {
    push(`Scheduled ${formatShortDateAsOf(todo.scheduledDate, today)}`);
  }
  if (todo.reminderTime) push(reminderLabelFor(todo.reminderTime, reminderPresets ?? []));
  if (subtaskCount && subtaskCount.total > 0) {
    push(`${subtaskCount.done} of ${subtaskCount.total} sub-tasks done`);
  }
  if ((attachmentCount ?? 0) > 0) push(plural(attachmentCount!, "attachment", "attachments"));
  for (const label of labels) {
    if (todo.labelIds.includes(label.id)) push(label.emoji ? `${label.emoji} ${label.name}` : label.name);
  }

  return parts;
}

/**
 * Everything `TitleMarkers` and `TodoMetaBadges` show, as one spoken string.
 * The caller sets it as the row's `aria-label` (EI-381). This exists because
 * a name built from the row's DOM read badly in Chrome.
 *
 * EI-378 gave each part a visually hidden comma, and production read "Call
 * grandma , Priority 2 , 10:00 AM". The stray spaces came from Chrome, not
 * from the markup: when it builds a name from content, it adds a space at
 * every block-level boundary, and the title (`-webkit-box`), each badge (a
 * flex item) and every `sr-only` span (absolutely positioned, so blockified)
 * is one. No hidden-text trick can attach a comma to the text before it. The
 * DOM also put the glyphs' sentences first ("Rolled from Oct 11, … Call
 * dentist"), so the name did not start with the title. happy-dom has no
 * layout, so none of this showed up in a unit test.
 *
 * An explicit name has no layout to depend on. It always starts with the
 * title (WCAG 2.5.3, and every `name: title` selector), and it reads the same
 * in every browser and in a test. The glyphs and badges carry no hidden text
 * of their own any more; this is the one place their words live, so a new
 * badge must be added here as well, or it is visible but silent.
 *
 * Clauses follow the screen order: title, priority, settled stamp, then the
 * title glyphs (`ROW_GLYPH_ORDER`), then the badges (`ROW_BADGE_ORDER`). A
 * badge whose glyph is not self-explanatory ("1/3", a paperclip and "2")
 * reads as its tooltip text.
 */
export function todoRowName(input: TodoRowNameInput): string {
  return [input.todo.title, ...todoRowDetails(input)].join(", ");
}

/**
 * The badge line, in `ROW_BADGE_ORDER`: verdict (a missed deadline, missed
 * occurrences, the Overflow age), when (the scheduled date — only when the
 * caller opts in via `showScheduledDate`: the board card only wants it away
 * from its own column, the palette always wants it since it has no column to
 * imply the date — then the time), progress (sub-tasks, attachments),
 * identity (labels). Renders `null` when there is nothing to show.
 *
 * Every badge takes its classes from `lib/row-grammar.ts`, and carries
 * `data-row-badge` with its kind, which is what the order test reads.
 *
 * Dates carry the year when it is not this year (`formatShortDateAsOf`,
 * EI-387): "Oct 1, 2027", not a bare "Oct 1" that reads as this October.
 *
 * Purely visual, like `TitleMarkers`. Each badge's words are in
 * `todoRowName`, so a badge added here must be added there too.
 */
export function TodoMetaBadges({
  todo,
  labels,
  today,
  showScheduledDate,
  missedCount,
  overflow,
  reminderPresets,
  subtaskCount,
  attachmentCount,
  interactive = true,
  className,
}: {
  todo: Todo;
  labels: LabelRecord[];
  today: CivilDate;
  showScheduledDate?: boolean;
  missedCount?: number | null;
  /** Set only once the todo has crossed into Overflow. See `rollEventsFor`
   * in `lib/rollover-events.ts` — `since` is the `overflowed` event's day,
   * and the badge reads "since <since> · N days" (`formatOverflowAge`), so
   * each card reports its own wait. */
  overflow?: { from: CivilDate; since: CivilDate };
  /** Named reminder times (EI-106 P5) — resolves `todo.reminderTime` through
   * `reminderLabelFor` so a preset match reads "🌅 In the morning" instead
   * of a bare clock time. Omit (or pass `[]`) where presets aren't in scope;
   * the badge still renders, just always as a formatted clock time. */
  reminderPresets?: ReminderPreset[];
  /**
   * Sub-task done/total counts (EI-183) — see `use-board-data.ts`'s
   * `subtaskCounts`. Undefined/null, or a `total` of 0, shows no badge.
   */
  subtaskCount?: { done: number; total: number } | null;
  /** How many files are attached (EI-242) — see `use-board-data.ts`'s
   * `attachmentCounts`. Undefined or 0 shows no badge. */
  attachmentCount?: number;
  /**
   * False drops every hover text — the Overflow age's tooltip and the counts'
   * `title`s — and keeps the badges, as `TitleMarkers` does: the drag chip
   * follows the pointer, so anything that opens on hover would open under it.
   */
  interactive?: boolean;
  /** Density: the badge line's own spacing, e.g. the drag chip's tighter gap. */
  className?: string;
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  const todoLabels = labels.filter((l) => todo.labelIds.includes(l.id));

  const hasContent =
    todoLabels.length > 0 ||
    (deadlineMissed && todo.deadline) ||
    (showScheduledDate && todo.scheduledDate) ||
    (missedCount ?? 0) > 1 ||
    Boolean(overflow) ||
    Boolean(todo.reminderTime) ||
    (subtaskCount?.total ?? 0) > 0 ||
    (attachmentCount ?? 0) > 0;

  if (!hasContent) return null;

  const Scheduled = ROW_ICONS.scheduled;
  const Time = ROW_ICONS.time;
  const Subtasks = ROW_ICONS.subtasks;
  const Attachments = ROW_ICONS.attachments;
  /*
    The Overflow age, as an element so it can stand alone (`interactive`
    false) or be its tooltip's trigger. Why a styled `span` and what it says:
    the comment where it renders, below.
  */
  const overflowAge = overflow && (
    <span
      data-overflow-age
      data-row-badge="overflow-age"
      className={cn(
        badgeVariants({ variant: "outline" }),
        ROW_BADGE_TEXT,
        // `text-foreground/60`, the quiet ink that passes (EI-378):
        // muted ink fell to 4.1:1 under the hover wash on
        // Overflow's `surface-0` (EI-395). Worst now 4.90:1.
        "text-foreground/60",
        "h-auto min-h-5 max-w-full flex-wrap justify-start gap-x-[0.25em] gap-y-0 whitespace-normal",
      )}
    >
      {formatOverflowAge(overflow.since, today)
        .split(" · ")
        .map((half, i) => (
          // The space before "·" is trimmed at a line start, so a
          // wrapped second half begins "· 9 days"; on one line the
          // text reads exactly `formatOverflowAge`'s string.
          <span key={half} className="whitespace-nowrap">
            {i > 0 && " · "}
            {half}
          </span>
        ))}
    </span>
  );
  /** A badge's `title`, only where hover text is wanted. */
  const hoverText = (text: string) => (interactive ? text : undefined);

  return (
    <span className={cn(ROW_BADGES, className)}>
      {/*
        The verdicts. The two red badges sit one step up, at `text-xs`, while
        their neighbors stay at `text-2xs`: colored text never at the smallest
        size (PRODUCT.md). The variant supplies `--urgent-foreground` ink
        (EI-382). Words only, no icon: "Deadline" and "Missed" say it, and the
        Repeat icon the missed count used to wear already means "repeats" on
        the title (EI-395).
      */}
      {deadlineMissed && todo.deadline && (
        <Badge variant="destructive" data-row-badge="deadline-missed" className={ROW_BADGE_VERDICT}>
          Deadline {formatShortDateAsOf(todo.deadline, today)}
        </Badge>
      )}
      {(missedCount ?? 0) > 1 && (
        <Badge
          variant="destructive"
          data-row-badge="missed-occurrences"
          className={ROW_BADGE_VERDICT}
          title={hoverText(`Missed ${missedCount} times in a row`)}
        >
          Missed ×{missedCount}
        </Badge>
      )}
      {/*
        A styled `span`, not a `<Badge>`, as the trigger itself — every
        other trigger in this file is a plain element for the same
        reason (§ `Glyph` above): the badge's visual classes are
        applied directly rather than composing two render-prop components.

        Muted ink, not the urgent red (EI-374, docs/DESIGN.md §1): the
        Overflow column's rule and count already carry the urgency once,
        so a red pill on every card in it was a wall of red saying the
        same thing N times — and red at `text-2xs` breaks PRODUCT.md's
        "colored text never at the smallest size". Same quiet register as
        the rolled-over marker this badge replaces.

        Words only, no icon (EI-383). It used to carry ↳ too, which made
        one glyph mean two things: "rolled forward onto today" on the
        title marker, "sitting in Overflow" here. ↳ belongs to the roll.

        "since Oct 6 · 9 days" everywhere (EI-390): the start and the
        count, never "In Overflow" (the column says that once) and never
        a bare count, which under a "Scheduled Aug 30" read as "9 days
        late". The full sentence is the row's name (`todoRowName`) and the
        tooltip.

        Fit (measured at the 168px column floor, whose badge row is
        148px): 96–101px in Source Sans, 112–116px in Hyperlegible, so it
        stays one unit and, beside other badges, moves to its own line
        whole. The one string that cannot fit is a start in another year
        in Hyperlegible ("since Dec 30, 2025 · 290 days", 170px), so the
        badge may break — but only between its two halves, each of which
        stays unbroken (`whitespace-nowrap` per half, `flex-wrap` on the
        pill). `ROW_BADGE_TEXT` (`nums`): a phrase with numbers in it,
        not a count, stays in the text face — mono would have cost a
        third more width.
      */}
      {overflow &&
        (interactive ? (
          <Tooltip>
            <TooltipTrigger render={overflowAge} />
            <TooltipContent>
              Scheduled {formatShortDateAsOf(overflow.from, today)} ·{" "}
              {describeOverflowAge(overflow.since, today)}
            </TooltipContent>
          </Tooltip>
        ) : (
          overflowAge
        ))}
      {/* When: the date, then the time. */}
      {showScheduledDate && todo.scheduledDate && (
        <Badge variant="outline" data-row-badge="scheduled" className={ROW_BADGE_TEXT}>
          <Scheduled aria-hidden />
          {formatShortDateAsOf(todo.scheduledDate, today)}
        </Badge>
      )}
      {todo.reminderTime && (
        <Badge variant="outline" data-row-badge="time" className={ROW_BADGE_TEXT}>
          <Time aria-hidden />
          {reminderLabelFor(todo.reminderTime, reminderPresets ?? [])}
        </Badge>
      )}
      {/* Progress: the two bare counts, in the numeric face. */}
      {subtaskCount && subtaskCount.total > 0 && (
        <Badge
          variant="outline"
          data-row-badge="subtasks"
          className={ROW_BADGE_COUNT}
          title={hoverText(`${subtaskCount.done} of ${subtaskCount.total} sub-tasks done`)}
        >
          <Subtasks aria-hidden />
          {subtaskCount.done}/{subtaskCount.total}
        </Badge>
      )}
      {(attachmentCount ?? 0) > 0 && (
        <Badge
          variant="outline"
          data-row-badge="attachments"
          className={ROW_BADGE_COUNT}
          title={hoverText(plural(attachmentCount!, "attachment", "attachments"))}
        >
          <Attachments aria-hidden />
          {attachmentCount}
        </Badge>
      )}
      {/* Identity. */}
      {todoLabels.map((label) => (
        <Badge
          key={label.id}
          variant="secondary"
          data-row-badge="label"
          className={ROW_BADGE_LABEL}
          /*
            The identity ladder from lib/colors.ts, not a hand-rolled alpha:
            tint behind, edge around, and the text in `labelInk` — 30% of the
            hue into the foreground (EI-395). The raw hue on the name measured
            1.4–3.9:1 at this size; the mix clears 7.7:1 for every preset, on
            every surface, in both themes (docs/DESIGN.md §1).
          */
          style={labelChipStyle(label.color)}
        >
          {label.emoji ? `${label.emoji} ` : ""}
          {label.name}
        </Badge>
      ))}
    </span>
  );
}
