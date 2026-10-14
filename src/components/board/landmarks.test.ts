import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `/board` has exactly one `<main>` (EI-378).
 *
 * The shells are too heavy to mount in happy-dom (IndexedDB, dnd-kit, the
 * day track), so this reads the source, the same way
 * `touch-affordance.test.ts` does. Each shell owns its own `<main>`; the
 * header (`app-header.tsx`) is the banner landmark and sits outside it; and
 * no other board component may add a second one, which is how a page ends
 * up with two.
 */

const DIR = join(process.cwd(), "src/components/board");
const read = (file: string) => readFileSync(join(DIR, file), "utf8");
const opens = (src: string) => src.match(/<main[\s>]/g)?.length ?? 0;
const closes = (src: string) => src.match(/<\/main>/g)?.length ?? 0;

describe("the board's landmarks", () => {
  for (const shell of ["desktop-board.tsx", "phone-board.tsx"]) {
    it(`${shell} renders exactly one <main>, after the header`, () => {
      const src = read(shell);
      expect(opens(src)).toBe(1);
      expect(closes(src)).toBe(1);
      // The header is the banner landmark, not part of the content.
      expect(src.indexOf("<AppHeader")).toBeGreaterThan(-1);
      expect(src.indexOf("<AppHeader")).toBeLessThan(src.indexOf("<main"));
    });
  }

  it("no other board component adds a <main> of its own", () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .filter((f) => f !== "desktop-board.tsx" && f !== "phone-board.tsx")
      .filter((f) => opens(read(f)) > 0);
    expect(offenders).toEqual([]);
  });

  it("the header is a real <header>", () => {
    expect(read("app-header.tsx")).toMatch(/<header[\s>]/);
  });
});
