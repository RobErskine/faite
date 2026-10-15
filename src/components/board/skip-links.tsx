"use client";

import type { MouseEvent } from "react";
import { addStop } from "@/lib/column-nav";
import { cn } from "@/lib/utils";

/**
 * "Skip to today" and "Skip to Backlog" (EI-381) — the first two tab stops on
 * `/board`, ahead of the header in both shells.
 *
 * Before these, a keyboard user reached today's first card only after the
 * header, the date nav and the whole Overflow rail. Today and Backlog are the
 * two places the board is used from: what you are doing, and where new things
 * land.
 *
 * Where each link lands:
 * - **today** → today's first card, so the arrow keys (docs/KEYBOARD.md §11)
 *   work from there. With no cards, today's quick-add. A card row is a
 *   `tabIndex={-1}` nav stop, so it takes focus without joining the tab order.
 * - **Backlog** → its quick-add field, because Backlog is intake.
 *
 * The target may not exist yet when the link is pressed. The calendar half,
 * the planning half or Backlog may be collapsed, and on phone the other page
 * may be showing. `prepare` undoes that, and the link waits for the field or
 * card to render, for up to a second. Only then does it settle for the column
 * itself.
 *
 * Focus lands with `preventScroll` and `reveal` moves the view. A natively
 * scrolled day track lands between columns and fights the anchor the next
 * jump reads (docs/KEYBOARD.md §11.4), the same reason `use-column-nav.ts`
 * does it this way.
 *
 * Each `href` also names a real element (EI-386), so the link is a working
 * same-page link before the script runs and whenever the click handler does
 * not (a middle click, a link opened elsewhere), and an auditor that checks
 * the target finds one. The shells put `SKIP_TARGET_IDS` on exactly one
 * element each: the column itself, or, while it is hidden, the control that
 * brings it back (the collapsed half's strip, the phone's other page tab).
 */

/** The `id`s the skip links point at. The shells place them. */
export const SKIP_TARGET_IDS = { today: "today", backlog: "backlog" } as const;

export interface SkipLinkTarget {
  /** The column's droppable id (`day:2026-10-14`, `list:<id>`), which
   * `BoardColumn` writes onto its section as `data-column-id`. */
  columnId: string;
  /** "card" lands on the first card if there is one; "add" goes straight to
   * the quick-add. */
  prefer: "card" | "add";
  /** Makes the column renderable: expands a collapsed half or rail, switches
   * the phone page. Runs before the wait starts. */
  prepare?: () => void;
  /** Brings the focused element into view. Defaults to `scrollIntoView`
   * with `block`/`inline` "nearest". */
  reveal?: (target: HTMLElement) => void;
}

/**
 * The element a skip link should focus, or null if the column has not
 * rendered. `exact` is false for the column itself, which is only a fallback.
 */
export function findSkipTarget(
  root: ParentNode,
  { columnId, prefer }: Pick<SkipLinkTarget, "columnId" | "prefer">,
): { element: HTMLElement; exact: boolean } | null {
  // Every column id is generated (`day:` + an ISO date, `list:` + a
  // UUID), so the quoted selector needs no escaping.
  const column = root.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`);
  if (!column) return null;
  const add = column.querySelector<HTMLElement>(`[data-nav-stop="${addStop(columnId)}"]`);
  const card = prefer === "card" ? column.querySelector<HTMLElement>('[data-nav-stop^="todo:"]') : null;
  const exact = card ?? add;
  return exact ? { element: exact, exact: true } : { element: column, exact: false };
}

/** ~1s at 60fps. A collapsed half reopens through a settings write and a
 * live query, so this takes a few frames, not one. */
const MAX_FRAMES = 60;

function focusTarget(target: SkipLinkTarget) {
  target.prepare?.();
  let frames = 0;
  const attempt = () => {
    const found = findSkipTarget(document, target);
    if (found && (found.exact || frames >= MAX_FRAMES)) {
      const { element } = found;
      // A collapsed column is already a focusable button. A plain section is
      // not, and with no tabindex `focus()` would do nothing.
      if (!found.exact && !element.hasAttribute("tabindex")) element.tabIndex = -1;
      element.focus({ preventScroll: true });
      (target.reveal ?? ((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" })))(
        element,
      );
      return;
    }
    if (frames++ < MAX_FRAMES) requestAnimationFrame(attempt);
  };
  attempt();
}

export function SkipLinks({
  today,
  backlog,
}: {
  today: SkipLinkTarget;
  /** Null when the board has no Backlog to skip to. */
  backlog: SkipLinkTarget | null;
}) {
  const links = [
    { href: `#${SKIP_TARGET_IDS.today}`, label: "Skip to today", target: today },
    ...(backlog
      ? [{ href: `#${SKIP_TARGET_IDS.backlog}`, label: "Skip to Backlog", target: backlog }]
      : []),
  ];
  return (
    <div data-skip-links>
      {links.map(({ href, label, target }) => (
        <a
          key={href}
          href={href}
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            e.preventDefault();
            focusTarget(target);
          }}
          className={cn(
            // Parked above the viewport until focused, then a raised chip over
            // the header's top-left corner. `fixed`, so showing it moves
            // nothing in the shell's flex column. Both links share the spot;
            // only the focused one is ever visible. Not `sr-only` +
            // `focus:not-sr-only`: the latter zeroes padding and resets
            // `position`, fighting the chip's own classes. No transition, so
            // there is no motion to reduce.
            "fixed top-2 left-2 z-50 -translate-y-[calc(100%+1rem)] focus:translate-y-0",
            "rounded-lg bg-popover px-3 py-2 text-sm font-medium text-popover-foreground",
            "shadow-(--shadow-raised) ring-1 ring-foreground/10 focus-ring",
          )}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
