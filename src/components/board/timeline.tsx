import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The shared rail/dot/meta-line chrome behind every timeline — the day
 * sheet's (`day-sheet.tsx`), the per-todo history log's (`todo-sheet.tsx`,
 * EI-94), and the global activity feed's (`activity-sheet.tsx`). Extracted
 * from `day-sheet.tsx` rather than written fresh: a shared component with one
 * consumer is a guess, with two it's an interface, and `day-sheet.test.tsx`
 * passing unchanged is the proof this extraction is behaviour-preserving.
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
 *   (`visibleEventKinds` for the day sheet, `visibleActivityKinds` for the
 *   global feed), so sharing the dropdown would risk one surface's filter
 *   silently reading or writing the other's field.
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

      <p className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
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
