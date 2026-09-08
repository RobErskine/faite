"use client";

/**
 * The homepage story: sticky room on the left, product panel and beats
 * scrolling past on the right.
 *
 * Landed as the EI-272 spike, promoted to `/` by EI-275 unchanged in every
 * way that matters — the three invariants it was built to prove are now the
 * three invariants the homepage depends on:
 *
 *  1. three.js is in its own chunk, fetched only after the page has painted
 *     and only on a device that can use it. `next/dynamic` + `ssr: false`,
 *     mounted behind a `canUseWebGL()` gate that runs in an effect - so the
 *     server HTML, and therefore LCP, never depends on it.
 *  2. Scrolling writes to a ref, never to state. React renders this subtree
 *     once; `useFrame` reads the ref at 60fps.
 *  3. The flat version is the real page. Reduced-motion and no-WebGL users
 *     get the static stage, and it says the same thing.
 *
 * `children` and `panel` arrive as an RSC payload from `app/page.tsx`, which
 * is still a Server Component: this file being `"use client"` costs the story
 * its own ~2 KB, not the copy inside it. That is what keeps invariant 1 true
 * now that the story shares a page with the hero.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { canUseWebGL } from "./webgl";

/**
 * The app-shell build (`NEXT_PUBLIC_APP_SHELL=1`, i.e. `npm run build:static`)
 * must not contain a single byte of three.js. That bundle ships inside the
 * Tauri desktop app as a hot-asset payload, where `/` returns only a redirect
 * script and this canvas can never run - so every byte of it is dead weight
 * that every installed client re-downloads (see the EI-255 note in
 * `next.config.ts` on why bundle identity is size-sensitive).
 *
 * `NEXT_PUBLIC_*` is inlined at BUILD time, so this comparison folds to a
 * literal and the bundler drops the `import()` in the dead branch entirely.
 * Measured: 865 KB raw / 227 KB gzipped removed from `.next-static`.
 */
const IS_APP_SHELL = process.env.NEXT_PUBLIC_APP_SHELL === "1";

const RoomScene = IS_APP_SHELL
  ? () => null
  : dynamic(() => import("./room-scene"), { ssr: false, loading: () => null });

export function RoomStage({
  panel,
  children,
}: {
  /**
   * The product, pinned above the copy: the "Plan living room move" card and
   * its sub-tasks. Sticky rather than scrolling with the beats, so the room
   * on the left and the list on the right are on screen together for the
   * whole story — the entire reason the two halves are side by side.
   *
   * A slot rather than something this component builds, because it is board
   * UI and this file is the scene. EI-278 makes what is inside it move.
   */
  panel?: ReactNode;
  children: ReactNode;
}) {
  const section = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const [enabled, setEnabled] = useState(false);

  // Deferred to the next frame rather than called in the effect body: it keeps
  // `react-hooks/set-state-in-effect` happy AND it is what we actually want -
  // the probe, and therefore the chunk fetch, lands strictly after first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setEnabled(!IS_APP_SHELL && canUseWebGL()),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = section.current;
    if (!el) return;

    let raf = 0;
    const read = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      progress.current = Math.min(1, Math.max(0, -rect.top / total));
    };
    // rAF-coalesced so a fast scroll cannot queue more work than it can do.
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return (
    <div ref={section} className="relative grid md:grid-cols-2">
      {/*
        Full bleed: no gap, no padding, no border, no radius. The stage owns
        exactly half the viewport and meets its left and bottom edges. A card
        with a rounded border reads as a component demo; an edge-to-edge stage
        reads as a place.

        Sticky at EVERY width, not just `md:`. Stacked and unpinned, the room
        scrolls away after one screen and never comes back — so the phone gets
        a decorative picture at the top of an article, and the argument the
        page is making (this room, and the list that is doing it, at the same
        time) is only ever made on a desktop. Pinned to the top 45vh instead,
        the beats read underneath it and the camera keeps moving the whole way
        down.

        `bg-background` on the outer box is what makes that safe: a sticky
        element stays in flow, so the beats scroll UP BEHIND this one, and
        `bg-muted/30` is a tint, not a backdrop — the copy would have shown
        straight through it.
      */}
      <div className="sticky top-0 h-[45vh] bg-background md:h-dvh">
        <div className="h-full bg-muted/30">
          {enabled ? <RoomScene progress={progress} /> : <StaticStage />}
        </div>
      </div>

      {/*
        The measure constraint moved off the page and onto the text. At 50% of
        a 27" display this column is ~120 characters wide, which is unreadable
        - so the copy keeps a max-width and its own padding while the canvas
        beside it does not.
      */}
      <div className="flex flex-col px-6 sm:px-10 lg:px-16">
        <div className="flex w-full max-w-xl flex-col">
          {panel && (
            /*
              Pinned beside the room on a desktop; a card that scrolls by once,
              above the beats, on a phone.

              Two sticky elements do not fit on a 844px screen — the room's
              45vh and this card's ~250px would leave about a third of a
              viewport for the copy. The room wins that trade: it is the thing
              that changes as you scroll, and EI-278's ticking degrades to a
              static card by design (its own ticket says so) whereas a room
              that cannot be seen degrades to nothing.

              `bg-background` where it IS pinned is load bearing, not
              decoration: a sticky element stays in flow, so the beats scroll
              underneath this one rather than being pushed by it, and without
              an opaque backdrop the two would overprint.
            */
            <div className="z-10 bg-background pt-6 pb-4 md:sticky md:top-0">{panel}</div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The no-WebGL / reduced-motion stage. Deliberately not a spinner and not an
 * apology: it is the same information, held still.
 */
function StaticStage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex gap-3" aria-hidden>
        {["#c8ccc4", "#d8c3a5", "#a8b8c8"].map((c) => (
          <div
            key={c}
            className="size-16 rounded-sm border shadow-sm"
            style={{ background: c }}
          />
        ))}
      </div>
      <p className="max-w-xs text-center text-sm text-muted-foreground">
        Three paint swatches, up on the wall since July. Still there.
      </p>
    </div>
  );
}
