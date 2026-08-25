import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

/**
 * Every case here is one that `split(",")` gets wrong — which is the reason
 * this file exists rather than a one-liner in the preview component.
 */
describe("parseCsv", () => {
  it("reads a plain table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('name,address\n"Smith, J","1 High St, London"')).toEqual([
      ["name", "address"],
      ["Smith, J", "1 High St, London"],
    ]);
  });

  it("keeps a NEWLINE inside a quoted field", () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([["note"], ["line one\nline two"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('q\n"she said ""hi"""')).toEqual([["q"], ['she said "hi"']]);
  });

  it("treats a mid-field quote as data, not syntax", () => {
    // `12" pipe` is a real thing in a real spreadsheet.
    expect(parseCsv('size\n12" pipe')).toEqual([["size"], ['12" pipe']]);
  });

  it("handles CRLF without leaving stray carriage returns in cells", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not invent a phantom row from a trailing newline", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("keeps a final row that has no trailing newline", () => {
    expect(parseCsv("a\n1")).toEqual([["a"], ["1"]]);
  });

  it("preserves empty cells rather than collapsing them", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("leaves a ragged row ragged", () => {
    // Squaring it off here would hide a malformed export; the table pads for
    // display instead, where it is visible.
    expect(parseCsv("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
