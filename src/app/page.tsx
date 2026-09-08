import Link from "next/link";
import { DemoBoard } from "@/components/marketing/demo-board";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonVariants } from "@/components/ui/button";
import { pageMetadata } from "@/lib/metadata";
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
 * Marketing page. A Server Component with no client JS of its own — the one
 * inline script above is the only thing that runs before the board would take
 * over, and it is not a hydration boundary, so this stays static-export clean
 * (`npm run build:static`, the Capacitor guard) with nothing to break.
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

        {/*
          The hero. Text first, board second, and in that order in the markup
          too — the headline is the LCP element and it is plain server-rendered
          HTML, which is the rule EI-272 exists to protect (and the rule the 3D
          room in EI-275 will land underneath).
        */}
        <main className="flex flex-1 flex-col items-center gap-10 px-4 pt-16 sm:pt-24">
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
              Open the board <em className="text-xs not-italic opacity-80">(free and offline)</em>
            </Link>
          </div>

          {/*
            The board itself, cropped by the fold rather than shrunk to fit it.

            `max-h-[60vh]` with `overflow-hidden` is what makes the bottom edge
            run off the screen, and the gradient over it says the page
            continues — the invitation into the scroll story. A `scale`
            transform was the other option and is worse: it would blur the type
            it exists to show off, and it leaves the untransformed box behind in
            layout, so the fold would land in the wrong place.
          */}
          <div className="relative w-full max-w-6xl">
            <div className="max-h-[60vh] overflow-hidden">
              {/*
                A fixed width, cropped — never a board squeezed to fit.

                Below ~1150px the columns would otherwise share out whatever is
                left: at phone width that is four ~90px columns, every heading
                truncated to "WEDNE…" and every badge clipped mid-word. The
                product does not look like that on a phone (it renders
                `PhoneBoard`, one column at a time), so a shrunken desktop board
                is not a smaller picture of the truth — it is a picture of
                something broken. Held at full size and clipped on the right, a
                narrow screen gets a window onto a real board instead, with
                Overflow and today — the two columns the story needs — always
                the ones in frame.
              */}
              <DemoBoard className="w-6xl max-w-none" />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-background" />
          </div>
        </main>

        <MarketingFooter />
      </div>
    </>
  );
}
