import { format, parseISO } from "date-fns";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { sitePage } from "@/lib/site";

interface PageShellProps {
  /** Route path; looks up title/description/updated from SITE_PAGES. */
  path: string;
  children: React.ReactNode;
}

/**
 * Frame for every static marketing/legal/support page — header, `<main>`,
 * footer — the same job `AuthShell` does for the auth pages. Takes a `path`
 * rather than title/description props so the `<h1>`, the lede, the sitemap
 * entry, and `pageMetadata()`'s `<meta description>` all read from the one
 * `SITE_PAGES` row; they cannot drift apart, and a page with no row is a
 * build error (`sitePage()` throws).
 *
 * `max-w-2xl` (42rem) is a reading measure, not a container width: at
 * `text-sm` it lands around 75 characters per line, which is where long-form
 * legal copy stops being a wall of text.
 */
export function PageShell({ path, children }: PageShellProps) {
  const page = sitePage(path);
  if (page.title === null) {
    throw new Error(`[PageShell] "${path}" has no title — it isn't meant to use PageShell.`);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <header className="space-y-3 pb-10">
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {page.title}
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg">{page.description}</p>
            {page.showUpdated ? (
              // `num`: the app's standalone-numeric utility (globals.css) —
              // tabular figures, slashed zero — reused here for the date.
              <p className="num text-xs text-muted-foreground">
                Last updated{" "}
                <time dateTime={page.updated}>
                  {format(parseISO(page.updated), "d MMMM yyyy")}
                </time>
              </p>
            ) : null}
          </header>

          {children}
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
