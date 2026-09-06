import Link from "next/link";
import { CardTravel } from "@/components/marketing/card-travel";
import { DemoBoard } from "@/components/marketing/demo-board";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { StoryPanel } from "@/components/marketing/story-panel";
import { RoomStage } from "@/components/scene/room-stage";
import { buttonVariants } from "@/components/ui/button";
import { pageMetadata } from "@/lib/metadata";
import { STORY_BEATS } from "@/lib/story-beats";
import { BOUND_OWNER_KEY } from "@/lib/store/owner";
import { cn } from "@/lib/utils";

export const metadata = pageMetadata("/");

/**
 * Redirects a returning, already-adopted visitor straight to /board before
 * this page paints, same technique as the font/theme scripts in
 * `app/layout.tsx`: an inline script reading `localStorage` synchronously,
 * ahead of hydration.
 *
 * Deliberately the RAW local marker, not a session check — this only needs
 * to answer "has this browser used the board before", and a plain
 * `localStorage.getItem` is both simpler and faster than waiting on
 * `useSession()`'s network round trip for a redirect this low-stakes. A user
 * this misses just sees the marketing page once and clicks through.
 *
 * See docs/ARCHITECTURE.md §2.13 for why the in-board nudges use a more
 * careful check than this one does.
 */
const redirectIfKnownDevice = `try{if(localStorage.getItem(${JSON.stringify(
  BOUND_OWNER_KEY,
)}))window.location.replace("/board")}catch(e){}`;

/**
 * Unconditional redirect, for the app-shell build only.
 *
 * `NEXT_PUBLIC_APP_SHELL` is set exclusively by `npm run build:static`
 * (package.json) — the Capacitor target. A `output: "export"` bundle has no
 * server to run a real redirect on, and ships inside a WebView where "/" has
 * no reason to ever be a marketing pitch: there is no marketplace listing to
 * land a stranger on it, only a device that already has the app installed.
 * `next/navigation`'s `redirect()` doesn't fit either — this needs to run in
 * the browser, ahead of any React hydration, the same technique as
 * `redirectIfKnownDevice` above, not during static generation.
 */
const redirectToBoard = `window.location.replace("/board")`;

/**
 * The homepage: the board, the room, and the story (EI-273).
 *
 * Three movements. The board opens it, one to-do off that board carries you
 * through the room, and the board closes it.
 *
 * # Still a Server Component
 *
 * Everything here is server-rendered HTML except `RoomStage`, which is
 * `"use client"` and whose `panel`/`children` are passed in from this file as
 * an RSC payload — so the hero, the copy, the citations and the closing CTA
 * all paint before a line of the story's JavaScript runs, and three.js is not
 * fetched at all until a `requestAnimationFrame` after first paint confirms
 * the device can use it. That ordering is EI-272's whole finding, and it is
 * what makes a 3D homepage defensible on the one page whose entire audience is
 * a cold-cache stranger.
 *
 * # The app-shell branch
 *
 * The early return below is not a nicety. `npm run build:static` prerenders
 * this route into the payload that ships inside the desktop app, where `/` is
 * never a pitch — so it returns a redirect and nothing else. What keeps the
 * *code* out as well is `IS_APP_SHELL` in `room-stage.tsx`, which folds at
 * build time; `next/dynamic` alone defers fetching without removing the module
 * from the graph, and that mistake cost 865 KB once already (`.ai/lessons.md`).
 */
export default function Home() {
  if (process.env.NEXT_PUBLIC_APP_SHELL === "1") {
    return <script dangerouslySetInnerHTML={{ __html: redirectToBoard }} />;
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: redirectIfKnownDevice }} />

      <div className="flex min-h-dvh flex-col">
        <MarketingHeader />

        <main className="flex flex-1 flex-col">
          {/*
            MOVEMENT ONE — the board.

            Text first, board second, in the markup as well as on screen: the
            headline is the LCP element and it is plain server-rendered HTML.
          */}
          {/*
            A full viewport, so the board is the only thing on screen and the
            fold is a real edge rather than wherever the content happened to
            stop. `justify-between` puts the pitch at the top and lets the
            board run off the bottom; `overflow-hidden` is what crops it.
          */}
          <section className="flex min-h-dvh flex-col items-center justify-between gap-10 overflow-hidden px-4 pt-16 sm:pt-24">
            <div className="flex flex-col items-center gap-8 text-center">
              <div className="space-y-3">
                <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
                  Control your fate by getting things done.
                </h1>
                <p className="mx-auto max-w-xl text-lg text-muted-foreground">
                  One board for the days ahead and the work waiting on them. It
                  runs offline, on your own device, and it is free.
                </p>
              </div>

              <Link
                href="/board"
                className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-1.5")}
              >
                Open the board{" "}
                <em className="text-xs not-italic opacity-80">(free and offline)</em>
              </Link>
            </div>

            {/*
              The board itself, cropped by the fold rather than shrunk to fit
              it — and held at a fixed width rather than squeezed into a narrow
              one. See `demo-board.tsx` for why a shrunken desktop board is a
              picture of something broken rather than a smaller picture of the
              truth. The gradient says the page continues, which is the
              invitation into the story below.
            */}
            <div className="relative w-full max-w-6xl flex-1 overflow-hidden">
              <DemoBoard className="w-6xl max-w-none" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-background" />
            </div>
          </section>

          {/*
            MOVEMENT TWO — the room.

            One to-do off the board above, followed all the way through. The
            room is on the left, the card and the copy on the right, and the
            reason they are side by side rather than in sequence is that the
            argument only lands when you can see both at once.
          */}
          {/*
            `data-story` is the travel's clock (`card-travel.tsx`): the card
            flies over the last viewport of scrolling before this section
            reaches the top, so the hero hands off to the story exactly as the
            room takes over.
          */}
          <section className="mt-24" aria-label="How Faite works" data-story>
            <RoomStage panel={<StoryPanel />}>
              {STORY_BEATS.map((beat) => (
                <div
                  key={beat.headline}
                  /*
                    Shorter blocks on a phone, where the stage is pinned across
                    the top 45vh and only the bottom 55vh is clear. A block
                    sized to the clear region keeps each beat centered in the
                    part of the screen the reader can actually see it in; at
                    80vh the copy spent most of its travel either behind the
                    room or below the fold.
                  */
                  className="flex min-h-[55vh] flex-col justify-center py-10 md:min-h-[80vh] md:py-12"
                >
                  <h2 className="font-heading text-3xl font-semibold tracking-tight">
                    {beat.headline}
                  </h2>
                  <p className="mt-4 text-muted-foreground">{beat.body}</p>
                  {/*
                    A bare surname and a year, for now. EI-277 puts the finding
                    in plain language in front of it — "research shows …" —
                    because a citation nobody can read is a claim nobody can
                    check.
                  */}
                  <p className="mt-4 text-xs text-muted-foreground">{beat.cite}</p>
                </div>
              ))}
            </RoomStage>
          </section>

          {/*
            MOVEMENT THREE — back to the board.

            The room is finished and the card is done, so the page ends where
            it began, on the product, with the one thing left to do.
          */}
          <section className="flex flex-col items-center gap-8 px-4 py-24 text-center">
            <div className="space-y-3">
              <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                That is the whole idea.
              </h2>
              <p className="mx-auto max-w-xl text-lg text-muted-foreground">
                Write it down, give it a day, and let the board carry it until
                you do it, move it, or let it go.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/board"
                className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-1.5")}
              >
                Open the board{" "}
                <em className="text-xs not-italic opacity-80">(free and offline)</em>
              </Link>
              {/*
                Sign-up is the secondary action on purpose, here and in the
                header: the board works with no account at all, and leading
                with one would contradict the sentence directly above it. An
                account is what syncs it to another device, which is a reason
                to make one later.
              */}
              <Link
                href="/signup"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Create an account to sync
              </Link>
            </div>
          </section>
          {/*
            The copy that flies from the board into the story (EI-278).
            Rendered here as server HTML and handed to a client component that
            does nothing but position it — so with no JavaScript it stays
            hidden and costs nothing, and the two real cards carry the page on
            their own.

            LAST in the document, not first. It is a fixed overlay, so its
            position in the flow is arbitrary for layout — but not for reading
            order, and a hidden duplicate of the hero's card sitting ahead of
            the real one is what any "first match" lands on.
          */}
          <CardTravel>
            <StoryPanel flying />
          </CardTravel>
        </main>

        <MarketingFooter />
      </div>
    </>
  );
}
