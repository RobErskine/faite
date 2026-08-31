import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Pins the build ID to the commit instead of letting Next generate a random
 * one (EI-255).
 *
 * A random build ID lands in the export as `_next/static/<id>/…`, so two
 * builds of the *same commit* produce different file paths and therefore a
 * different hot-asset bundle version — and every desktop client re-downloads
 * 3.8 MB to receive bytes it already has. Deriving the ID from HEAD makes a
 * bundle's identity mean "this commit", which is what
 * `scripts/desktop/bundle-assets.mjs` has always claimed it meant.
 *
 * Returning `null` restores Next's default random ID. That is the correct
 * outcome where there is no git (a tarball checkout, some CI images): a
 * needless re-download is a far better failure than every build in an
 * environment sharing one hardcoded ID.
 */
function commitBuildId(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Dual build target: Workers (web) and static export (Capacitor mobile).
// BUILD_TARGET=static is used by the CI guard and the future mobile build.
// Keeping the static build green prevents RSC/middleware/next-image creep
// that would break Capacitor at P7. See plan P0/P7.
const isStaticExport = process.env.BUILD_TARGET === "static";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export",
        distDir: ".next-static",
        // No server at runtime in a WebView, so image optimization is unavailable.
        images: { unoptimized: true },
      }
    : {}),
    allowedDevOrigins: ['10.0.0.3'],
    generateBuildId: commitBuildId,
};

export default nextConfig;

// Makes Cloudflare bindings available via getCloudflareContext() during `next dev`.
// No-op outside `next dev`, so it is safe to call unconditionally.
initOpenNextCloudflareForDev();
