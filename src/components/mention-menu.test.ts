// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMention, type MentionSource } from "./mention-menu";

afterEach(cleanup);

interface Pick {
  id: string;
}

const listSource: MentionSource<Pick> = {
  trigger: "@",
  items: [{ id: "l1", label: "Grocery List", data: { id: "l1" } }],
};

function labelSource(overrides: Partial<MentionSource<Pick>> = {}): MentionSource<Pick> {
  return {
    trigger: "#",
    items: [
      { id: "lb1", label: "Urgent", data: { id: "lb1" } },
      { id: "lb2", label: "Errand", data: { id: "lb2" } },
    ],
    ...overrides,
  };
}

describe("useMention — onNoMatch", () => {
  it("appends the onNoMatch row when the query matches nothing", () => {
    const onNoMatch = (query: string) => ({
      id: "__create__",
      label: `Create label "${query}"`,
      data: { id: "__create__" },
    });
    const { result } = renderHook(() =>
      useMention({ value: "#brandnew", cursor: 9, sources: [labelSource({ onNoMatch })] }),
    );

    expect(result.current.results.map((r) => r.label)).toEqual(['Create label "brandnew"']);
  });

  it("does not append onNoMatch when the query is empty", () => {
    const onNoMatch = (query: string) => ({
      id: "__create__",
      label: `Create label "${query}"`,
      data: { id: "__create__" },
    });
    const { result } = renderHook(() =>
      useMention({ value: "#", cursor: 1, sources: [labelSource({ onNoMatch })] }),
    );

    expect(result.current.results.map((r) => r.label)).toEqual(["Urgent", "Errand"]);
  });

  it("does not append onNoMatch when an existing item matches exactly, case-insensitively", () => {
    const onNoMatch = (query: string) => ({
      id: "__create__",
      label: `Create label "${query}"`,
      data: { id: "__create__" },
    });
    const { result } = renderHook(() =>
      useMention({ value: "#urgent", cursor: 7, sources: [labelSource({ onNoMatch })] }),
    );

    expect(result.current.results.map((r) => r.label)).toEqual(["Urgent"]);
  });

  it("is never dropped by the results limit — appended after the slice", () => {
    // 8 items, all prefix matches on "lab" — filterMentionItems's default
    // limit of 6 caps the real matches, so this proves the create row is
    // appended AFTER that slice rather than competing with real matches for
    // one of the 6 slots.
    const manyItems = Array.from({ length: 8 }, (_, i) => ({
      id: `lb${i}`,
      label: `Label match ${i}`,
      data: { id: `lb${i}` },
    }));
    const onNoMatch = (query: string) => ({
      id: "__create__",
      label: `Create label "${query}"`,
      data: { id: "__create__" },
    });
    const { result } = renderHook(() =>
      useMention({
        value: "#lab",
        cursor: 4,
        sources: [{ trigger: "#", items: manyItems, onNoMatch }],
      }),
    );

    expect(result.current.results).toHaveLength(7);
    expect(result.current.results.at(-1)?.label).toBe('Create label "lab"');
  });
});

describe("useMention — arbitrating multiple sources", () => {
  it("only one source's popover can be live: the sigil nearest the cursor", () => {
    const { result } = renderHook(() =>
      useMention({ value: "buy @groc #urg", cursor: 14, sources: [listSource, labelSource()] }),
    );

    expect(result.current.sigil).toBe("#");
    expect(result.current.results.map((r) => r.label)).toEqual(["Urgent"]);
  });

  it("resolves through whichever source matched", () => {
    const { result } = renderHook(() =>
      useMention({ value: "buy @groc", cursor: 9, sources: [listSource, labelSource()] }),
    );

    expect(result.current.sigil).toBe("@");
    const resolved = result.current.resolveHighlighted();
    expect(resolved?.item.data).toEqual({ id: "l1" });
    expect(resolved?.text).toBe("buy");
  });
});
