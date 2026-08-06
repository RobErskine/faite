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

  it("still synthesizes position when genuinely missing — a wrong sort order is cosmetic", () => {
    const result = hydrateRemoteRow("list", "list-1", { name: "Real name" }, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(typeof result.row.position).toBe("string");
    expect((result.row.position as string).length).toBeGreaterThan(0);
  });

  it(
    "REGRESSION: fails closed (does not invent a name) when name is genuinely missing — " +
      "this fallback used to fire, and inventing \"Untitled\" was the client-side half of a " +
      "live data-loss incident",
    () => {
      const result = hydrateRemoteRow("list", "list-1", { position: "a0" }, CTX);
      expect(result.ok).toBe(false);
    },
  );

  it("fails closed when title is genuinely missing, same reasoning as name", () => {
    const result = hydrateRemoteRow("todo", "todo-1", { position: "a0" }, CTX);
    expect(result.ok).toBe(false);
  });

  it(
    "settings: a missing fontPairing/theme/avatarKind still succeeds, via settingsSchema's " +
      "OWN Zod .default() — not this file's fallback map, which has no entry for them. Not a " +
      "gap: hydrateRemoteRow only ever runs on the brand-new-local-row path, so there's no " +
      "existing value to lose (merge.ts's FLOOR_HLC rule already protects that case)",
    () => {
      const result = hydrateRemoteRow("settings", "settings", { displayName: "Rob" }, CTX);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.row.fontPairing).toBe("hyperlegible");
      expect(result.row.theme).toBe("system");
      expect(result.row.avatarKind).toBe("initials");
    },
  );

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

  it("hydrates a fully-specified settings create", () => {
    const result = hydrateRemoteRow(
      "settings",
      "settings",
      { fontPairing: "hyperlegible", theme: "system", avatarKind: "initials" },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.fontPairing).toBe("hyperlegible");
    expect(result.row.theme).toBe("system");
    expect(result.row.avatarKind).toBe("initials");
  });
});
