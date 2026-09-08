import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { americanize, BRITISH_SPELLING_RE, SPELLINGS } from "./spelling";

/**
 * Faite writes American English (`docs/CONTENT.md`), and this is what makes
 * that a rule rather than a preference.
 *
 * # What it reads, and what it deliberately does not
 *
 * **String literals and JSX text only.** Not comments, and not identifiers.
 * That distinction is the whole design:
 *
 *  - `let cancelled = false` appears in seven files. It is code, not copy;
 *    renaming it would put churn in every diff about content and change
 *    nothing a user can see.
 *  - A comment explaining "the behaviour this guards" is prose for whoever
 *    reads the file next, not for a user. `docs/CONTENT.md` asks new comments
 *    to follow the house spelling too, but a test that fails the build over
 *    one is a test people learn to route around.
 *
 * What is left is exactly the set a user can end up reading: visible copy,
 * `aria-label`s, screen-reader announcements, toast text, placeholders.
 *
 * # Why not scan the rendered HTML instead
 *
 * That was the first idea and it is too narrow. Prerendered pages cover the
 * marketing site, but the board is client-rendered and its strings — the undo
 * toast, the drag announcements — never appear in any prerendered file. Both
 * live strings this caught on the board would have passed.
 */

const SRC = join(import.meta.dirname, "..");

/**
 * Test files name their cases in prose ("moves between neighbouring columns"),
 * and those are string literals. They are not user-facing; skipping them keeps
 * the rule about copy.
 *
 * `spelling.ts` is skipped for a different and unavoidable reason: it is the
 * dictionary, so it contains every British form there is, as string literals.
 * Scanning it would report the rule as a violation of itself.
 */
const SKIP = /\.(test|spec)\.tsx?$|^spelling\.ts$/;

function skipped(entry: string): boolean {
  return SKIP.test(entry);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry) && !skipped(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Comments out, then string literals and JSX text in.
 *
 * Comments are stripped FIRST so a `//` inside a string cannot end one, and so
 * a stripped comment cannot leave an unbalanced quote behind that swallows the
 * rest of the file into a phantom "string".
 */
function userFacingText(source: string): string {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

  const strings = code.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  // JSX text: between a tag's `>` and the next `<`. Crude, and it does not
  // need to be better — a false positive here is a word we would want to fix
  // anyway, and the words are rare enough that noise never showed up.
  const jsx = code.match(/>[^<>{}]{3,}</g) ?? [];
  return [...strings, ...jsx].join("\n");
}

describe("the spelling dictionary", () => {
  it("maps every British form to a different American one", () => {
    for (const { british, american } of SPELLINGS) {
      expect(british).not.toBe(american);
      expect(british).toBe(british.toLowerCase());
    }
  });

  it("has no duplicate entries", () => {
    const seen = SPELLINGS.map((s) => s.british);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("preserves capitalization when it rewrites", () => {
    expect(americanize("colour")).toBe("color");
    expect(americanize("Organise")).toBe("Organize");
    expect(americanize("COLOUR")).toBe("COLOR");
    expect(americanize("color")).toBeUndefined();
  });
});

describe("the text extractor", () => {
  // Non-vacuity: each of these is a real shape from this codebase, and the
  // test above is worthless if the extractor quietly returns nothing.
  it("finds a string literal", () => {
    expect(userFacingText('const a = "Organise the garage";')).toContain("Organise");
  });

  it("finds JSX text", () => {
    expect(userFacingText("<p>its own colour here</p>")).toContain("colour");
  });

  it("ignores identifiers", () => {
    expect(userFacingText("let cancelled = false;\nif (cancelled) return;")).not.toContain(
      "cancelled",
    );
  });

  it("ignores comments, including a block one wrapping prose", () => {
    expect(userFacingText("// the behaviour this guards\n")).not.toContain("behaviour");
    expect(userFacingText("/**\n * the behaviour this guards\n */\n")).not.toContain("behaviour");
  });

  it("does not let a comment marker inside a string end the string", () => {
    expect(userFacingText('const u = "https://x.test/colour";')).toContain("colour");
  });
});

describe("user-facing copy", () => {
  it("is written in American English", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = userFacingText(readFileSync(file, "utf8"));
      for (const match of text.matchAll(BRITISH_SPELLING_RE)) {
        offenders.push(
          `${file.slice(SRC.length + 1)}: "${match[0]}" → "${americanize(match[0])}"`,
        );
      }
    }

    // Listed in full rather than counted: the failure message IS the fix list.
    expect(offenders).toEqual([]);
  });
});
