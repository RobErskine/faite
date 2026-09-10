import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the P1 fix in docs/MOBILE.md §3: a control revealed only via
 * `group-hover:opacity-100` is invisible — not degraded, invisible — on any
 * device that can never hover, because Tailwind v4 gates `group-hover:`
 * behind `@media (hover: hover)`. This is what stops the fifth instance of
 * "forgot the touch fallback" from shipping unnoticed the way the first four
 * did.
 *
 * The fallback now lives in the `hover-reveal` utility (globals.css) rather
 * than in a `touch:opacity-100` sibling at every call site. That is exactly
 * the kind of refactor that quietly disarms a guard: the old version of this
 * test looked for a literal containing `opacity-0` AND `group-hover` AND no
 * `touch:`, and once `opacity-0` moved into the utility there was nothing
 * left for it to match. It would have gone green by having nothing to say.
 *
 * So it is written the other way round now — it starts from the reveal, which
 * cannot move into the utility (the call sites sit under three different
 * group scopes), and demands that each one names a non-hover path:
 *
 *   1. every `group-hover:…opacity-100` literal carries `hover-reveal` or
 *      `touch:`, and
 *   2. `hover-reveal` actually defines the `(hover: none)` fallback.
 *
 * Test 2 is the load-bearing half. Without it, test 1 only proves the class
 * name is present, and deleting the media query from globals.css would be
 * invisible.
 */

const SRC_DIR = join(import.meta.dirname, "..");
const COMPONENTS_DIR = join(SRC_DIR, "components");
const GLOBALS_CSS = join(SRC_DIR, "app", "globals.css");

/**
 * Comments and string literals in one alternation, so each is consumed whole
 * by whichever starts first. Both halves matter: a `//` inside a class string
 * must not start a comment, and a backticked class name inside a prose comment
 * — which is how these rules get explained — must not read as a literal. The
 * second case is not hypothetical; it failed this test once written the naive
 * way.
 */
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const QUOTES = new Set(['"', "'", "`"]);

function classLiterals(source: string): string[] {
  return (source.match(TOKEN) ?? []).filter((token) => QUOTES.has(token[0]));
}

/**
 * Reveals that reach a touch device by a different route, with the route.
 * An entry here is a claim that the control is reachable without a hover —
 * check it before adding one.
 */
const EXEMPT = new Map<string, string>([
  [
    "marketing/demo-tooltip.tsx",
    // The trigger is its own `tabIndex={0}` span and is visible at rest, so a
    // tap focuses it and `group-focus-within/tip` reveals the label. The label
    // is also present unconditionally in an `sr-only` span. Nothing here is
    // hover-only.
    "tap focuses the visible trigger; group-focus-within reveals it",
  ],
]);

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

describe("the hover-reveal fallback", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");

  it("is defined as a utility", () => {
    expect(css).toContain("@utility hover-reveal");
  });

  it("resolves to visible where no pointer can hover", () => {
    const body = css.slice(css.indexOf("@utility hover-reveal"));
    const utility = body.slice(0, body.indexOf("\n}") + 2);

    // The whole point of the utility. `group-hover:` is dead on these devices,
    // so without this the control never appears at all.
    expect(utility).toMatch(/@media\s*\(\s*hover:\s*none\s*\)/);
    // Resting state, and the keyboard route to it.
    expect(utility).toMatch(/opacity:\s*0/);
    expect(utility).toContain(":focus-visible");
  });
});

describe("hover-only reveals have a non-hover path", () => {
  for (const file of collectTsxFiles(COMPONENTS_DIR)) {
    const relative = file.slice(COMPONENTS_DIR.length + 1);
    const source = readFileSync(file, "utf8");
    const literals = classLiterals(source);

    const offenders = literals.filter(
      (literal) =>
        literal.includes("group-hover") &&
        literal.includes("opacity-100") &&
        !literal.includes("hover-reveal") &&
        !literal.includes("touch:"),
    );

    const exemption = EXEMPT.get(relative);

    it(`${relative} has no hover-only reveal missing a touch fallback`, () => {
      if (exemption) {
        // An exemption that stops matching is an exemption that has been
        // fixed, moved, or quietly rotted — say so rather than passing.
        expect(offenders.length, `${relative} is exempt (${exemption}) but no longer needs to be`)
          .toBeGreaterThan(0);
        return;
      }
      expect(offenders).toEqual([]);
    });
  }
});
