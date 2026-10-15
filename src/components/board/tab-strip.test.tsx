// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabStrip } from "./tab-strip";
import type { Tab } from "@/lib/schema";

/**
 * Covers the two pieces of tab-strip UI that don't show up elsewhere:
 * the (lists/items) badge (EI-118) and the icon-only Archived button
 * (EI-119). Scroll/fade behavior (EI-120) needs real layout to observe
 * (scrollWidth/clientWidth are always 0 in happy-dom), so that's on the
 * manual checklist in docs/DRAG-AND-DROP.md instead.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const tab = (id: string, name: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  color: null,
  emoji: null,
  iconUrl: null,
  name,
  description: null,
  isDefault: false,
  archivedAt: null,
  position: "a0",
  ...overrides,
});

interface HarnessProps {
  tabs: Tab[];
  activeTabId: string;
  archivedCount?: number;
  counts?: ReadonlyMap<string, { lists: number; items: number; assigned: number }>;
}

function Harness({ tabs, activeTabId, archivedCount = 0, counts = new Map() }: HarnessProps) {
  return (
    <TooltipProvider>
      <DndContext>
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          archivedCount={archivedCount}
          counts={counts}
          infoTabId={null}
          drop={null}
          isCardDragActive={false}
          isListDragActive={false}
          onSelect={vi.fn()}
          onOpenInfo={vi.fn()}
          onCreate={vi.fn()}
          onOpenArchive={vi.fn()}
        />
      </DndContext>
    </TooltipProvider>
  );
}

describe("tab pill counts", () => {
  it("shows lists/items/assigned next to the tab name, without parens", () => {
    const work = tab("t1", "Work");
    render(
      <Harness
        tabs={[work]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 2, items: 17, assigned: 4 }]])}
      />,
    );
    expect(screen.getByRole("button", { name: /^Work\b/ }).textContent).toContain("2/17/4");
  });

  it("shows 0/0/0 for a tab absent from the counts map", () => {
    const empty = tab("t2", "Empty");
    render(<Harness tabs={[empty]} activeTabId="t2" />);
    expect(screen.getByRole("button", { name: /^Empty\b/ }).textContent).toContain("0/0/0");
  });

  it("gets a tooltip spelling out the count even with no description", async () => {
    const work = tab("t1", "Work");
    render(
      <Harness
        tabs={[work]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 1, items: 1, assigned: 0 }]])}
      />,
    );
    const pill = screen.getByRole("button", { name: /^Work\b/ }).closest("[data-tab-pill]")!;
    fireEvent.mouseEnter(pill);
    expect(await screen.findByText("1 list, 1 to-do in it, 0 on the calendar")).toBeTruthy();
  });

  it("names every visible number, in order, even a zero (EI-383)", async () => {
    // The whole point of the third number: a tab whose lists look empty still
    // reads 3/0/↑1, and the tooltip has to say why.
    const work = tab("t1", "Work");
    render(
      <Harness
        tabs={[work]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 3, items: 0, assigned: 1 }]])}
      />,
    );
    const pill = screen.getByRole("button", { name: /^Work\b/ }).closest("[data-tab-pill]")!;
    fireEvent.mouseEnter(pill);
    expect(
      await screen.findByText("3 lists, 0 to-dos in them, 1 on the calendar"),
    ).toBeTruthy();
  });

  it("puts the tooltip's exact words in the pill's accessible name (EI-383)", () => {
    render(
      <Harness
        tabs={[tab("t1", "Work")]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 4, items: 3, assigned: 8 }]])}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Work, 4 lists, 3 to-dos in them, 8 on the calendar" }),
    ).toBeTruthy();
  });

  it("opens the same tooltip from the keyboard, not only on hover (EI-383)", async () => {
    render(
      <Harness
        tabs={[tab("t1", "Work")]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 4, items: 3, assigned: 8 }]])}
      />,
    );
    fireEvent.focus(screen.getByRole("button", { name: /^Work\b/ }));
    expect(await screen.findByText("4 lists, 3 to-dos in them, 8 on the calendar")).toBeTruthy();
  });

  it("shows the description above the count when both are present", async () => {
    const work = tab("t1", "Work", { description: "Day job" });
    render(
      <Harness
        tabs={[work]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 2, items: 17, assigned: 0 }]])}
      />,
    );
    const pill = screen.getByRole("button", { name: /^Work\b/ }).closest("[data-tab-pill]")!;
    fireEvent.mouseEnter(pill);
    expect(await screen.findByText("Day job")).toBeTruthy();
    expect(await screen.findByText("2 lists, 17 to-dos in them, 0 on the calendar")).toBeTruthy();
  });
});

describe("scroll track", () => {
  it("forces overflow-y: hidden regardless of the mask, so a stray 1px of vertical overflow never parks a scrollbar thumb over the strip", () => {
    const work = tab("t1", "Work");
    render(<Harness tabs={[work]} activeTabId="t1" />);
    const track = document.querySelector(".column-track")!;
    expect((track as HTMLElement).style.overflowY).toBe("hidden");
  });
});

describe("archived button", () => {
  it("is 44px wide on touch, not just 44 tall (EI-392)", () => {
    render(<Harness tabs={[]} activeTabId="none" archivedCount={0} />);
    const cls = screen.getByRole("button", { name: "Archived" }).className.split(/\s+/);
    expect(cls).toContain("pointer-coarse:min-w-11");
    expect(cls).toContain("pointer-coarse:min-h-11");
  });

  it("renders icon-only, with the count inline in parens, not the word 'Archived'", () => {
    render(<Harness tabs={[]} activeTabId="none" archivedCount={3} />);
    const button = screen.getByRole("button", { name: "Archived" });
    expect(button.textContent).not.toContain("Archived");
    expect(button.textContent).toBe("(3)");
  });

  it("hides the count entirely when the archive is empty — no '(0)' noise", () => {
    render(<Harness tabs={[]} activeTabId="none" archivedCount={0} />);
    const button = screen.getByRole("button", { name: "Archived" });
    expect(button.textContent).toBe("");
  });

  it("calls onOpenArchive on click", () => {
    const onOpenArchive = vi.fn();
    render(
      <TooltipProvider>
        <DndContext>
          <TabStrip
            tabs={[]}
            activeTabId="none"
            archivedCount={0}
            counts={new Map()}
            infoTabId={null}
            drop={null}
            isCardDragActive={false}
            isListDragActive={false}
            onSelect={vi.fn()}
            onOpenInfo={vi.fn()}
            onCreate={vi.fn()}
            onOpenArchive={onOpenArchive}
          />
        </DndContext>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(onOpenArchive).toHaveBeenCalled();
  });
});

describe("accessibility floor (EI-378)", () => {
  it("draws the count in ink that passes 4.5:1, not muted-foreground at 60%", () => {
    render(
      <Harness
        tabs={[tab("t1", "Work")]}
        activeTabId="t1"
        counts={new Map([["t1", { lists: 4, items: 1, assigned: 0 }]])}
      />,
    );
    const count = screen.getByRole("button", { name: /^Work\b/ }).querySelector(".num")!;
    // 2.3:1 light / 3.07:1 dark measured on production before; foreground at
    // 60% measured 5.25:1 / 6.14:1 in the browser. Any alpha on the muted
    // token is what failed, so no form of it is allowed back.
    expect(count.className).not.toMatch(/text-muted-foreground\/\d+/);
    expect(count.className).toContain("text-foreground/60");
  });

  it("never calls scrollIntoView on mount, so the first Tab still starts at the top", () => {
    /*
      Chrome moves the sequential focus navigation starting point to the
      element `scrollIntoView` was called on. Called on mount, it made the
      first Tab after a reload land on this strip's grip instead of the
      header.
    */
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      render(<Harness tabs={[tab("t1", "Work"), tab("t2", "Home")]} activeTabId="t2" />);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("grows the tab button's target without growing the pill", () => {
    render(<Harness tabs={[tab("t1", "Work")]} activeTabId="t1" />);
    const cls = screen.getByRole("button", { name: /^Work\b/ }).className.split(/\s+/);
    expect(cls).toContain("py-1");
    expect(cls).toContain("-my-1");
  });

  it("fills the 44px pill on touch, both halves of the pair (EI-392)", () => {
    render(<Harness tabs={[tab("t1", "Work")]} activeTabId="t1" />);
    const cls = screen.getByRole("button", { name: /^Work\b/ }).className.split(/\s+/);
    // 16px of text + 2×14 = 44, the pill's own coarse floor; it measured 24.
    expect(cls).toContain("pointer-coarse:py-3.5");
    expect(cls).toContain("pointer-coarse:-my-3.5");
  });
});
