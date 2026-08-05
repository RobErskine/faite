import type { Metadata } from "next";
import { Agentation } from "agentation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRING_IDS,
  FONT_STORAGE_KEY,
} from "@/lib/fonts";
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
  title: "Faite",
  description: "Control your fate by getting things done.",
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
        {process.env.NODE_ENV === "development" && (
          <Agentation endpoint="http://localhost:4747" />
        )}
      </body>
    </html>
  );
}
