// @vitest-environment happy-dom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addStop, cardStop } from "@/lib/column-nav";
import { SkipLinks, findSkipTarget, type SkipLinkTarget } from "./skip-links";

/**
 * EI-381. The shells are too heavy to mount here (see `landmarks.test.ts`), so
 * this renders the links over a stand-in board: sections tagged with
 * `data-column-id` and the same `data-nav-stop` ids `BoardColumn` and
 * `TodoCard` write.
 */

beforeAll(() => {
  // happy-dom has no layout.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const TODAY = "day:2026-10-14";
const BACKLOG = "list:backlog";

function Column({ id, cards }: { id: string; cards: string[] }) {
  return (
    <section data-column-id={id} aria-label={id}>
      {cards.map((c) => (
        <div key={c} tabIndex={-1} data-nav-stop={cardStop(c)}>
          {c}
        </div>
      ))}
      <input aria-label={`New to-do in ${id}`} data-nav-stop={addStop(id)} />
    </section>
  );
}

function Board({
  todayCards = ["a", "b"],
  today = {},
  backlog = {},
}: {
  todayCards?: string[];
  today?: Partial<SkipLinkTarget>;
  backlog?: Partial<SkipLinkTarget> | null;
}) {
  return (
    <>
      <SkipLinks
        today={{ columnId: TODAY, prefer: "card", ...today }}
        backlog={backlog ? { columnId: BACKLOG, prefer: "add", ...backlog } : null}
      />
      <button type="button">Header control</button>
      <Column id={TODAY} cards={todayCards} />
      <Column id={BACKLOG} cards={["x"]} />
    </>
  );
}

const active = () => document.activeElement as HTMLElement | null;

describe("skip links (EI-381)", () => {
  it("are the first focusable things on the board, before the header", () => {
    render(<Board />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Skip to today", "Skip to Backlog"]);
    const header = screen.getByRole("button", { name: "Header control" });
    for (const link of links) {
      expect(link.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("are hidden until focused, then shown with the shared focus ring on a surface", () => {
    render(<Board />);
    const cls = screen.getByRole("link", { name: "Skip to today" }).className.split(/\s+/);
    expect(cls).toContain("-translate-y-[calc(100%+1rem)]");
    expect(cls).toContain("focus:translate-y-0");
    expect(cls).toContain("focus-ring");
    expect(cls).toContain("bg-popover");
  });

  it("moves focus to today's first card", () => {
    const reveal = vi.fn();
    render(<Board today={{ reveal }} />);
    fireEvent.click(screen.getByRole("link", { name: "Skip to today" }));
    expect(active()?.getAttribute("data-nav-stop")).toBe(cardStop("a"));
    expect(reveal).toHaveBeenCalledWith(active());
  });

  it("moves focus to today's quick-add when today has no cards", () => {
    render(<Board todayCards={[]} />);
    fireEvent.click(screen.getByRole("link", { name: "Skip to today" }));
    expect(active()?.getAttribute("data-nav-stop")).toBe(addStop(TODAY));
  });

  it("moves focus to the Backlog quick-add, not its first card", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("link", { name: "Skip to Backlog" }));
    expect(active()?.getAttribute("data-nav-stop")).toBe(addStop(BACKLOG));
  });

  it("offers no Backlog link when there is no Backlog", () => {
    render(<Board backlog={null} />);
    expect(screen.queryByRole("link", { name: "Skip to Backlog" })).toBeNull();
  });

  it("waits for a column that prepare has to render (a collapsed half, the other phone page)", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    function Deferred() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <SkipLinks
            today={{ columnId: TODAY, prefer: "card" }}
            backlog={{ columnId: BACKLOG, prefer: "add", prepare: () => setShown(true) }}
          />
          {shown && <Column id={BACKLOG} cards={[]} />}
        </>
      );
    }
    try {
      render(<Deferred />);
      fireEvent.click(screen.getByRole("link", { name: "Skip to Backlog" }));
      await act(async () => {
        vi.advanceTimersToNextFrame();
      });
      expect(active()?.getAttribute("data-nav-stop")).toBe(addStop(BACKLOG));
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the column itself only when there is nothing better", () => {
    render(<section data-column-id={TODAY} />);
    const found = findSkipTarget(document, { columnId: TODAY, prefer: "card" });
    expect(found?.exact).toBe(false);
    expect(found?.element.getAttribute("data-column-id")).toBe(TODAY);
    expect(findSkipTarget(document, { columnId: "day:2099-01-01", prefer: "card" })).toBeNull();
  });
});

describe("both shells mount them first (EI-381)", () => {
  const read = (file: string) =>
    readFileSync(join(process.cwd(), "src/components/board", file), "utf8");
  for (const shell of ["desktop-board.tsx", "phone-board.tsx"]) {
    it(`${shell} renders <SkipLinks> before the header and <main>`, () => {
      const src = read(shell);
      const at = src.indexOf("<SkipLinks");
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(src.indexOf("<AppHeader"));
      expect(at).toBeLessThan(src.indexOf("<main"));
      expect(at).toBeLessThan(src.indexOf("<SignedOutBanner"));
    });
  }
});
