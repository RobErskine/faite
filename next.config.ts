import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

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
};

export default nextConfig;

// Makes Cloudflare bindings available via getCloudflareContext() during `next dev`.
// No-op outside `next dev`, so it is safe to call unconditionally.
initOpenNextCloudflareForDev();
