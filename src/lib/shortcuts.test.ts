// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatCombo } from "@/lib/keyboard";
import { useBoardUiState } from "@/components/board/use-board-ui-state";
import { globalShortcuts, LOCAL_SHORTCUTS, shortcutCatalog } from "./shortcuts";

afterEach(cleanup);

describe("globalShortcuts", () => {
  it("derives one entry per registry hotkey — cannot drift, per the module's own promise", () => {
    const { result } = renderHook(() => useBoardUiState());
    const registry = result.current.hotkeys;
    const derived = globalShortcuts(registry);

    expect(derived).toHaveLength(registry.length);
    for (const hotkey of registry) {
      expect(derived).toContainEqual({
        id: hotkey.id,
        combo: hotkey.combo,
        label: hotkey.label,
        scope: "Global",
      });
    }
  });

  it("catches a hotkey NOT reflected here — the regression this whole module exists to prevent", () => {
    const registry = [
      { id: "made-up", combo: "mod+j", label: "Do a thing", group: "Board" as const, run: () => {} },
    ];
    const derived = globalShortcuts(registry);
    expect(derived).toEqual([
      { id: "made-up", combo: "mod+j", label: "Do a thing", scope: "Global" },
    ]);
  });
});

describe("LOCAL_SHORTCUTS", () => {
  it("has unique ids", () => {
    const ids = LOCAL_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every combo renders on both platforms without throwing", () => {
    for (const entry of LOCAL_SHORTCUTS) {
      expect(() => formatCombo(entry.combo, "mac")).not.toThrow();
      expect(() => formatCombo(entry.combo, "other")).not.toThrow();
    }
  });

  it("every entry names a source", () => {
    for (const entry of LOCAL_SHORTCUTS) {
      expect(entry.source, `${entry.id} is missing a source`).toBeTruthy();
    }
  });
});

describe("shortcutCatalog", () => {
  it("puts derived global entries ahead of the hand-authored local ones", () => {
    const { result } = renderHook(() => useBoardUiState());
    const catalog = shortcutCatalog(result.current.hotkeys);
    const globalCount = result.current.hotkeys.length;

    expect(catalog.slice(0, globalCount).every((e) => e.scope === "Global")).toBe(true);
    expect(catalog.length).toBe(globalCount + LOCAL_SHORTCUTS.length);
  });

  it("has no id collision between the global and local halves", () => {
    const { result } = renderHook(() => useBoardUiState());
    const catalog = shortcutCatalog(result.current.hotkeys);
    const ids = catalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
