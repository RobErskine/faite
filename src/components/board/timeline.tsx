import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The shared rail/dot/meta-line chrome behind every timeline — the day
 * sheet's (`day-sheet.tsx`), the per-todo history log's (`todo-sheet.tsx`,
 * EI-94), and the global activity feed's (`activity-sheet.tsx`). Extracted
 * from `day-sheet.tsx` rather than written fresh: a shared component with one
 * consumer is a guess, with two it's an interface, and `day-sheet.test.tsx`
 * passing unchanged is the proof this extraction is behavior-preserving.
 * `HiddenByFilterNotice` joined it once a second consumer needed the same
 * "N hidden by the view filter" empty state with its own filter setting.
 *
 * Deliberately NOT shared, and staying local to each sheet instead:
 * - Event label/icon maps — each sheet's kind vocabulary uses different words
 *   for an overlapping idea ("Assigned here" is worded for a referent —
 *   "here" — only the day sheet has).
 * - The "when" formatter — the day sheet only prefixes a date when it
 *   differs from the day being viewed; a todo's history spans months, so it
 *   always shows the date (`formatEventStamp`, `lib/event-time.ts`).
 * - The kind-filter dropdown itself and which settings field backs it — each
 *   sheet filters a different kind vocabulary through its own setting
 *   (`hiddenEventKinds` for the day sheet, `hiddenActivityKinds` for the
 *   global feed, `hiddenHistoryKinds` for a to-do's History — see
 *   `lib/kind-filter.ts`), so sharing the dropdown would risk one surface's
 *   filter silently reading or writing the other's field.
 */

interface TimelineListProps {
  /** Accessible name for the `<ol>` — there is no `data-testid` anywhere in
   * this app (`docs/E2E.md`), so this is how a test locates the list. */
  ariaLabel: string;
  children: ReactNode;
}

export function TimelineList({ ariaLabel, children }: TimelineListProps) {
  return (
    <ol className="space-y-3" aria-label={ariaLabel}>
      {children}
    </ol>
  );
}

interface TimelineRowProps {
  /** A RESOLVED icon/label — this component doesn't know about event kinds,
   * only how to render one row. */
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** ISO instant, for the `<time>` element's `dateTime`. */
  at: string;
  /** Already-formatted display string for `at`. */
  when: string;
  /** Accent dot color, e.g. from `edge(list?.color)`. Undefined for no accent. */
  accent: string | undefined;
  isLast: boolean;
  children?: ReactNode;
}

export function TimelineRow({ icon: Icon, label, at, when, accent, isLast, children }: TimelineRowProps) {
  return (
    <li className="relative pl-7">
      {/*
        The rail, stopping at the last node rather than running past it — a
        line continuing into empty space reads as "more below", which is
        exactly what there isn't. Centered under the dot below (a size-5
        circle, so 10px minus half the 1px line), and starting right at the
        dot's bottom edge (top-5 = the circle's own height) rather than
        overlapping it.
      */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[9.5px] top-5 bottom-[-0.75rem] w-px bg-border"
        />
      )}
      {/*
        The dot IS the icon now, not a plain color swatch with a duplicate
        icon inline in the text — one glyph per row, doing double duty as
        both the rail's node and the "what kind of event" cue. `text-background`
        on the icon (matching the `border-background` ring) reads on any
        accent color without per-color contrast math, the same trick the ring
        already relies on to separate the dot from whatever's behind it.
      */}
      <span
        aria-hidden
        className="absolute left-0 top-0 flex size-5 items-center justify-center rounded-full border-2 border-background bg-muted-foreground text-background"
        style={accent ? { backgroundColor: accent } : undefined}
      >
        <Icon className="size-3" aria-hidden />
      </span>

      <p className="flex items-center gap-1 type-eyebrow">
        {label}
        <span aria-hidden>·</span>
        <time dateTime={at} className="num">
          {when}
        </time>
      </p>

      {children}
    </li>
  );
}

/**
 * The sticky-looking day divider between runs of rows — the global activity
 * feed's, extracted when a to-do's own History became the second consumer
 * (EI-318). One hand-tuned block, not two: every number in it is measured
 * against `TimelineRow`'s geometry, and a copy would drift the moment either
 * moved.
 *
 * The label is NOT computed here. `dayLabel` (lib/scheduling.ts) is shared,
 * but the decision to show a header at all belongs to whichever
 * `build*Timeline` produced the items.
 */
export function TimelineDayHeader({ label }: { label: string }) {
  return (
    <li
      // `-mx-4` cancels the sheet body's own `px-4`, so the background paints
      // edge-to-edge instead of stopping at the timeline column like every
      // other row's content does. `pl-11` puts the TEXT back where it would
      // have sat without the cancellation — 16px (the padding just removed)
      // plus 28px (`pl-7`, every `TimelineRow`'s own left inset) — so the
      // label still lines up with the rows above and below it; only the
      // background bleeds wider.
      className="type-eyebrow relative -mx-4 bg-muted/60 py-1.5 pr-4 pl-11"
    >
      {/*
        Keeps the rail unbroken through the header — without this, the line
        stops at the row above and resumes at the row below, reading as two
        separate timelines rather than one. `left-[25.5px]` is
        `TimelineRow`'s own rail position (`left-[9.5px]`, centered under its
        size-5 dot) PLUS the 16px `-mx-4` added back above: the rail has to
        account for the same shift the text's `pl-11` does, or it drifts out
        of alignment for exactly the width of this header. Same `-0.75rem`
        bottom overshoot as `TimelineRow`'s own rail, to bridge the
        `space-y-3` gap to whatever follows.
      */}
      <span aria-hidden className="absolute left-[25.5px] top-0 bottom-[-0.75rem] w-px bg-border" />
      {label}
    </li>
  );
}

/**
 * "N hidden by the view filter · Show all" — one component for every
 * kind-filtered timeline: replacing the list entirely when the filter hides
 * every event, and as a footer line when it hides some. Reused rather than
 * separately worded messages per sheet, so the count and the reset action
 * can't drift apart.
 */
export function HiddenByFilterNotice({
  count,
  onShowAll,
}: {
  count: number;
  onShowAll: () => void;
}) {
  return (
    <p className="flex items-center gap-1 py-2 text-sm text-muted-foreground">
      {/* Own span, not inlined with the button: keeps the count text
          queryable by its exact words rather than the row's full text,
          which includes "Show all". */}
      <span>
        {count} {count === 1 ? "entry" : "entries"} hidden by the view filter
      </span>
      <span aria-hidden>·</span>
      <Button variant="link" size="xs" className="h-auto p-0" onClick={onShowAll}>
        Show all
      </Button>
    </p>
  );
}
