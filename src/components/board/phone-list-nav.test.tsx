// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneListNav, type PhoneListNavItem } from "./phone-list-nav";

const PAGE = 390;

const LISTS: PhoneListNavItem[] = [
  { columnId: "list:backlog", name: "Backlog" },
  { columnId: "list:brain", name: "Brain Dump" },
  { columnId: "list:grocery", name: "Grocery List" },
  { columnId: "list:buy", name: "To Buy" },
  { columnId: "list:read", name: "To Read" },
];

/** The Lists pager as `phone-board.tsx` lays it out: one section per list,
 * in order, then the "create list" page. `cards` puts a card in that list. */
function Harness({ cards = [] }: { cards?: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <PhoneListNav trackRef={trackRef} lists={LISTS} />
      <div ref={trackRef} data-testid="track">
        {LISTS.map((list) => (
          <section key={list.columnId} data-column-id={list.columnId} aria-label={list.name}>
            {cards.includes(list.columnId) && (
              <div tabIndex={-1} data-nav-stop={`todo:${list.columnId}-1`}>
                First card
              </div>
            )}
            <input data-nav-stop={`add:${list.columnId}`} aria-label={`Add to ${list.name}`} />
          </section>
        ))}
        <div>Create list</div>
      </div>
    </>
  );
}

/** happy-dom has no layout: give each page the phone's width. */
function layOut() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: PAGE,
    height: 800,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: PAGE,
    bottom: 800,
    toJSON: () => ({}),
  } as DOMRect);
}

function renderNav(cards?: string[]) {
  layOut();
  const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
  render(<Harness cards={cards} />);
  return { track: screen.getByTestId("track"), scrollTo };
}

function swipeTo(track: HTMLElement, page: number) {
  act(() => {
    track.scrollLeft = page * PAGE;
    fireEvent.scroll(track);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PhoneListNav", () => {
  it("is a labeled nav naming every list, in pager order", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Lists" });
    const names = Array.from(nav.querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["Backlog", "Brain Dump", "Grocery List", "To Buy", "To Read"]);
  });

  it("opens with Backlog, the pager's first page, marked current", () => {
    renderNav();
    expect(screen.getByRole("button", { name: "Backlog" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "To Read" }).getAttribute("aria-current")).toBeNull();
  });

  it("follows a swipe: the marker moves to the page in view", () => {
    const { track } = renderNav();
    swipeTo(track, 2);
    expect(screen.getByRole("button", { name: "Grocery List" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Backlog" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks nothing on the create-list page past the last list", () => {
    const { track } = renderNav();
    swipeTo(track, LISTS.length);
    expect(screen.getByRole("navigation", { name: "Lists" }).querySelector("[aria-current]")).toBeNull();
  });

  it("a tap scrolls the pager to that list and focuses its first card", () => {
    const { track, scrollTo } = renderNav(["list:buy"]);
    fireEvent.click(screen.getByRole("button", { name: "To Buy" }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 3 * PAGE }));
    expect(scrollTo.mock.contexts[0]).toBe(track);
    expect(document.activeElement?.getAttribute("data-nav-stop")).toBe("todo:list:buy-1");
    expect(screen.getByRole("button", { name: "To Buy" }).getAttribute("aria-current")).toBe("page");
  });

  it("focuses an empty list's column, never its quick-add (no surprise keyboard)", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "To Read" }));
    const column = screen.getByRole("region", { name: "To Read" });
    expect(document.activeElement).toBe(column);
    expect(column.getAttribute("tabindex")).toBe("-1");
  });

  it("names are at least 44px tall on a coarse pointer", () => {
    renderNav();
    expect(screen.getByRole("button", { name: "Backlog" }).className).toContain("pointer-coarse:h-11");
  });
});

/**
 * The shells are too heavy to mount here (see `landmarks.test.ts`), so the
 * phone-only claim is checked in the source: the Lists strip is mounted by
 * the phone shell and by nothing the desktop/tablet shell renders.
 */
describe("PhoneListNav is phone only", () => {
  const read = (file: string) =>
    readFileSync(join(process.cwd(), "src/components/board", file), "utf8");

  it("the phone shell mounts it", () => {
    expect(read("phone-board.tsx")).toContain("<PhoneListNav");
  });

  it("the desktop shell does not", () => {
    expect(read("desktop-board.tsx")).not.toContain("PhoneListNav");
  });
});
