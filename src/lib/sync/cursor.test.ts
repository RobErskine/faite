// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { clearSyncCursors, getSyncCursor, setSyncCursor } from "./cursor";

beforeEach(() => {
  localStorage.clear();
});

describe("getSyncCursor / setSyncCursor", () => {
  it("defaults to 0 when nothing has been persisted", () => {
    expect(getSyncCursor("user-1")).toBe(0);
  });

  it("round-trips a cursor value", () => {
    setSyncCursor("user-1", 42);
    expect(getSyncCursor("user-1")).toBe(42);
  });

  it("scopes cursors per owner", () => {
    setSyncCursor("user-1", 10);
    setSyncCursor("user-2", 20);
    expect(getSyncCursor("user-1")).toBe(10);
    expect(getSyncCursor("user-2")).toBe(20);
  });

  it("falls back to 0 on unparseable stored data", () => {
    localStorage.setItem("faite:sync-cursor:user-1", "not-a-number");
    expect(getSyncCursor("user-1")).toBe(0);
  });
});

describe("clearSyncCursors", () => {
  it("removes every cursor but leaves unrelated keys alone", () => {
    setSyncCursor("user-1", 10);
    setSyncCursor("user-2", 20);
    localStorage.setItem("faite:last-hlc", "should-survive");

    clearSyncCursors();

    expect(getSyncCursor("user-1")).toBe(0);
    expect(getSyncCursor("user-2")).toBe(0);
    expect(localStorage.getItem("faite:last-hlc")).toBe("should-survive");
  });
});
