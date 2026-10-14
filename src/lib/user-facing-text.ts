/**
 * The text in a source file that a user can end up reading: string literals
 * and JSX text, with comments removed first. Shared by the copy guards —
 * `spelling.test.ts` (American English) and `ui-vocabulary.test.ts`
 * ("Won't do" and "to-do", EI-377). `docs/CONTENT.md` §4 has the reasoning.
 *
 * Comments are stripped FIRST so a `//` inside a string cannot end one, and so
 * a stripped comment cannot leave an unbalanced quote behind that swallows the
 * rest of the file into a phantom "string".
 *
 * Pure (takes the source, not a path) so it stays out of `node:fs` and can be
 * tested on fragments.
 */
export function userFacingText(source: string): string {
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

/**
 * Source files the copy guards scan: `.ts`/`.tsx`, minus tests. Test cases are
 * named in prose ("moves between neighbouring columns") and those names are
 * string literals, but not user-facing.
 */
export const SCANNED_SOURCE = /\.tsx?$/;
export const SKIPPED_SOURCE = /\.(test|spec)\.tsx?$/;
