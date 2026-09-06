import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The hero board has to stay a Server Component.
 *
 * That is the whole reason `demo-board.tsx` exists as its own hand-written
 * echo of the board instead of reusing `components/board/`: as long as nothing
 * in its import graph says `"use client"`, it runs at build time and ships as
 * HTML, costing `/` **zero bytes of client JS** — on the one page whose entire
 * audience is a cold-cache first-time visitor.
 *
 * Nothing about that invariant is visible in a diff. Importing `Tooltip` to get
 * a nicer label, or `Checkbox` so the boxes match exactly, would render
 * correctly, pass every other test, and quietly pull a hydration runtime onto
 * the marketing page. So the check is mechanical: no client directive here, and
 * no client directive one level down either.
 *
 * The same shape as `lib/desktop/bundle-assets.test.ts`, and for the same
 * reason — asserting on source rather than on a built bundle keeps this a unit
 * test instead of a 30-second build test, and what regresses cheaply is the
 * import list, which is right here.
 */

const dir = new URL(".", import.meta.url);

/**
 * The marketing components that must stay Server Components.
 *
 * `card-travel.tsx` is the one deliberate client component on the homepage
 * besides the scene, and it is not in this list: it renders nothing of its own
 * — the card it flies is passed in as `children` from `page.tsx` and stays
 * server HTML — so what it costs the page is a positioning loop, not the copy.
 */
const SERVER_ONLY = ["demo-board.tsx", "story-panel.tsx"];

/**
 * Comments are stripped before anything is searched, because the file this
 * guards explains at length why it is not a client component — and would
 * otherwise fail on its own prose. Same for the modules it imports.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const SOURCES = SERVER_ONLY.map((file) => ({
  file,
  code: stripComments(readFileSync(new URL(file, dir), "utf8")),
}));

/** `@/…` back to a path under `src/`, then the two extensions we author in. */
function readAliased(specifier: string): string {
  const base = new URL(`../../${specifier.slice("@/".length)}`, dir);
  for (const ext of [".tsx", ".ts"]) {
    try {
      return stripComments(readFileSync(new URL(base.href + ext), "utf8"));
    } catch {
      // Try the next extension; a specifier that resolves to neither is a
      // broken import and `tsc` will have said so already.
    }
  }
  return "";
}

const IMPORTS = SOURCES.map(({ file, code }) => ({
  file,
  specifiers: [...code.matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]),
}));

describe.each(SOURCES)("$file", ({ file, code }) => {
  const { specifiers } = IMPORTS.find((i) => i.file === file)!;

  it("is a Server Component", () => {
    expect(code).not.toContain('"use client"');
  });

  it("imports nothing that is itself a client component", () => {
    // `lib/*` helpers are pure and `components/ui/badge.tsx` is a shared
    // module — `badgeVariants` is a `cva` call, and `Badge` (which does use a
    // hook) is never called here. `ui/checkbox.tsx` and `board/todo-row-parts.tsx`
    // are the two near misses this would catch.
    expect(specifiers.filter((s) => readAliased(s).includes('"use client"'))).toEqual([]);
  });

  it("does not reach into the board or the store", () => {
    // `board-column.tsx` imports `createLabel` from `lib/store/repositories`,
    // so one convenient import would put Dexie on the marketing page.
    expect(specifiers.filter((s) => s.startsWith("@/lib/store"))).toEqual([]);
    expect(specifiers.filter((s) => s.startsWith("@/components/board"))).toEqual([]);
  });

  it("resolves every alias it imports", () => {
    // Guards the helper above rather than the component: a specifier this
    // cannot read would make the two checks above pass vacuously.
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => readAliased(s) === "")).toEqual([]);
  });
});

describe("the flying copy", () => {
  const travel = stripComments(
    readFileSync(new URL("card-travel.tsx", dir), "utf8"),
  );

  it("is a client component that renders no copy of its own", () => {
    // It is allowed to be `"use client"` precisely because the card it flies
    // arrives as `children`. The moment it imports `StoryPanel` (or anything
    // else that draws a card) the marketing page starts shipping that markup
    // to the client twice, once as HTML and once as a component.
    expect(travel).toContain('"use client"');
    expect(travel).not.toContain("story-panel");
    expect(travel).not.toContain("demo-board");
  });

  it("never writes scroll position into React state", () => {
    // Same rule as the scene (docs/SCENE.md §4). `useState` here would
    // re-render the subtree on every scroll frame.
    expect(travel).not.toContain("useState");
  });
});
