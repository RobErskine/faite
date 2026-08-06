import { describe, expect, it } from "vitest";
import { hydrateRemoteRow } from "./hydrate";

const CTX = { ownerId: "user-1", now: "2026-08-05T00:00:00.000Z" };

describe("hydrateRemoteRow", () => {
  it("hydrates a fully-specified remote todo create", () => {
    const result = hydrateRemoteRow(
      "todo",
      "todo-1",
      { title: "Buy milk", status: "open", position: "a0" },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.id).toBe("todo-1");
    expect(result.row.ownerId).toBe("user-1");
    expect(result.row.title).toBe("Buy milk");
    expect(result.row.status).toBe("open");
    // Zod-defaulted fields the caller never supplied.
    expect(result.row.labelIds).toEqual([]);
    expect(result.row.deletedAt).toBeNull();
  });

  it("synthesizes required-with-no-default fields when genuinely missing", () => {
    const result = hydrateRemoteRow("list", "list-1", {}, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.name).toBe("Untitled");
    expect(typeof result.row.position).toBe("string");
    expect((result.row.position as string).length).toBeGreaterThan(0);
  });

  it("id and ownerId always come from ctx/entityId, never from the fields payload", () => {
    const result = hydrateRemoteRow(
      "todo",
      "todo-1",
      { id: "attacker-id", ownerId: "attacker-owner", title: "x", position: "a0" },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.id).toBe("todo-1");
    expect(result.row.ownerId).toBe("user-1");
  });

  it("fails closed (not throws) on a value that violates the schema", () => {
    const result = hydrateRemoteRow(
      "todo",
      "todo-1",
      { title: "x", position: "a0", priority: 99 }, // priority must be 1-4
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("never produces undefined in a successful hydration", () => {
    const result = hydrateRemoteRow("todo", "todo-1", { title: "x", position: "a0" }, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    for (const value of Object.values(result.row)) {
      expect(value).not.toBeUndefined();
    }
  });

  it("hydrates settings, silently dropping the stray id/createdAt the generic candidate sets", () => {
    const result = hydrateRemoteRow("settings", "settings", { fontPairing: "editorial" }, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.ownerId).toBe("user-1");
    expect(result.row.fontPairing).toBe("editorial");
    // settingsSchema has no `id`/`createdAt` fields — zod strips them.
    expect(result.row).not.toHaveProperty("id");
    expect(result.row).not.toHaveProperty("createdAt");
  });

  it("synthesizes fontPairing/theme/avatarKind for a bare settings create", () => {
    const result = hydrateRemoteRow("settings", "settings", {}, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.fontPairing).toBe("hyperlegible");
    expect(result.row.theme).toBe("system");
    expect(result.row.avatarKind).toBe("initials");
  });
});
