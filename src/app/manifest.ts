import type { MetadataRoute } from "next";

// Required under `output: "export"` (`npm run build:static`, the Capacitor
// guard) — without it the static export build fails outright, since a route
// handler has no default rendering mode to fall back to without a server.
// The content here is already static (no request-time data), so this just
// makes explicit what was already true.
export const dynamic = "force-static";

/**
 * PWA manifest — enables "Add to Home Screen" / `display: standalone` today,
 * and is Capacitor-compatible: under `output: "export"` (`npm run
 * build:static`) this file-convention route emits a static
 * `manifest.webmanifest` the same as any other build. See docs/MOBILE.md.
 *
 * Icons (`public/icon-*.png`) are generated from `assets/icons/` via
 * `npm run icons` — regenerate them, don't hand-edit the PNGs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Faite",
    short_name: "Faite",
    description: "Control your fate by getting things done.",
    // Not "/" — the marketing page is a one-time pitch; a device that has
    // already installed the app should reopen straight into it.
    start_url: "/board",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
