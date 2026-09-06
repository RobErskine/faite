"use client";

import { useEffect, useRef } from "react";
import { STORY_BEATS } from "@/lib/story-beats";

/**
 * The sub-tasks tick off as you read past them (EI-278).
 *
 * Each beat owns one line of the "Plan living room move" card, in order — so
 * "how far has the reader scrolled" and "how much of this card is done" are the
 * same number, and this component is the four lines that say so out loud. By
 * the closing beat the card is complete, which is the whole point: the page
 * ends on a finished plan, not on a pitch.
 *
 * # It writes DOM, not state
 *
 * Same rule as the scene (`docs/SCENE.md` §4) and `card-travel.tsx`. Scroll
 * goes to a ref; the rAF loop toggles `data-done` on the rows and rewrites one
 * number in the badge. Putting the count in React state would re-render the
 * panel — and, through it, six list items and their checkboxes — on every
 * scroll frame, to change one integer.
 *
 * # Both copies of the card, on purpose
 *
 * `story-panel.tsx` is rendered twice: once at rest in the story, once inside
 * `card-travel.tsx` as the copy that flies in from the hero. Both are updated
 * here. The flying copy is only visible during the handoff, but that handoff
 * ends inside the first beat — so a copy that ticked nothing would visibly
 * disagree with the one it dissolves into.
 *
 * # Progress is measured off the same element the room measures
 *
 * `[data-story] > div` is `RoomStage`'s own grid. Reading the same box with the
 * same arithmetic is what guarantees the camera and the check-offs cannot
 * drift: at the beat where the room frames the plant, the watering line ticks.
 * A second, independently-derived notion of "how far in are we" is exactly how
 * those two would end up one beat apart.
 *
 * # When it does nothing
 *
 * Reduced motion or no JavaScript. `StoryPanel` takes `doneThrough` and renders
 * a correct static state from it, so what those readers get is the card as the
 * server drew it — not an empty shell waiting for a script. That is why the
 * static version was built first.
 */
export function StoryTicks() {
  /** Beats completed, 0 → 6. A ref, never state — this renders exactly once. */
  const done = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const story = document.querySelector<HTMLElement>("[data-story] > div");
    if (!story) return;

    // Every card on the page: the one at rest and the one in flight.
    const panels = [...document.querySelectorAll<HTMLElement>("[data-subtask-list]")].map(
      (list) => ({
        rows: [...list.querySelectorAll<HTMLElement>("[data-subtask]")],
        badge: list.parentElement?.querySelector<HTMLElement>("[data-subtask-count]") ?? null,
      }),
    );
    if (panels.length === 0) return;

    let raf = 0;
    let last = -1;
    const frame = () => {
      raf = 0;

      const rect = story.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      const t = Math.min(1, Math.max(0, -rect.top / total));

      /*
        A beat ticks as its copy passes the middle of the screen — the moment
        you are reading it — not when you leave it.

        `floor(t * n)` was the first version and it is wrong at both ends. It
        ticks a beat only once the reader has scrolled clear of it, so the card
        always lags a section behind what is on screen; and because the last
        beat's band ends at t = 1, the sixth line only checks on the final pixel
        of the story. Measured: at t = 0.99 the card still read 5/6, so the page
        ended on an unfinished plan, which is the opposite of the point.

        `+ 0.6` puts each threshold 40% into its band — just before the copy
        centres, so the line is already checked by the time you are reading the
        sentence it belongs to. Not `+ 0.5`, which puts the threshold exactly
        ON the centre and makes the result knife-edge: sampled at the six exact
        centres it returned 0,1,2,3,5,6 instead of 1..6, because rounding the
        scroll target to a whole pixel landed a hair under the boundary four
        times out of six.

        The last line ticks at t = 0.9, so the card is complete while the
        closing beat is still on screen.
      */
      const n = STORY_BEATS.length;
      const count = Math.min(n, Math.max(0, Math.floor(t * n + 0.6)));
      if (count === last) return;
      last = count;
      done.current = count;

      for (const panel of panels) {
        for (const [i, row] of panel.rows.entries()) {
          // `toggleAttribute` rather than a class: `data-done` is already what
          // the server renders for a completed row, so the live and static
          // states are the same state and the CSS only has to know one of them.
          row.toggleAttribute("data-done", i < count);
        }
        if (panel.badge) panel.badge.textContent = String(count);
      }
    };

    // rAF-coalesced: a fast scroll cannot queue more work than it can do.
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
