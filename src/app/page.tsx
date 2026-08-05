import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonVariants } from "@/components/ui/button";
import { BOUND_OWNER_KEY } from "@/lib/store/owner";
import { cn } from "@/lib/utils";

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
 * Marketing page. A Server Component with no client JS of its own — the one
 * inline script above is the only thing that runs before the board would take
 * over, and it is not a hydration boundary, so this stays static-export clean
 * (`npm run build:static`, the Capacitor guard) with nothing to break.
 */
export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: redirectIfKnownDevice }} />

      <div className="flex min-h-dvh flex-col">
        <MarketingHeader />

        <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 text-center">
          <div className="space-y-3">
            <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
              Faite
            </h1>
            <p className="text-lg text-muted-foreground">
              Control your fate by getting things done.
            </p>
          </div>

          <Link
            href="/board"
            className={cn(buttonVariants({ variant: "default", size: "lg" }), 'text-center flex p-4 max-h-auto')}
          >
            Open the board <em className="text-xs">(free and offline)</em>
          </Link>
        </main>

        <footer className="flex items-center justify-center gap-4 px-4 py-6 text-sm text-muted-foreground">
          {/* Docs and support links land here later. */}
          <span>© {new Date().getFullYear()} Faite</span>
        </footer>
      </div>
    </>
  );
}
