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

describe("the board's fidelity to the real one", () => {
  const board = readFileSync(new URL("demo-board.tsx", dir), "utf8");

  it("never gives a label a color, because the product cannot", () => {
    /*
      `createLabel` accepts a decoration and all five of its call sites pass a
      name and nothing else — there is no colour picker for a label anywhere in
      Faite, only for lists and tabs. `todo-row-parts.tsx` WILL tint a label
      that has one, so a hex on a demo label renders convincingly and
      advertises a feature a new user cannot reproduce. That is the worst kind
      of marketing bug: it only looks wrong once someone signs up.

      Lists and tabs are exempt — `list-info-dialog.tsx` and
      `tab-info-dialog.tsx` both mount a `ColorPicker`, so `accentColor` on a
      column is a real thing a user can do.
    */
    const labelDefinitions = board.match(/DemoLabel = \{[^}]*\}/g) ?? [];
    expect(labelDefinitions.length).toBeGreaterThan(0);
    for (const definition of labelDefinitions) {
      expect(definition, "a demo label carries a color").not.toMatch(/#[0-9a-f]{3,8}/i);
    }

    /*
      And the story panel, which is where the same hex was written a SECOND
      time by hand. Fixing only `demo-board.tsx` left a tinted "Home" pill on
      the card pinned beside the room for the whole story — the most looked-at
      label on the page.
    */
    const panel = stripComments(readFileSync(new URL("story-panel.tsx", dir), "utf8"));
    expect(panel, "the story panel tints a label").not.toMatch(/name: "[^"]*", color:/);
    expect(panel).not.toContain("tint(");
  });

  it("uses list names a real first run actually seeds", () => {
    // `SEED_LISTS` in `lib/store/repositories.ts`. A visitor who signs up
    // should recognise the board they were shown; invented column names are a
    // smaller lie than coloured labels but the same kind.
    const seeded = ["Backlog", "Brain Dump", "Grocery List", "To Buy", "To Read"];
    const columns = [...board.matchAll(/^\s{4}title: "([^"]+)",$/gm)].map((m) => m[1]);
    const planning = columns.filter(
      (name) => !["Overflow", "Monday", "Tuesday", "Wednesday"].includes(name),
    );
    expect(planning.length).toBeGreaterThan(0);
    for (const name of planning) expect(seeded).toContain(name);
  });
});

describe("the live layers", () => {
  const ticks = stripComments(readFileSync(new URL("story-ticks.tsx", dir), "utf8"));

  it("ticks sub-tasks without React state", () => {
    // Same rule as the scene (docs/SCENE.md §4). `useState` here would
    // re-render the panel and its six rows on every scroll frame to change
    // one integer.
    expect(ticks).toContain('"use client"');
    expect(ticks).not.toContain("useState");
  });

  it("reads progress off the same element the camera does", () => {
    // `[data-story] > div` is RoomStage's own grid. A second, independently
    // derived notion of "how far in are we" is exactly how the room ends up
    // framing the plant while a different line ticks.
    expect(ticks).toContain('"[data-story] > div"');
  });

  it("respects reduced motion", () => {
    // The server already renders a correct static card from `doneThrough`, so
    // doing nothing here is the whole fallback.
    expect(ticks).toContain("prefers-reduced-motion");
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
