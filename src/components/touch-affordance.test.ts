import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the P1 fix in docs/MOBILE.md §3: a control revealed only via
 * `group-hover:opacity-100` is invisible — not degraded, invisible — on any
 * device that can never hover, because Tailwind v4 gates `group-hover:`
 * behind `@media (hover: hover)`. The fix is a `touch:opacity-100` sibling
 * (the custom variant in globals.css); this test is what stops the fifth
 * instance of "forgot the touch fallback" from shipping unnoticed the way
 * the first four did.
 *
 * Scans class-string literals for `opacity-0` co-occurring with
 * `group-hover` and requires `touch:` in the SAME literal. That's a real
 * limitation, not just a simplification: a future control that spreads
 * `opacity-0` and `group-hover:opacity-100` across two separate strings
 * passed to `cn()` would slip past this — but every instance in this
 * codebase today keeps the whole reveal in one literal (it reads better
 * that way too), so this catches the actual failure mode without needing a
 * real CSS/JSX parser.
 */

const COMPONENTS_DIR = join(import.meta.dirname, "..", "components");

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function collectTsxFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsxFiles(path));
    } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      files.push(path);
    }
  }
  return files;
}

describe("hover-only reveals have a touch fallback", () => {
  for (const file of collectTsxFiles(COMPONENTS_DIR)) {
    const relative = file.slice(COMPONENTS_DIR.length + 1);
    const source = readFileSync(file, "utf8");
    const literals = source.match(STRING_LITERAL) ?? [];

    const offenders = literals.filter(
      (literal) =>
        literal.includes("opacity-0") &&
        literal.includes("group-hover") &&
        !literal.includes("touch:"),
    );

    it(`${relative} has no hover-only reveal missing a touch fallback`, () => {
      expect(offenders).toEqual([]);
    });
  }
});
