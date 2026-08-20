import Link from "next/link";
import { sitePage } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Vertical rhythm between top-level sections on a legal/support page. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-10">{children}</div>;
}

/**
 * One numbered/titled clause of a page. `id` is required, not optional —
 * "see §4" only works if §4 has a fragment to link to, and support answers
 * routinely need to point at one clause of a policy rather than the whole
 * document.
 */
export function ProseSection({
  id,
  heading,
  level = 2,
  children,
}: {
  id: string;
  heading: string;
  level?: 2 | 3;
  children: React.ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section id={id} className="space-y-3 scroll-mt-16">
      <Heading
        className={cn(
          "font-heading font-semibold tracking-tight",
          level === 2 ? "text-xl" : "text-base",
        )}
      >
        {heading}
      </Heading>
      {children}
    </section>
  );
}

export function ProseText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>;
}

export function ProseList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground marker:text-muted-foreground/50">
      {children}
    </ul>
  );
}

export function ProseItem({ children }: { children: React.ReactNode }) {
  return <li className="pl-1">{children}</li>;
}

/** Lifts a defined term out of the muted body colour without bolding it into a shout. */
export function ProseTerm({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

const proseLinkClassName =
  "font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm";

/**
 * Internal links go through `next/link`; anything with a URL scheme
 * (`mailto:`, `https:`) renders a plain `<a>`. Same underline treatment
 * either way.
 */
export function ProseLink({ href, children }: { href: string; children: React.ReactNode }) {
  return href.includes(":") ? (
    <a href={href} className={proseLinkClassName}>
      {children}
    </a>
  ) : (
    <Link href={href} className={proseLinkClassName}>
      {children}
    </Link>
  );
}

/** Inline "see also" box — used to cross-link, e.g. /help → /support → /contact. */
export function ProseCallout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * A page's "Related" block at the end. Reads title + description straight
 * from `SITE_PAGES` by path, so link text can never drift out of sync with
 * the destination page's actual title.
 */
export function RelatedLinks({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;

  return (
    <nav aria-label="Related" className="space-y-3 border-t pt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Related
      </h2>
      <ul className="space-y-3">
        {paths.map((path) => {
          const page = sitePage(path);
          return (
            <li key={path}>
              <Link
                href={path}
                className="block rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4">
                  {page.footerLabel ?? page.title}
                </span>
                <span className="block text-muted-foreground">{page.description}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
