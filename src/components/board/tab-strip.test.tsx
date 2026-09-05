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
    expect(await screen.findByText("1 list with 1 item")).toBeTruthy();
  });

  it("spells out the assigned tally only when there is one", async () => {
    // The whole point of the third number: a tab whose lists look empty still
    // reads 3/0/1, and the tooltip has to say why.
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
      await screen.findByText("3 lists with 0 items, plus 1 item assigned to a day"),
    ).toBeTruthy();
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
    expect(await screen.findByText("2 lists with 17 items")).toBeTruthy();
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
