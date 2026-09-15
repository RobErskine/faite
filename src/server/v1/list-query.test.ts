import { describe, expect, it } from "vitest";
import { listSchema, type List } from "@/lib/schema";
import { MCP_DEFAULT_LIST_FIELDS, parseListQuery, projectLists } from "./list-query";

function makeList(i: number, extra: Partial<List> = {}): List {
  return listSchema.parse({
    id: `0199${String(i).padStart(4, "0")}-aaaa-7bbb-8ccc-dddddddddddd`,
    ownerId: "user-1",
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    deletedAt: null,
    name: `List ${i}`,
    position: `a${i}`,
    ...extra,
  });
}

describe("projectLists", () => {
  it("MCP default: four fields, no nulls, no archived — 31 lists under 3k characters", () => {
    const lists = Array.from({ length: 31 }, (_, i) =>
      makeList(i, { isBacklog: i === 0, description: i % 3 === 0 ? "Groceries and errands" : null }),
    );
    lists.push(makeList(99, { archivedAt: "2026-09-01T00:00:00.000Z" }));

    const out = projectLists(lists, { fields: MCP_DEFAULT_LIST_FIELDS, includeArchived: false, omitNull: true });

    expect(out).toHaveLength(31);
    expect(out[0]).toEqual({
      id: lists[0].id,
      name: "List 0",
      description: "Groceries and errands",
      isBacklog: true,
    });
    expect("description" in out[1]).toBe(false);
    expect(JSON.stringify(out).length).toBeLessThan(3000);
  });

  it("includeArchived keeps archived lists", () => {
    const lists = [makeList(1), makeList(2, { archivedAt: "2026-09-01T00:00:00.000Z" })];
    expect(projectLists(lists, { fields: ["id"], includeArchived: true, omitNull: true })).toHaveLength(2);
  });

  it("REST default: empty fields returns the whole row, nulls kept", () => {
    const list = makeList(1);
    expect(projectLists([list], { fields: [], includeArchived: false, omitNull: false })).toEqual([list]);
  });
});

describe("parseListQuery", () => {
  const parse = (qs: string) => parseListQuery(new URLSearchParams(qs));

  it("defaults to every field and no archived lists", () => {
    expect(parse("")).toEqual({ fields: [], includeArchived: false });
  });

  it("reads comma-separated fields and the flag", () => {
    expect(parse("fields=id, name&includeArchived=true")).toEqual({
      fields: ["id", "name"],
      includeArchived: true,
    });
  });

  it("rejects an unknown field or a malformed flag", () => {
    expect(parse("fields=id,version")).toBeNull();
    expect(parse("includeArchived=yes")).toBeNull();
  });
});
