import { describe, expect, it } from "vitest";
import { filterMentionItems, findMentionTrigger, resolveMentionTrigger } from "./mention";

describe("findMentionTrigger", () => {
  it("finds a trigger at the start of the string", () => {
    expect(findMentionTrigger("@groc", 5)).toEqual({ query: "groc", start: 0, end: 5 });
  });

  it("finds a trigger mid-sentence, preceded by whitespace", () => {
    expect(findMentionTrigger("buy milk @groc fri", 14)).toEqual({
      query: "groc",
      start: 9,
      end: 14,
    });
  });

  it("finds a trigger with an empty query — just typed the @", () => {
    expect(findMentionTrigger("buy milk @", 10)).toEqual({ query: "", start: 9, end: 10 });
  });

  it("does not trigger mid-word, e.g. an email address", () => {
    expect(findMentionTrigger("foo@bar.com", 11)).toBeNull();
  });

  it("does not trigger once a space ends the run", () => {
    expect(findMentionTrigger("buy milk @groc fri", 19)).toBeNull();
  });

  it("does not trigger when there is no @ before the cursor", () => {
    expect(findMentionTrigger("buy milk", 8)).toBeNull();
  });

  it("finds the nearest @ when there are several", () => {
    expect(findMentionTrigger("@one @two", 9)).toEqual({ query: "two", start: 5, end: 9 });
  });

  it("returns null for an out-of-range cursor", () => {
    expect(findMentionTrigger("buy milk", -1)).toBeNull();
    expect(findMentionTrigger("buy milk", 100)).toBeNull();
  });
});

describe("findMentionTrigger — a non-default sigil", () => {
  it("finds a '#' trigger at the start of a word", () => {
    expect(findMentionTrigger("buy milk #urg", 13, "#")).toEqual({
      query: "urg",
      start: 9,
      end: 13,
    });
  });

  it("does not trigger mid-word, e.g. 'C#'", () => {
    expect(findMentionTrigger("write C# code", 8, "#")).toBeNull();
  });

  it("does not trigger mid-word, e.g. 'foo#bar'", () => {
    expect(findMentionTrigger("see foo#bar here", 11, "#")).toBeNull();
  });

  it("does not trigger once a space ends the run", () => {
    expect(findMentionTrigger("buy milk #urg done", 19, "#")).toBeNull();
  });

  it("'@' and '#' triggers cannot both be live: the far one always has whitespace in its run", () => {
    const value = "buy @groc #urg";
    // Cursor right after "#urg" — the "#" trigger is live, the "@" one is dead
    // because its run ("groc #urg") contains a space.
    expect(findMentionTrigger(value, value.length, "@")).toBeNull();
    expect(findMentionTrigger(value, value.length, "#")).toEqual({
      query: "urg",
      start: 10,
      end: 14,
    });
  });
});

describe("resolveMentionTrigger", () => {
  it("removes a mid-sentence mention and rejoins with a single space", () => {
    const trigger = findMentionTrigger("buy milk @groc fri", 14)!;
    const result = resolveMentionTrigger("buy milk @groc fri", trigger);
    expect(result.text).toBe("buy milk fri");
    expect(result.caretIndex).toBe("buy milk".length);
  });

  it("removes a leading mention with no leftover leading space", () => {
    const trigger = findMentionTrigger("@groc buy milk", 5)!;
    const result = resolveMentionTrigger("@groc buy milk", trigger);
    expect(result.text).toBe("buy milk");
    expect(result.caretIndex).toBe(0);
  });

  it("removes a trailing mention with no leftover trailing space", () => {
    const trigger = findMentionTrigger("buy milk @groc", 14)!;
    const result = resolveMentionTrigger("buy milk @groc", trigger);
    expect(result.text).toBe("buy milk");
    expect(result.caretIndex).toBe("buy milk".length);
  });

  it("removes a mention that is the entire string", () => {
    const trigger = findMentionTrigger("@groc", 5)!;
    const result = resolveMentionTrigger("@groc", trigger);
    expect(result.text).toBe("");
    expect(result.caretIndex).toBe(0);
  });

  it("substitutes a replacement instead of removing, for a visible-reference field", () => {
    const trigger = findMentionTrigger("buy milk @groc fri", 14)!;
    const result = resolveMentionTrigger("buy milk @groc fri", trigger, "@Grocery List");
    expect(result.text).toBe("buy milk @Grocery List fri");
    expect(result.caretIndex).toBe("buy milk @Grocery List".length);
  });
});

describe("filterMentionItems", () => {
  const items = [{ label: "Grocery List" }, { label: "To Buy" }, { label: "To Read" }];

  it("returns everything, up to the limit, on an empty query", () => {
    expect(filterMentionItems(items, "")).toEqual(items);
  });

  it("filters by substring, case-insensitively", () => {
    expect(filterMentionItems(items, "GROC")).toEqual([{ label: "Grocery List" }]);
  });

  it("ranks a prefix match ahead of a mid-label match", () => {
    const result = filterMentionItems(items, "to");
    expect(result).toEqual([{ label: "To Buy" }, { label: "To Read" }]);
  });

  it("breaks prefix ties by shorter label first", () => {
    const result = filterMentionItems(
      [{ label: "To Buy Groceries" }, { label: "To Buy" }],
      "to buy",
    );
    expect(result[0]).toEqual({ label: "To Buy" });
  });

  it("respects the limit", () => {
    expect(filterMentionItems(items, "", 2)).toHaveLength(2);
  });
});
