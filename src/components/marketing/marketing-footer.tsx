import Link from "next/link";
import { FOOTER_GROUPS, SITE_NAME, SITE_PAGES } from "@/lib/site";

/**
 * Server Component, deliberately — no `usePathname()`, so no `aria-current`
 * on the active link, but also zero client JS added to the otherwise
 * JS-free static pages this renders on.
 *
 * Renders `FOOTER_GROUPS` × `SITE_PAGES.footerGroup`, so a page becomes
 * reachable from the footer purely by setting its `footerGroup` in
 * `site.ts` — nothing here needs to change when a page is added.
 *
 * No copyright year. `src/app/page.tsx` used to render
 * `new Date().getFullYear()`, which freezes at BUILD time under
 * `output: "export"` — a Capacitor/Tauri binary that isn't rebuilt for a
 * while would ship a visibly stale year. Not legally required; omitting it
 * removes the failure mode entirely.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_GROUPS.map((group) => {
            const pages = SITE_PAGES.filter((p) => p.footerGroup === group.id);
            if (pages.length === 0) return null;

            return (
              <div key={group.id} className="space-y-2.5">
                {/* Same treatment as help-sheet.tsx's scope headings — one
                    label style for "a small group of links" app-wide. */}
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="space-y-1">
                  {pages.map((page) => (
                    <li key={page.path}>
                      <Link
                        href={page.path}
                        className="inline-flex items-center rounded-sm text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                      >
                        {page.footerLabel ?? page.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="mt-8 border-t pt-6 text-xs text-muted-foreground">
          <span>© {SITE_NAME}</span>
        </div>
      </div>
    </footer>
  );
}
