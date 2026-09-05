import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The desktop bundle must not carry assets the app shell cannot reach.
 *
 * This exists because the failure is invisible twice over: nothing breaks, no
 * test goes red, and the only symptom is that every installed client
 * re-downloads weight it will never use. It has now happened twice on EI-272 —
 * once with three.js (865 KB, caught by a grep) and once with the scene's GLB
 * (240 KB, caught by an `ls`). Both were found by hand. This is the version
 * that does not need someone to remember to look.
 *
 * Asserting on the source rather than on a built export is deliberate: the
 * export takes ~30s to produce and would make this a build test rather than a
 * unit test. What can regress cheaply is the exclusion list being emptied or
 * the filter being dropped from `main()`, and both are visible here.
 */
/**
 * Lives under `src/` rather than beside the script it guards, because
 * `vitest.config.ts` only collects `src/**` and `e2e/**` — a spec written next
 * to `scripts/desktop/bundle-assets.mjs` is silently never run, which is the
 * same shape of bug it exists to prevent.
 */
const SOURCE = readFileSync(
  new URL("../../../scripts/desktop/bundle-assets.mjs", import.meta.url),
  "utf8",
);

describe("the desktop asset bundle", () => {
  it("excludes the marketing 3D scene", () => {
    // `public/scene/` is copied into `.next-static` by `next build`, but `/`
    // in an app-shell build returns only a redirect script, so the canvas
    // never mounts and the GLB is never fetched.
    expect(SOURCE).toContain('"/scene/"');
  });

  it("still applies the exclusion filter when collecting paths", () => {
    // The list is worthless if nothing calls it. Catches a refactor that keeps
    // DESKTOP_EXCLUDED around as decoration.
    expect(SOURCE).toMatch(/walk\(EXPORT_DIR\)\s*\.filter\(isDesktopPayload\)/);
  });

  it("keeps the app shell's own entry point", () => {
    // A filter broad enough to drop the boot file would produce a bundle that
    // installs and then cannot start.
    expect(SOURCE).toContain("refusing to publish a bundle nothing can boot");
  });
});
