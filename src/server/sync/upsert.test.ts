import { describe, expect, it } from "vitest";
import { buildInsertColumns } from "./upsert";

const NOW = "2026-08-05T00:00:00.000Z";

describe("buildInsertColumns", () => {
  it("synthesizes exactly the missing NOT NULL columns, leaving supplied ones alone", () => {
    const row = buildInsertColumns("todo", "todo-1", "user-1", { status: "open" }, NOW, 7);

    expect(row.id).toBe("todo-1");
    expect(row.ownerId).toBe("user-1");
    expect(row.createdAt).toBe(NOW);
    expect(row.updatedAt).toBe(NOW);
    expect(row.version).toBe(7);
    expect(row.status).toBe("open");
    // Synthesized: title (NOT NULL, no SQL default) and position (same).
    expect(row.title).toBe("");
    expect(typeof row.position).toBe("string");
    expect((row.position as string).length).toBeGreaterThan(0);
  });

  it("leaves a fully-supplied patch's fields untouched", () => {
    const row = buildInsertColumns(
      "todo",
      "todo-1",
      "user-1",
      { title: "Real title", position: "a1", createdAt: "2020-01-01T00:00:00.000Z" },
      NOW,
      1,
    );

    expect(row.title).toBe("Real title");
    expect(row.position).toBe("a1");
    // The patch's own createdAt (the client's real timestamp) wins over `nowIso`.
    expect(row.createdAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("synthesizes name (not title) for a list", () => {
    const row = buildInsertColumns("list", "list-1", "user-1", {}, NOW, 1);
    expect(row.name).toBe("Untitled");
    expect(row.title).toBeUndefined();
  });

  it("does not synthesize columns that already have a SQL default", () => {
    const row = buildInsertColumns("todo", "todo-1", "user-1", { title: "x" }, NOW, 1);
    // `status` defaults to "open" and `labelIds` to "[]" at the SQL layer —
    // neither should be force-populated here.
    expect(row.status).toBeUndefined();
    expect(row.labelIds).toBeUndefined();
  });

  it("settings: synthesizes fontPairing/theme/avatarKind and drops id/createdAt entirely", () => {
    const row = buildInsertColumns("settings", "settings", "user-1", {}, NOW, 1);

    expect(row.fontPairing).toBe("hyperlegible");
    expect(row.theme).toBe("system");
    expect(row.avatarKind).toBe("initials");
    expect(row.ownerId).toBe("user-1");
    expect(row.updatedAt).toBe(NOW);
    expect(row.version).toBe(1);
    // settings has neither column — must not appear at all, or the SQL
    // builder in user-do.ts would crash looking up their column metadata.
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("createdAt");
  });

  it("settings: leaves a fully-supplied patch's fields untouched", () => {
    const row = buildInsertColumns("settings", "settings", "user-1", { fontPairing: "precision" }, NOW, 1);
    expect(row.fontPairing).toBe("precision");
  });
});
