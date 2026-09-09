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
/**
 * Raycast's own mark, inline rather than an asset.
 *
 * Taken from the logo Raycast ships in its own developer docs, with the
 * baked-in background rect dropped so the glyph can take `currentColor`. That
 * is what lets it read correctly in both themes from one copy, and it adds no
 * new brand color — `docs/DESIGN.md` §6. Inline also keeps it a single
 * request: the whole mark is smaller than the headers it would take to fetch.
 *
 * `aria-hidden` because the words "Also in Raycast" sit directly beside it. A
 * screen reader announcing the logo too would simply say it twice.
 */
function RaycastMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="m15 8-.73.73-2.77-2.77V4.5zM8 1l-.73.73 2.77 2.769h1.46zM6.433 2.57l-.73.73 1.201 1.203h1.46zM11.5 7.636v1.461l1.202 1.202.73-.73zm-.418 2.716.418-.418H6.068V4.5l-.418.418-.784-.784-.733.732.784.784-.418.418v.84L3.297 5.706l-.73.73L4.498 8.37v1.667L1.731 7.27 1 8l7 7 .73-.73-2.768-2.77h1.673l1.933 1.933.73-.73-1.2-1.203h.84l.418-.418.784.784.73-.73z" />
    </svg>
  );
}

/**
 * Where the extension will live once it is public (EI-314). Publishing under
 * the organization keeps this slug, so the URL is already correct — it is the
 * visibility that is not.
 */
export const RAYCAST_STORE_URL = "https://www.raycast.com/erskine-interactive/faite";

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
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground">
            <RaycastMark className="size-4" />
            Also in Raycast
          </p>
          <h2
            id="raycast-callout-heading"
            className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Capture it without opening anything.
          </h2>
          {/*
            `text-pretty` rather than `text-balance`: this is a three-line
            paragraph, and what was wrong with it was a one-word last line.
            `pretty` exists for exactly that — it prevents orphans without
            evening out the line lengths above, which is what `balance` does
            and which reads oddly on body copy.
          */}
          <p className="text-pretty text-lg text-muted-foreground">
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
            "Coming soon", and not a link, because the store page does not
            exist yet — the extension is published privately to one
            organization. Linking to `raycast.com/erskine-interactive/faite`
            today sends everyone who is not a member to a page they cannot
            see, which is `docs/HOMEPAGE.md` §4's fidelity rule broken in the
            other direction: advertising something the reader cannot have.

            When EI-314 publishes it publicly the slug does not change, so
            flipping this is deleting the span and restoring a link to
            RAYCAST_STORE_URL. Kept as a constant so that is one edit.
          */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "pointer-events-none opacity-70",
              )}
              aria-disabled
            >
              Coming to the Raycast Store
            </span>
            <Link
              href="/docs"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Or build on the API it uses
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
