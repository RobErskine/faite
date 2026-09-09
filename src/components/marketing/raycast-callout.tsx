import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Faite from the Raycast launcher, at the foot of the homepage.
 *
 * Deliberately AFTER the closing call to action rather than woven into the
 * story. The three movements make one argument — write it down, give it a day,
 * let the board carry it — and an integration is not part of that argument. It
 * is the answer to a question a reader only has once they have accepted it:
 * "do I have to open the app every time?"
 *
 * A Server Component with no client JS, like the rest of `/`. See
 * `docs/HOMEPAGE.md` §4 — the same invariant, and `demo-board.test.ts` guards
 * this file too.
 *
 * ## Why plain `<img>` and not `next/image`
 *
 * The site's static export sets `images: { unoptimized: true }`, so
 * `next/image` would do no optimizing here — it would only add a component
 * whose value is the optimization. The images are pre-sized WebP (1400px,
 * ~30-55 KB), carry explicit dimensions so they reserve their space and shift
 * nothing, and load lazily because they sit below the fold by construction.
 */

/**
 * Real screenshots of the shipped extension, not mockups.
 *
 * That matters more here than usual: `docs/HOMEPAGE.md` §4's fidelity rule is
 * that the homepage must not show a feature the product does not have, and the
 * cheapest way to break it is a hand-drawn "screenshot" of an interface nobody
 * built. These are captures of the actual commands, counts and all.
 */
const SHOTS = [
  {
    src: "/raycast/my-lists.webp",
    alt: "The Faite extension in Raycast, listing the Today, Overflow and Backlog views with their open counts, above the user's own lists.",
    caption: "Every list and view, with what is actually waiting in each.",
  },
  {
    src: "/raycast/search-todos.webp",
    alt: "Searching to-dos in Raycast, each row showing its list and, where set, its scheduled day.",
    caption: "Search everything, then complete or reschedule without opening Faite.",
  },
] as const;

export function RaycastCallout() {
  return (
    <section
      className="border-t border-border/60 px-4 py-24"
      aria-labelledby="raycast-callout-heading"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-12">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-sm font-medium text-muted-foreground">Also in Raycast</p>
          <h2
            id="raycast-callout-heading"
            className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Capture it without opening anything.
          </h2>
          <p className="text-lg text-muted-foreground">
            Faite has a Raycast extension. Type a to-do and it lands on the
            board, dated and filed — and if you were reading something, the
            to-do remembers the page so you can pick it back up.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {SHOTS.map((shot) => (
            <figure key={shot.src} className="space-y-3">
              {/*
                The captures are dark whatever the reader's theme is, so they
                get a ring and a rounded crop to read as a window sitting on
                the page rather than a hole punched through it.
              */}
              {/*
                eslint-disable-next-line @next/next/no-img-element --
                `next/image` is a CLIENT component (`image-component.js` opens
                with "use client"), so using it here would put a hydration
                runtime on `/` to render two static screenshots — the exact
                thing `docs/HOMEPAGE.md` §4 exists to prevent. It would also
                optimize nothing: the static export sets
                `images: { unoptimized: true }`. Pre-sized WebP with explicit
                dimensions is strictly better here on both counts.
              */}
              <img
                src={shot.src}
                alt={shot.alt}
                width={1400}
                height={887}
                loading="lazy"
                decoding="async"
                className="w-full rounded-xl border border-border/60 shadow-sm ring-1 ring-black/5"
              />
              <figcaption className="text-sm text-muted-foreground">{shot.caption}</figcaption>
            </figure>
          ))}
        </div>

        <div className="mx-auto max-w-2xl space-y-6 text-center">
          <p className="text-muted-foreground">
            It also answers Raycast AI, so you can turn a page of meeting notes
            into to-dos and file them where they belong, in one sentence.
          </p>
          {/*
            Links out to the API docs rather than to the extension. The
            extension is private to one organization today, so a store link
            would send most readers to a page they cannot install from —
            exactly the "advertises what you cannot have" failure §4 warns
            about. The public API is the part anyone can use right now, and it
            is what the extension is built on.
          */}
          <Link
            href="/docs"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            See the API it is built on
          </Link>
        </div>
      </div>
    </section>
  );
}
