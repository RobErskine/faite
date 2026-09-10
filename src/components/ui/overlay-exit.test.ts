import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every animated overlay must hold its exit's final frame until it unmounts.
 *
 * `tw-animate-css` builds `animate-out` with
 * `var(--tw-animation-fill-mode, none)`, and its `exit` keyframe declares only
 * a `to` frame. So the instant an exit animation ends, the element reverts to
 * its BASE computed style — an opaque backdrop, or a panel back at its resting
 * position — and stays there until the node is removed. Base UI waits for the
 * LONGEST animation in the popup before unmounting, so there is always a
 * window, and the two are never the same length by accident.
 *
 * Measured on the to-do sheet before `fill-mode-forwards` was added: the
 * backdrop's opacity ran down to 0.00005 at 188ms, snapped back to 1 at 206ms,
 * and unmounted at 223ms. Two frames of full dim after the sheet had visibly
 * gone. Reported as "it flashes at the end".
 *
 * Asserted against the SOURCE rather than a render because the rule is about
 * all three primitives at once, and two of them have no cheap harness here.
 * `todo-sheet.test.tsx` covers the sheet's overlay through a real render,
 * where tailwind-merge has actually run.
 */
const OVERLAYS = [
  "src/components/ui/sheet.tsx",
  "src/components/ui/dialog.tsx",
  "src/components/ui/alert-dialog.tsx",
];

describe("animated overlays hold their exit frame", () => {
  for (const path of OVERLAYS) {
    it(`${path} — both the backdrop and the panel set fill-mode-forwards`, () => {
      const source = readFileSync(path, "utf8");
      const occurrences = source.match(/data-closed:fill-mode-forwards/g) ?? [];
      // One for the backdrop, one for the panel. A file with only one has
      // grown a surface that can still snap back.
      expect(occurrences).toHaveLength(2);
    });

    it(`${path} — nothing declares an exit without it`, () => {
      const source = readFileSync(path, "utf8");
      // Every `data-closed:animate-out` needs a matching hold. Counting is
      // enough: this catches a fourth overlay being added without one.
      const exits = source.match(/data-closed:animate-out/g) ?? [];
      const holds = source.match(/data-closed:fill-mode-forwards/g) ?? [];
      expect(holds.length).toBeGreaterThanOrEqual(exits.length);
    });
  }
});
