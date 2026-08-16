import { describe, expect, it } from "vitest";
import { effectiveListColor } from "./colors";

const PINK = "#d6409f";
const BLUE = "#3e63dd";

describe("effectiveListColor", () => {
  it("returns the list's own color when it has one", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: BLUE, tabId: "tab-1" }, tabsById)).toBe(BLUE);
  });

  it("falls back to the owning tab's color when the list has none", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: "tab-1" }, tabsById)).toBe(PINK);
  });

  it("is null when neither the list nor its tab has a color", () => {
    const tabsById = new Map([["tab-1", { color: null }]]);
    expect(effectiveListColor({ color: null, tabId: "tab-1" }, tabsById)).toBeNull();
  });

  it("is null for a list with no tab at all — Backlog inherits nothing", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: null }, tabsById)).toBeNull();
  });

  it("is null for a list whose tab is missing from the map", () => {
    expect(effectiveListColor({ color: null, tabId: "gone" }, new Map())).toBeNull();
  });

  it("resolves through a map built from archived tabs just as well as live ones", () => {
    // `tabsById` is deliberately just a map — it does not know or care whether
    // the tab it holds is live or archived. Callers are responsible for
    // widening it to include archived tabs (see use-board-data.ts), and this
    // proves the resolver itself needs no special case for that.
    const archivedTabsById = new Map([["filed-tab", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: "filed-tab" }, archivedTabsById)).toBe(PINK);
  });

  it("is null for a null list", () => {
    expect(effectiveListColor(null, new Map())).toBeNull();
  });
});
