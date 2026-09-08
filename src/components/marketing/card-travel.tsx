"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The card that follows you off the board and into the story (EI-278).
 *
 * "Plan living room move" is one row in the hero board and the whole subject of
 * the story below it. Left alone, the first scrolls away and the second is
 * simply already there — two pictures of the same to-do that the reader has no
 * reason to connect. So a third copy flies between them: it leaves the board,
 * crosses the page, widens, and unfolds its five sub-tasks as it lands in the
 * panel beside the room.
 *
 * # How it works
 *
 * FLIP, with the F and the L both measured live. Every frame reads the real
 * origin row and the real resting card — neither is ever moved — and puts this
 * copy somewhere between them. Because both ends are measured rather than
 * remembered, a resize, a font swap, or a reflow mid-scroll self-corrects on
 * the next frame instead of leaving the card stranded at coordinates that were
 * true a second ago.
 *
 * Four things interpolate:
 *
 * | | from | to |
 * |---|---|---|
 * | `translate` | the board row | the panel's resting place |
 * | `width` | the Monday column | the copy column |
 * | list height | 0 | its natural height |
 * | opacity | crossfades at both ends | |
 *
 * The crossfades are what let the two real cards differ. The board row and the
 * panel header are not the same markup — one has a drag-gutter checkbox and a
 * clamped title, the other a bordered card with a shadow — so a hard handoff
 * would pop. Over the first and last 12% nobody can tell.
 *
 * Height and width do cost layout, on this one small subtree, once a frame.
 * That is the deliberate trade: the honest alternative is `scale()`, which is
 * cheaper and wrong — it would zoom the title from 14px to 35px and blur every
 * glyph on the way, when what the card actually does is *widen and unfold*.
 *
 * # What it does not do
 *
 * Write React state. Same rule as the scene (`docs/SCENE.md` §2): scroll goes
 * to a ref, the rAF loop writes styles imperatively, and this component renders
 * exactly once.
 *
 * # When it does nothing at all
 *
 * Reduced motion, no JavaScript, or a viewport under `md`. In every one of
 * those the two real cards are already correct on their own — that is why
 * `story-panel.tsx` renders a true static state rather than an empty shell —
 * so the fallback is not a fallback, it is the page with one flourish missing.
 * On a phone specifically the panel is not sticky and the room is, so there is
 * no fixed destination to fly to; see `room-stage.tsx` for why that trade went
 * the way it did.
 */

/** Fraction of the travel spent fading in at the start, and out at the end. */
const FADE = 0.12;

const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Slow at both ends, so the card settles rather than arrives. */
const ease = (t: number) => t * t * (3 - 2 * t);

export function CardTravel({ children }: { children: ReactNode }) {
  const flyer = useRef<HTMLDivElement>(null);
  /** Scroll progress, 0 → 1. A ref, never state — this subtree renders once. */
  const progress = useRef(0);

  useEffect(() => {
    const el = flyer.current;
    if (!el) return;

    // `matchMedia` rather than a CSS breakpoint: the whole effect is imperative,
    // so the gate has to be readable from JS. `md` is 48rem in Tailwind v4.
    const fine = window.matchMedia("(min-width: 48rem)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches || !fine.matches) return;

    const origin = document.querySelector<HTMLElement>("[data-travel-origin]");
    const target = document.querySelector<HTMLElement>("[data-travel-target]");
    const story = document.querySelector<HTMLElement>("[data-story]");
    const list = el.querySelector<HTMLElement>("[data-subtask-list]");
    if (!origin || !target || !story || !list) return;

    // Measured once, off the resting card, because the flying copy's own list
    // is held at a height for the whole flight and so can never report it.
    let listHeight = target.querySelector<HTMLElement>("[data-subtask-list]")?.offsetHeight ?? 0;

    let raf = 0;
    const frame = () => {
      raf = 0;

      // Every read first, then every write. Interleaving them would force a
      // synchronous layout per property instead of one per frame.
      const scrolled = window.scrollY;
      const viewport = window.innerHeight;
      const storyTop = story.getBoundingClientRect().top;
      const o = origin.getBoundingClientRect();
      const g = target.getBoundingClientRect();

      /*
        The window is bounded so that BOTH ends stay on screen for the whole
        flight — which the obvious version does not.

        Running it over the last viewport before the story looked right on
        paper and was wrong in the browser: the board row sits ~445px down a
        100vh hero, so it had left the top of the screen by the time the card
        was a third of the way across. The reader saw a card arrive from
        nowhere, having never seen it leave.

        So the start is pinned to the ORIGIN (a quarter of the way down, while
        the board is still plainly there) and the end to the STORY (just over
        half, while the panel is plainly there). Both in document coordinates,
        because a viewport-relative window that moves as you scroll through it
        is circular.
      */
      const startY = o.top + scrolled - viewport * 0.25;
      const endY = storyTop + scrolled - viewport * 0.55;
      const t = clamp((scrolled - startY) / Math.max(1, endY - startY));
      progress.current = t;

      // Parked at either end: the real cards are on screen and correct, so the
      // copy gets out of the way entirely rather than sitting invisibly on top
      // of one of them.
      if (t <= 0 || t >= 1) {
        el.style.visibility = "hidden";
        origin.style.opacity = "";
        target.style.opacity = "";
        return;
      }

      /*
        Geometry runs over the MIDDLE band only, so it is exactly on the origin
        for the whole fade-in and exactly on the target for the whole fade-out.

        Easing across the full range instead leaves the copy ~20px short of the
        card it is dissolving into, and two near-identical cards 20px apart at
        50% opacity each read as a ghost rather than a handoff. Measured, not
        guessed: at t=0.92 the copy sat at y=535 and the panel at y=556.
      */
      const e = ease(clamp((t - FADE) / (1 - 2 * FADE)));
      // Fade the copy in over the first slice and out over the last, with each
      // real card doing the opposite, so no frame shows two of the same card
      // and none shows zero.
      const appearing = clamp(t / FADE);
      const leaving = clamp((1 - t) / FADE);
      const alpha = Math.min(appearing, leaving);

      el.style.visibility = "visible";
      el.style.opacity = String(alpha);
      el.style.width = `${lerp(o.width, g.width, e)}px`;
      el.style.transform = `translate3d(${lerp(o.left, g.left, e)}px, ${lerp(o.top, g.top, e)}px, 0)`;
      // Unfolds on the same clock as the travel, so the card is whole by the
      // time the crossfade starts and the two copies match shape as well as
      // position.
      list.style.height = `${lerp(0, listHeight, e)}px`;

      origin.style.opacity = String(1 - appearing);
      target.style.opacity = String(1 - leaving);
    };

    // rAF-coalesced: a fast scroll cannot queue more work than it can do.
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      listHeight = target.querySelector<HTMLElement>("[data-subtask-list]")?.offsetHeight ?? 0;
      onScroll();
    };

    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      // Hand both real cards back exactly as they were found. Without this a
      // fast-refresh in development leaves one of them stuck at opacity 0.
      origin.style.opacity = "";
      target.style.opacity = "";
    };
  }, []);

  return (
    <div
      ref={flyer}
      aria-hidden
      /*
        `visibility: hidden` in the served HTML, not `display: none`: with no
        JavaScript this copy must take up no space and show nothing, but the
        rAF loop still needs to be able to measure inside it on its first frame.

        Fixed, so it is out of flow and can never shift the page — the travel
        has to cost zero CLS, on a page whose whole argument is that nothing is
        ever waiting.
      */
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: 30,
        willChange: "transform, width",
      }}
    >
      {/* The list is sized by the loop, so it has to clip rather than scroll. */}
      <style>{`[data-card-flyer] [data-subtask-list]{overflow:hidden}`}</style>
      <div data-card-flyer>{children}</div>
    </div>
  );
}
