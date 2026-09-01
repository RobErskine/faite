import type { Metadata, Viewport } from "next";
import { Agentation } from "agentation";
import { DesktopShellTasks } from "@/components/desktop/shell-tasks";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRING_IDS,
  FONT_STORAGE_KEY,
} from "@/lib/fonts";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from "@/lib/site";
import {
  DARK_CLASS,
  DEFAULT_THEME_MODE,
  PREFERS_DARK,
  THEME_MODE_IDS,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  // Every relative `alternates.canonical` / `openGraph.url` set by
  // `pageMetadata()` (`src/lib/metadata.ts`) resolves against this. Fixed at
  // the custom domain (`wrangler.jsonc`), including on `*.workers.dev`
  // previews and in the Capacitor/Tauri static export — a preview that
  // self-canonicalised would compete with production for the same queries.
  metadataBase: new URL(SITE_ORIGIN),
  // `default`, not a bare string: `/board` and the auth routes export no
  // metadata of their own, so they keep resolving to exactly "Faite" as
  // before this change. A page that sets a title (via `pageMetadata()`)
  // gets "<title> · Faite" instead.
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Fallback only, for routes that export no metadata of their own (`/board`,
  // the auth routes). Every static page under `src/lib/site.ts`'s SITE_PAGES
  // replaces this wholesale via `pageMetadata()` — see that function for why
  // it has to emit a complete object rather than a partial one.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  // Card type only. Title/description/images are back-filled per page from
  // `openGraph` by Next's metadata resolver; putting a title here would stick
  // to EVERY page, because no page declares a `twitter` key of its own and
  // the merge only touches keys a segment actually sets.
  twitter: { card: "summary_large_image" },
  // `black-translucent` is what makes board content extend under the status
  // bar on iOS when added to the home screen — the payoff for
  // `viewportFit: "cover"` below. Without both, `env(safe-area-inset-*)`
  // resolves to 0 and there's nothing for the inset to protect anyway.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Faite",
  },
  // Tab favicon: transparent-background glyph, one variant per OS theme
  // (`media`, standard `<link>` behavior — the browser swaps it live as the
  // OS theme changes, no JS involved) crossed with which environment built
  // the page. `NEXT_PUBLIC_APP_ENV=development` is set by the `dev` and
  // `preview` npm scripts only, so a real localhost/`preview` tab renders an
  // amber glyph and everything else (prod build, static export) renders
  // black/white — the same literal-`process.env` pattern as
  // `NEXT_PUBLIC_AGENTATION` below, required for Next to inline it at build
  // time. `src/app/favicon.ico` (file convention, always black-on-white) is
  // the legacy fallback for browsers that don't support SVG favicons.
  // Regenerate all four, plus `apple` below, from `assets/icons/` via
  // `npm run icons`.
  //
  // `apple` has to be spelled out here too: setting `icons.icon` opts out of
  // Next's automatic file-convention icon detection for the whole `icons`
  // field (favicon.ico is the one exception — a separate mechanism), so
  // without this line `src/app/apple-icon.png` stops being linked at all.
  icons: {
    icon: [
      {
        url:
          process.env.NEXT_PUBLIC_APP_ENV === "development"
            ? "/favicon/icon-light-dev.svg"
            : "/favicon/icon-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url:
          process.env.NEXT_PUBLIC_APP_ENV === "development"
            ? "/favicon/icon-dark-dev.svg"
            : "/favicon/icon-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Required for `env(safe-area-inset-*)` to resolve to anything but 0, even
  // on hardware with a notch/home-indicator — see the --safe-* vars in
  // globals.css. Deliberately no `maximumScale`/`userScalable: false`: that
  // disables pinch-zoom, which is an accessibility regression, fails a
  // Lighthouse audit, and iOS silently ignores it anyway.
  viewportFit: "cover",
  // Shrinks the layout viewport when a software keyboard opens instead of
  // overlaying it, so `100dvh` inside an open TodoSheet/DaySheet actually
  // means "the space left above the keyboard" (M4 in the mobile plan).
  interactiveWidget: "resizes-content",
  themeColor: [
    // Matches --background in globals.css: oklch(1 0 0) light / oklch(0.145
    // 0 0) dark. The dark value is an sRGB approximation — theme-color is a
    // browser-chrome tint hint, not a rendered pixel, so exactness doesn't
    // matter the way it would for an actual background paint.
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/**
 * Applies the saved font pairing before first paint.
 *
 * The setting of record lives in IndexedDB, which only resolves after
 * hydration — long enough for a visible flash of the default pairing on every
 * load. Board mirrors the setting into localStorage so this can read it
 * synchronously. Wrapped in try/catch because localStorage throws outright in
 * some privacy modes, and a broken font is not worth a blank page.
 */
const applyFontPairing = `try{var f=localStorage.getItem(${JSON.stringify(
  FONT_STORAGE_KEY,
)});if(f&&${JSON.stringify(
  FONT_PAIRING_IDS as readonly string[],
)}.indexOf(f)>-1)document.documentElement.dataset.font=f}catch(e){}`;

/**
 * Applies the saved appearance before first paint.
 *
 * Same job as applyFontPairing, with one wrinkle: "system" has to be RESOLVED
 * here, because the class is what the `dark` custom variant keys off, and CSS
 * alone cannot express "dark tokens, but only when the mode is system".
 *
 * Two separate try/catches, deliberately. localStorage throws outright in some
 * privacy modes; if that took the matchMedia read down with it, exactly the
 * users who cannot persist a choice would also lose the OS default — a white
 * flash on a dark machine, every load.
 *
 * `color-scheme` is NOT set here: globals.css declares it on :root and .dark,
 * so toggling the class carries it. One source of truth.
 */
const applyTheme = `(function(){var m=${JSON.stringify(
  DEFAULT_THEME_MODE,
)};try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(${JSON.stringify(
  THEME_MODE_IDS as readonly string[],
)}.indexOf(s)>-1)m=s}catch(e){}var d=m==="dark";if(m==="system"){try{d=window.matchMedia(${JSON.stringify(
  PREFERS_DARK,
)}).matches}catch(e){}}document.documentElement.classList.toggle(${JSON.stringify(
  DARK_CLASS,
)},d)})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-font={DEFAULT_FONT_PAIRING}
      className={`${fontVariables} h-full antialiased`}
      // The script below rewrites data-font before React hydrates, so the
      // server-rendered value legitimately differs from the DOM.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
          First node in the body, so it runs before any content is parsed and
          well before first paint (stylesheets in <head> already block render).
          React 19 only hoists scripts with `src`, so an inline one has to be
          placed where it needs to execute.
        */}
        <script dangerouslySetInnerHTML={{ __html: applyFontPairing }} />
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        {/* EI-256/EI-257: reports that this frontend rendered, and fetches a
            newer one. Here rather than on the board because BOTH jobs must
            happen on every boot — a signed-out desktop app still came up, and
            still needs to be able to update. */}
        <DesktopShellTasks />
        {/*
          Gated on an explicit flag rather than `NODE_ENV === "development"`.
          Better Auth only works locally under `npm run preview`, and that
          script runs a real `next build` — a PRODUCTION build — so the
          NODE_ENV check compiled this to `false &&` and stripped the toolbar
          from the one local environment where you can actually be logged in.
          It presented as "Agentation only works on :3000", but the port was a
          coincidence: :3000 is `next dev`, :8787 is the preview worker.

          `package.json` sets the flag on `dev` and `preview` and nowhere else,
          so `build`, `build:static`, `start` and `deploy` still strip it. The
          reference has to be a literal `process.env.NEXT_PUBLIC_AGENTATION`:
          Next inlines it at build time and a destructured or computed lookup
          is not substituted at all.
        */}
        {process.env.NEXT_PUBLIC_AGENTATION === "1" && (
          <Agentation endpoint="http://localhost:4747" />
        )}
      </body>
    </html>
  );
}
