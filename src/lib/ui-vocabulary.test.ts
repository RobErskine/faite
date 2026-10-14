import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SCANNED_SOURCE, SKIPPED_SOURCE, userFacingText } from "./user-facing-text";

/**
 * The UI says "Won't do" and "to-do" (EI-377, `PRODUCT.md`, `docs/CONTENT.md`
 * §6). The `dropped` status and the `todo` entity keep those names in code,
 * the schema, the API and MCP — but a user never reads "Dropped" in a toast or
 * "Todo" in a menu.
 *
 * Same extractor as `spelling.test.ts`: string literals and JSX text, never
 * comments or identifiers. Two shapes are code, not copy, and are skipped:
 *
 *  - a word glued to code punctuation — `./todo-card`, `data-todo-id`,
 *    `todo.title`, `(todos)`, `${todo}`, `todos: Todo[]`;
 *  - a quoted LOWERCASE single word — `"todo"`, `"dropped"` — which is an
 *    enum value or an entity kind. A capitalized one (`"Todo"`, `"Dropped"`)
 *    is a label, and is checked: that is exactly the shape of the view
 *    filter's old "Todo" and the status toast's old "Dropped".
 */

const SRC = join(import.meta.dirname, "..");
const ROOTS = ["components", "app", "lib"].map((d) => join(SRC, d));

/** Lowercase quoted enum values: removed before matching. Case-sensitive. */
const CODE_VALUE = /["'`](?:todos?|dropped)["'`]/g;

/** The banned words, standing alone as prose. Case-insensitive. */
const BANNED = /(?<![-\w/.:@$#({])(?:todos?|dropped)(?![-\w/:[]|\.\w)/gi;

/**
 * Genuine exceptions — file (relative to `src/`), the word as matched, and
 * why. Each entry must still match something, so a fixed file cannot leave a
 * stale pass behind.
 */
const ALLOWED: ReadonlyArray<{ file: string; word: string; reason: string }> = [
  {
    file: "lib/dnd-announcements.ts",
    word: "dropped",
    reason: "the drag-and-drop verb (\"was dropped in Today\"), not the status",
  },
  {
    file: "lib/store/repositories.ts",
    word: "todo",
    reason: "a thrown invariant error for developers, never rendered",
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (SCANNED_SOURCE.test(entry) && !SKIPPED_SOURCE.test(entry)) out.push(path);
  }
  return out;
}

/** Banned words in one file's source, as matched. */
function bannedWords(source: string): string[] {
  const text = userFacingText(source).replace(CODE_VALUE, " ");
  return [...text.matchAll(BANNED)].map((m) => m[0]);
}

describe("the vocabulary matcher", () => {
  // Non-vacuity: the real offenders EI-377 fixed, and the code shapes that
  // must not trip it.
  it.each([
    ['{ value: "open", label: "Todo" },', "Todo"],
    ['  dropped: "Dropped",', "Dropped"],
    ['`${status === "done" ? "Completed" : "Dropped"} ${stamp}`', "Dropped"],
    ["<p>Saturday. Todos you scheduled</p>", "Todos"],
    ['<span>Write — create and update todos (needed)</span>', "todos"],
    ['toast("Attachments are dropped.")', "dropped"],
  ])("flags %s", (source, word) => {
    expect(bannedWords(source)).toEqual([word]);
  });

  it.each([
    'import { TodoCard } from "./todo-card";',
    '<li data-todo-id={todo.id} id="todo-list" />',
    'if (todo.status === "dropped") return "todo";',
    "`Move back to ${actions.homeListName(todo)}`",
    '{ value: "open", label: "To-do" },',
    "`Won’t do “${short(todo.title)}”`",
  ])("passes %s", (source) => {
    expect(bannedWords(source)).toEqual([]);
  });
});

describe("user-facing copy", () => {
  it('says "Won\'t do" and "to-do", never "Dropped" or "todo"', () => {
    const offenders: string[] = [];
    const allowedHits = new Set<string>();

    for (const root of ROOTS) {
      for (const path of sourceFiles(root)) {
        const file = relative(SRC, path);
        for (const word of bannedWords(readFileSync(path, "utf8"))) {
          const allowed = ALLOWED.find(
            (a) => a.file === file && a.word === word.toLowerCase(),
          );
          if (allowed) allowedHits.add(`${allowed.file}:${allowed.word}`);
          else offenders.push(`${file}: "${word}"`);
        }
      }
    }

    // Listed in full: the failure message IS the fix list.
    expect(offenders).toEqual([]);
    expect(ALLOWED.map((a) => `${a.file}:${a.word}`).filter((k) => !allowedHits.has(k))).toEqual(
      [],
    );
  });
});
