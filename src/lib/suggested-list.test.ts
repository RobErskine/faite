import { describe, expect, it } from "vitest";
import { listSchema, type List } from "./schema";
import { suggestedListFor } from "./suggested-list";

const list = (id: string, extra: Partial<List> = {}): List =>
  listSchema.parse({
    id,
    ownerId: "u",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    name: id,
    position: "a0",
    ...extra,
  });

const lists = new Map(
  [
    list("groceries"),
    list("old", { archivedAt: "2026-10-02T00:00:00.000Z" }),
    list("gone", { deletedAt: "2026-10-02T00:00:00.000Z" }),
    list("backlog", { isBacklog: true }),
  ].map((l) => [l.id, l]),
);

describe("suggestedListFor", () => {
  it("returns a live list proposed for an open to-do", () => {
    expect(suggestedListFor({ status: "open", suggestedListId: "groceries" }, lists)?.id).toBe("groceries");
  });

  it("shows nothing for no proposal, a closed to-do, or a list that is gone, archived, missing or Backlog", () => {
    const cases = [
      { status: "open", suggestedListId: null },
      { status: "done", suggestedListId: "groceries" },
      { status: "open", suggestedListId: "old" },
      { status: "open", suggestedListId: "gone" },
      { status: "open", suggestedListId: "missing" },
      { status: "open", suggestedListId: "backlog" },
    ] as const;
    for (const todo of cases) expect(suggestedListFor(todo, lists)).toBeNull();
  });
});
