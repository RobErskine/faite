import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A tooltip for the marketing board, in CSS only.
 *
 * # Why not the real one
 *
 * `components/ui/tooltip.tsx` is Base UI, which is `"use client"` — and the
 * hero board and the story panel are Server Components on purpose. That is not
 * a stylistic preference: `/` is the one page whose entire audience is a
 * cold-cache first-time visitor (`redirectIfKnownDevice` sends everyone else
 * straight to `/board` before paint), and `demo-board.test.ts` fails the build
 * if anything in either file's import graph carries a client directive.
 *
 * Review asked for the same tooltips the real board has, which is right — a
 * glyph you cannot interrogate is decoration. But importing Base UI to get
 * them would put a positioning runtime on the page to explain four icons that
 * never move.
 *
 * So: hover and focus, `group-hover`/`group-focus-within`, absolutely
 * positioned. Same `bg-foreground` / `text-background` / `rounded-md` /
 * `text-xs` as `TooltipContent`, so it reads as the same component.
 *
 * # What it gives up, honestly
 *
 * No collision detection — a tooltip near the viewport edge will not flip to
 * the other side the way Base UI's would. Every one of these sits inside the
 * story panel, which is a fixed-width card in the middle of the page, so there
 * is no edge to collide with. If one ever moves somewhere it could clip, that
 * is the moment to reach for the real thing.
 *
 * No `aria-describedby` either — but that channel was never the accessible
 * one. Base UI only sets it while the tooltip is OPEN, so a screen-reader user
 * who never hovers hears nothing regardless; `todo-card.tsx` says exactly this
 * and solves it the same way, with `sr-only` text that is always in the DOM.
 * The `label` here is rendered visibly to a pointer and to a screen reader by
 * two different routes, both always present.
 */
export function DemoTooltip({
  label,
  sr,
  children,
  className,
}: {
  /** The text a real `TooltipContent` would show. */
  label: string;
  /**
   * What a screen reader hears, when that differs from the tooltip's text.
   *
   * The real board's two channels are not always the same sentence: the
   * location pin's tooltip is bare ("Central branch") while its `sr-only` text
   * is "Location: Central branch." — because a tooltip appears next to the pin
   * that explains it and a screen reader gets no such context.
   */
  sr?: string;
  /** The trigger — a glyph, a badge, whatever the row is explaining. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {/*
        `tabIndex` so a keyboard can reach the explanation at all. A `span`
        with no role, deliberately: these triggers sit inside rows that are
        already non-interactive, and giving them a button role would announce
        four controls per line that do nothing when activated.
      */}
      <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {children}
      </span>
      <span className="sr-only">{sr ?? label}</span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2",
          "w-max max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background",
          "opacity-0 transition-opacity duration-100",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          // Reduced motion gets the tooltip, just not the fade.
          "motion-reduce:transition-none",
        )}
      >
        {label}
      </span>
    </span>
  );
}
