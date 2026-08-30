import Link from "next/link";
import { DesktopUpdateRow } from "./desktop-update-row";

const LINKS = [
  { href: "/about", label: "About Faite" },
  { href: "/help", label: "Help" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
] as const;

/**
 * Settings → About. Not a `SITE_PAGES`-driven list (unlike `MarketingFooter`)
 * because these are `next/link`s reachable from inside the signed-in app
 * shell, not the marketing footer — reusing the same table would couple two
 * things that happen to look similar today but serve different audiences.
 *
 * `next/link` to in-bundle routes, not an external URL: this is the App
 * Store 5.1.1(i) requirement (an in-app privacy policy link that works
 * offline) — a plane-mode Capacitor/Tauri build resolves these from the
 * bundle, where an `https://myfaite.app/privacy` link would just fail.
 */
export function AboutSection() {
  return (
    <nav aria-label="About Faite" className="flex flex-col gap-1">
      {/* Desktop shell only — renders null in a browser tab. Above the links
          because "am I running the current build?" is the question this
          section gets asked in the app that can be stale. */}
      <DesktopUpdateRow />

      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
