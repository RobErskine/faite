"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import { computeAnchorIndex } from "./use-day-track";

export interface PhoneListNavItem {
  /** The column's droppable id (`list:<id>`), the `data-column-id` its
   * `BoardColumn` section carries. */
  columnId: string;
  name: string;
}

interface PhoneListNavProps {
  /** The Lists pager. Its children are the pages, in the same order as
   * `lists`; anything after them (the "create list" page) marks nothing. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  lists: readonly PhoneListNavItem[];
}

/**
 * The Lists pager's page indicator (EI-385) — the Lists-page twin of the Days
 * page's "‹ Overflow 8" peek (EI-383, `date-nav.tsx`). The pager opens on
 * Backlog and every other list in the tab sits to its right behind a swipe
 * nothing pointed at, and a swipe you don't know about is a page you never
 * see.
 *
 * A strip of names rather than a "Brain Dump ›" peek: a tab usually holds
 * more than two lists, and a peek reaches only the next one, so the fourth
 * list would still be three swipes and one guess away. Every name, in pager
 * order, one tap each; the visible one is `aria-current="page"`.
 *
 * Quiet on purpose: muted ink, the current name in foreground ink with an
 * underline (no weight change, so the strip never reflows as you swipe), no
 * list color — that lives on the column itself — and no surface. Phone
 * only: desktop and tablet show every list side by side already.
 *
 * Mounted inside the Lists branch, as the track's sibling, so the track ref
 * is already attached when this component's effect runs.
 */
export function PhoneListNav({ trackRef, lists }: PhoneListNavProps) {
  const [current, setCurrent] = useState(0);
  const stripRef = useRef<HTMLUListElement>(null);

  /** Page width plus gap, measured off the first page — the same way
   * `use-day-track.ts` measures the day pager, and for the same reason: a
   * gap added to the track later must not silently skew the index. */
  const measurePitch = useCallback((track: HTMLElement) => {
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return 0;
    const gap = parseFloat(getComputedStyle(track).columnGap);
    return first.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
  }, []);

  // Follows the pager, so a swipe moves the marker. React drops a same-value
  // update, so reading on every scroll event costs one rect read and nothing
  // else.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const sync = () => {
      const pitch = measurePitch(track);
      if (pitch > 0) setCurrent(computeAnchorIndex(track.scrollLeft, pitch));
    };
    sync();
    track.addEventListener("scroll", sync, { passive: true });
    return () => track.removeEventListener("scroll", sync);
  }, [trackRef, measurePitch]);

  // Keeps the marked name inside the strip when the strip itself overflows.
  // A direct `scrollLeft`, not `scrollIntoView`: the latter can scroll other
  // ancestors, and a smooth one can cancel the pager's own smooth scroll.
  useEffect(() => {
    const strip = stripRef.current;
    const item = strip?.children[current] as HTMLElement | undefined;
    if (!strip || !item) return;
    const start = item.offsetLeft;
    const end = start + item.offsetWidth;
    if (start < strip.scrollLeft) strip.scrollLeft = start;
    else if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth;
  }, [current]);

  /**
   * Scrolls the pager to the page and moves focus there, the way the
   * Overflow peek does: to the first card, or to the column itself when the
   * list is empty. Never to the quick-add — focusing a field raises the
   * on-screen keyboard over the list the user just asked to see.
   * `preventScroll`, so the focus call cannot fight the pager's own scroll.
   */
  const show = (index: number, columnId: string) => {
    const track = trackRef.current;
    if (!track) return;
    setCurrent(index);
    track.scrollTo({
      left: index * measurePitch(track),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    const column = track.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`);
    if (!column) return;
    const card = column.querySelector<HTMLElement>('[data-nav-stop^="todo:"]');
    const target = card ?? column;
    if (!card && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };

  return (
    <nav aria-label="Lists" className="shrink-0">
      <ul
        ref={stripRef}
        // `relative`, so each item's `offsetLeft` is measured from the strip.
        // The scrollbar is hidden: the names cut off at the edge are the cue
        // that the strip scrolls, and a bar under a 32px row reads as a rule.
        className="relative flex gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {lists.map((list, i) => (
          <li key={list.columnId} className="shrink-0">
            <button
              type="button"
              aria-current={i === current ? "page" : undefined}
              onClick={() => show(i, list.columnId)}
              className={cn(
                "focus-ring flex h-8 max-w-40 items-center rounded px-2 text-xs",
                // The tab pills' coarse-pointer floor (`tab-strip.tsx`).
                "pointer-coarse:h-11",
                "transition-colors duration-(--dur-fast)",
                i === current
                  ? "text-foreground underline decoration-foreground/40 underline-offset-4"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="truncate">{list.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
