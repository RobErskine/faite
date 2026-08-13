import type { ComponentType, ReactNode } from "react";

/**
 * The shared rail/dot/meta-line chrome behind both timelines — the day
 * sheet's (`day-sheet.tsx`) and the per-todo history log's (`todo-sheet.tsx`,
 * EI-94). Extracted from `day-sheet.tsx` rather than written fresh: a shared
 * component with one consumer is a guess, with two it's an interface, and
 * `day-sheet.test.tsx` passing unchanged is the proof this extraction is
 * behaviour-preserving.
 *
 * Deliberately NOT shared, and staying local to each sheet instead:
 * - Event label/icon maps — the day sheet's 4 kinds and the todo sheet's ~10
 *   use different words for an overlapping idea ("Assigned here" is worded
 *   for a referent — "here" — the todo sheet doesn't have).
 * - The "when" formatter — the day sheet only prefixes a date when it
 *   differs from the day being viewed; a todo's history spans months, so it
 *   always shows the date (`formatEventStamp`, `lib/event-time.ts`).
 * - The kind-filter dropdown and its "hidden by filter" empty state — day
 *   sheet only, and `settings.visibleEventKinds` is documented as scoped to
 *   exactly its four kinds.
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
    <li className="relative pl-6">
      {/*
        The rail, stopping at the last node rather than running past it — a
        line continuing into empty space reads as "more below", which is
        exactly what there isn't.
      */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[5px] top-3 bottom-[-0.75rem] w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-background bg-muted-foreground"
        style={accent ? { backgroundColor: accent } : undefined}
      />

      <p className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" aria-hidden />
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
