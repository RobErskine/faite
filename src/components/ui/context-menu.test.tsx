// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenusEnabled,
  ContextMenuTrigger,
} from "./context-menu";

/**
 * The wrapper's own contract, written before it had any consumer (EI-282).
 *
 * The order below is the point. `.ai/lessons.md` L747 records a green suite
 * that was blind rather than right: composing two Base UI `useRender`
 * components silently dropped the trigger's pointer handlers, and neither
 * happy-dom nor Playwright's `hover()` could open the resulting tooltip — so
 * every assertion downstream was proving nothing. The control case here
 * establishes that happy-dom CAN open this primitive at all, before anything
 * else relies on that. It can; that is why the card and column tests in EI-285
 * and EI-286 stay in vitest instead of moving to Playwright.
 */

beforeAll(() => {
  // happy-dom has no layout; Base UI reaches for this when highlighting items.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

function Menu({
  onMouseDown,
  onTouchStart,
  onClickCapture,
}: {
  onMouseDown?: () => void;
  onTouchStart?: () => void;
  onClickCapture?: () => void;
} = {}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        data-todo-row=""
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onClickCapture={onClickCapture}
      >
        row
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Ping</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("the control case", () => {
  it("opens on contextmenu", async () => {
    render(<Menu />);
    fireEvent.contextMenu(screen.getByText("row"));
    expect(await screen.findByRole("menuitem", { name: "Ping" })).toBeTruthy();
  });

  it("renders nothing until it is opened", () => {
    render(<Menu />);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

describe("handler survival", () => {
  /**
   * Both halves, deliberately. L747's failure shape is that the composed
   * component keeps every caller prop and drops its OWN internal handlers, so
   * asserting only that the spies ran would pass against exactly the bug this
   * test exists to catch.
   */
  it("keeps the caller's handlers AND still opens", async () => {
    const onMouseDown = vi.fn();
    const onTouchStart = vi.fn();
    const onClickCapture = vi.fn();
    render(
      <Menu
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onClickCapture={onClickCapture}
      />,
    );
    const trigger = screen.getByText("row");

    fireEvent.mouseDown(trigger);
    fireEvent.touchStart(trigger, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.click(trigger);
    expect(onMouseDown).toHaveBeenCalled();
    expect(onTouchStart).toHaveBeenCalled();
    expect(onClickCapture).toHaveBeenCalled();

    fireEvent.contextMenu(trigger);
    expect(await screen.findByRole("menuitem", { name: "Ping" })).toBeTruthy();
  });

  it("adds no wrapper element — the trigger IS the caller's node", () => {
    const { container } = render(<Menu />);
    const trigger = container.querySelector('[data-slot="context-menu-trigger"]');
    // The same node carries the caller's own attribute. A wrapper would put
    // `data-todo-row` on a child (or the slot on a parent), and the board's
    // selection-clearing listener keys off exactly this element.
    expect(trigger?.getAttribute("data-todo-row")).toBe("");
    expect(trigger?.textContent).toBe("row");
  });
});

describe("ContextMenusEnabled", () => {
  /**
   * The board's coarse-pointer gate. `disabled` is checked by the primitive in
   * both `handleContextMenu` and `handleTouchStart`, so this one flag is what
   * keeps a phone long-press from opening a menu on top of a lifted card.
   */
  it("suppresses the menu when disabled by context", () => {
    render(
      <ContextMenusEnabled value={false}>
        <Menu />
      </ContextMenusEnabled>,
    );
    fireEvent.contextMenu(screen.getByText("row"));
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("opens when the context allows it", async () => {
    render(
      <ContextMenusEnabled value={true}>
        <Menu />
      </ContextMenusEnabled>,
    );
    fireEvent.contextMenu(screen.getByText("row"));
    expect(await screen.findByRole("menuitem", { name: "Ping" })).toBeTruthy();
  });

  it("is enabled by default, with no provider", async () => {
    render(<Menu />);
    fireEvent.contextMenu(screen.getByText("row"));
    expect(await screen.findByRole("menuitem", { name: "Ping" })).toBeTruthy();
  });
});

describe("styling deltas from dropdown-menu", () => {
  /**
   * The copy-paste hazard. A context menu anchors to a synthetic zero-width
   * `DOMRect`, so inheriting the dropdown's `w-(--anchor-width)` renders a
   * 0px-wide popup — which presents as "the menu doesn't open" and would send
   * the next person hunting in entirely the wrong place.
   */
  it("does not size the popup from the anchor", async () => {
    render(<Menu />);
    fireEvent.contextMenu(screen.getByText("row"));
    const popup = await screen.findByRole("menu");
    expect(popup.className).not.toContain("w-(--anchor-width)");
    expect(popup.className).toContain("min-w-44");
  });
});
