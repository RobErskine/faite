import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { mergeRecord } from "@/lib/sync/merge";
import { SEED_HLC, SETTINGS_ENTITY_ID, SYNC_KINDS, SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import type { PullResponse, PushRequest, PushResponse, SyncKind } from "@/lib/sync/wire";
import type { FieldClockMap } from "./apply-patch";
import { type KindPage, mergePages } from "./pull";
import { groupByEntity, resolveEntityPush, validateEntries } from "./push";
import { buildInsertColumns } from "./upsert";

/**
 * An in-memory stand-in for the DO's SQLite storage, composing the exact same
 * pure pieces `user-do.ts` composes (`validateEntries`, `groupByEntity`,
 * `resolveEntityPush`, `buildInsertColumns`, `mergePages`) — only the SQL
 * itself is faked. If this passes and `user-do.ts`'s dry-run bundles, the two
 * can only disagree in the SQL glue, which is exactly what the manual
 * two-browser smoke test (Phase 4) is for.
 */
class FakeServer {
  private rows = new Map<SyncKind, Map<string, Record<string, unknown> & { id: string; version: number }>>();
  private clocks = new Map<string, FieldClockMap>();
  private nextVersion = 1;

  push(userId: string, request: PushRequest): PushResponse {
    const { accepted, rejected } = validateEntries(request.entries);
    const groups = groupByEntity(accepted);
    const conflicts: PushResponse["conflicts"] = [];
    let highestVersion = 0;
    const nowIso = "2026-01-01T00:00:00.000Z";

    for (const group of groups) {
      const existingClocks = this.clocks.get(group.entityId) ?? {};
      const resolution = resolveEntityPush(existingClocks, group);

      if (resolution.conflicts.length > 0) {
        conflicts.push({ entityId: group.entityId, fields: resolution.conflicts });
      }
      if (Object.keys(resolution.apply).length === 0) continue;

      const version = this.nextVersion++;
      const table = this.rows.get(group.kind) ?? new Map();
      this.rows.set(group.kind, table);
      const existingRow = table.get(group.entityId);

      const row = existingRow
        ? { ...existingRow, ...resolution.apply, version }
        : (buildInsertColumns(group.kind, group.entityId, userId, resolution.apply, nowIso, version) as Record<
            string,
            unknown
          > & { id: string; version: number });
      table.set(group.entityId, row);

      this.clocks.set(group.entityId, { ...existingClocks, ...resolution.clockUpdates });
      highestVersion = Math.max(highestVersion, version);
    }

    return { acked: accepted.map((entry) => entry.id), rejected, highestVersion, conflicts };
  }

  pull(cursor: number, limit: number): PullResponse {
    const pages: KindPage[] = SYNC_KINDS.map((kind) => {
      const table = this.rows.get(kind) ?? new Map();
      const rows = Array.from(table.values())
        .filter((row) => row.version > cursor)
        .sort((a, b) => a.version - b.version)
        .slice(0, limit)
        // Mirrors user-do.ts's pull(): settings rows carry no `id` column
        // (buildInsertColumns strips it), so stand in with the same
        // sentinel push() normalizes entityId to.
        .map((row) => (kind === "settings" ? { ...row, id: SETTINGS_ENTITY_ID } : row));
      return { kind, rows, exhausted: rows.length === limit };
    });

    const entityIds = pages.flatMap((page) => page.rows.map((row) => row.id));
    const fieldClocksByEntityId: Record<string, FieldClockMap> = {};
    for (const id of entityIds) fieldClocksByEntityId[id] = this.clocks.get(id) ?? {};

    const merged = mergePages(pages, cursor, limit, fieldClocksByEntityId);
    return { protocol: SYNC_PROTOCOL_VERSION, ...merged };
  }
}

const USER_ID = "user-1";
const TODO_ID = "todo-1";

describe("round trip: two devices editing different fields", () => {
  it("both edits survive on both devices, conflicts stay empty, and the echo terminates", () => {
    const server = new FakeServer();

    // Device A creates the row.
    const createHlc = encodeHlc({ phys: 1000, counter: 0, nodeId: "device-a" });
    server.push(USER_ID, {
      protocol: SYNC_PROTOCOL_VERSION,
      entries: [
        {
          id: "a-create",
          kind: "todo",
          entityId: TODO_ID,
          patch: { title: "Shared todo", status: "open", position: "a0" },
          hlc: createHlc,
        },
      ],
    });

    // Device A edits title; Device B edits status — concurrently, offline.
    const titleHlc = encodeHlc({ phys: 2000, counter: 0, nodeId: "device-a" });
    const statusHlc = encodeHlc({ phys: 2000, counter: 0, nodeId: "device-b" });

    const aPush = server.push(USER_ID, {
      protocol: SYNC_PROTOCOL_VERSION,
      entries: [{ id: "a-title", kind: "todo", entityId: TODO_ID, patch: { title: "A's title" }, hlc: titleHlc }],
    });
    expect(aPush.acked).toEqual(["a-title"]);
    expect(aPush.conflicts).toEqual([]);

    const bPush = server.push(USER_ID, {
      protocol: SYNC_PROTOCOL_VERSION,
      entries: [{ id: "b-status", kind: "todo", entityId: TODO_ID, patch: { status: "done" }, hlc: statusHlc }],
    });
    expect(bPush.acked).toEqual(["b-status"]);
    expect(bPush.conflicts).toEqual([]);

    // Both devices pull the full history from scratch and fold it through the
    // REAL client merge, each with no pending outbox left (both already
    // pushed and, per the protocol, delete on ack) — so remote wins outright
    // for every field, which is exactly what "both edits survive" requires.
    const applyChanges = (pull: PullResponse) => {
      let local: Record<string, unknown> | undefined;
      const allConflicts: string[] = [];
      for (const change of pull.changes) {
        const result = mergeRecord(local, [], change);
        local = { ...(local ?? {}), ...result.apply };
        allConflicts.push(...result.conflicts);
      }
      return { local, conflicts: allConflicts };
    };

    const aPull = server.pull(0, 100);
    const bPull = server.pull(0, 100);
    const aResolved = applyChanges(aPull);
    const bResolved = applyChanges(bPull);

    expect(aResolved.conflicts).toEqual([]);
    expect(bResolved.conflicts).toEqual([]);
    expect(aResolved.local).toMatchObject({ title: "A's title", status: "done" });
    expect(bResolved.local).toMatchObject({ title: "A's title", status: "done" });
    expect(aResolved.local).toEqual(bResolved.local);

    // The echo terminates: pulling again from the advanced cursor is empty.
    const aPullAgain = server.pull(aPull.cursor, 100);
    expect(aPullAgain.changes).toEqual([]);
    expect(aPullAgain.hasMore).toBe(false);
  });

  it("re-pushing an already-acked entry acks again, allocates no version, and changes nothing", () => {
    const server = new FakeServer();
    const hlc = encodeHlc({ phys: 1000, counter: 0, nodeId: "device-a" });
    const entry = {
      id: "a-create",
      kind: "todo" as const,
      entityId: TODO_ID,
      patch: { title: "Once", position: "a0" },
      hlc,
    };

    const first = server.push(USER_ID, { protocol: SYNC_PROTOCOL_VERSION, entries: [entry] });
    expect(first.acked).toEqual(["a-create"]);
    expect(first.highestVersion).toBe(1);

    const pullAfterFirst = server.pull(0, 100);

    // Simulates a lost response: the client never saw the ack and retries.
    const second = server.push(USER_ID, { protocol: SYNC_PROTOCOL_VERSION, entries: [entry] });
    expect(second.acked).toEqual(["a-create"]); // still "processed", not applied
    expect(second.highestVersion).toBe(0); // no version allocated — nothing changed

    const pullAfterSecond = server.pull(pullAfterFirst.cursor, 100);
    expect(pullAfterSecond.changes).toEqual([]);
  });

  it("settings: pushes under any client entityId, pulls back under the shared sentinel, activeTabId never leaves the device", () => {
    const server = new FakeServer();
    const hlc = encodeHlc({ phys: 1000, counter: 0, nodeId: "device-a" });

    // The client always sends its own Dexie PK ("local-user") — the server
    // must not depend on that value.
    const push = server.push(USER_ID, {
      protocol: SYNC_PROTOCOL_VERSION,
      entries: [
        {
          id: "a-settings",
          kind: "settings",
          entityId: "local-user",
          patch: { theme: "dark", activeTabId: "tab-1" },
          hlc,
        },
      ],
    });
    expect(push.acked).toEqual(["a-settings"]);

    const pull = server.pull(0, 100);
    // Two changes: the pushed field (theme, at the real hlc) and the
    // synthesized NOT-NULL placeholders from the first-ever create
    // (fontPairing/avatarKind/updatedAt — not in the patch, so no clock —
    // grouped under FLOOR_HLC), same shape as any other kind's create.
    expect(pull.changes).toContainEqual({
      kind: "settings",
      entityId: SETTINGS_ENTITY_ID,
      patch: { theme: "dark" },
      hlc,
    });
    // activeTabId was stripped server-side (sanitizePatch's allow-list) —
    // it must not appear in ANY change, synthesized group included.
    expect(pull.changes.every((c) => !("activeTabId" in c.patch))).toBe(true);
  });

  it(
    "REGRESSION: a partial first write (adoptLocalData's {ownerId, updatedAt}, sanitized to " +
      "{updatedAt}) synthesizes a placeholder name, which must not overwrite a device's real " +
      "one — the exact live bug: a real list's name became \"Untitled\"",
    () => {
      const server = new FakeServer();
      const LIST_ID = "seed:list:backlog";

      // adoptLocalData enqueues {ownerId, updatedAt} for every seed row;
      // sanitizePatch strips ownerId (SERVER_ONLY_FIELDS) server-side, so
      // this is the actual patch shape that reaches the server for a row it
      // has never seen — a genuinely partial first write, on the ordinary
      // sign-in path (see upsert.ts's corrected reachability note).
      const partialHlc = encodeHlc({ phys: 1000, counter: 0, nodeId: "device-b" });
      const push = server.push(USER_ID, {
        protocol: SYNC_PROTOCOL_VERSION,
        entries: [
          {
            id: "b-adopt",
            kind: "list",
            entityId: LIST_ID,
            patch: { updatedAt: "2026-01-01T00:00:00.000Z" },
            hlc: partialHlc,
          },
        ],
      });
      expect(push.acked).toEqual(["b-adopt"]);

      const pull = server.pull(0, 100);
      // Confirm the placeholder really was synthesized server-side — this
      // assertion is what proves the test would have caught the live bug,
      // not just that nothing changed.
      const nameChange = pull.changes.find((c) => "name" in c.patch);
      expect(nameChange?.patch.name).toBe("Untitled");

      // Device A already has this row locally with its real name, fully
      // synced (no pending outbox entry for `name`) — exactly the state a
      // device is in moments after a fresh device's adoption push lands.
      let local: Record<string, unknown> = { id: LIST_ID, name: "Personal Lists" };
      for (const change of pull.changes) {
        const result = mergeRecord(local, [], change);
        local = { ...local, ...result.apply };
      }

      expect(local.name).toBe("Personal Lists");
    },
  );

  it(
    "REGRESSION: a second device's fresh seed can never overwrite an established, renamed " +
      "board — the SEED_HLC contract this session's fix depends on",
    () => {
      const server = new FakeServer();
      const TAB_ID = "seed:tab:my-lists";

      // Device A: seeds the default tab. A full-row create at SEED_HLC —
      // what seedWrite (mutate.ts) now produces, replacing the old raw
      // Dexie `put` that had no outbox entry at all.
      const aCreate = server.push(USER_ID, {
        protocol: SYNC_PROTOCOL_VERSION,
        entries: [
          {
            id: "a-seed-tab",
            kind: "tab",
            entityId: TAB_ID,
            patch: { name: "My Lists", isDefault: true, position: "a0" },
            hlc: SEED_HLC,
          },
        ],
      });
      expect(aCreate.acked).toEqual(["a-seed-tab"]);
      expect(aCreate.highestVersion).toBe(1); // a genuine version — nothing was synthesized

      // Device A renames it, later, with a real HLC.
      const renameHlc = encodeHlc({ phys: 5000, counter: 0, nodeId: "device-a" });
      const aRename = server.push(USER_ID, {
        protocol: SYNC_PROTOCOL_VERSION,
        entries: [
          { id: "a-rename", kind: "tab", entityId: TAB_ID, patch: { name: "Personal Lists" }, hlc: renameHlc },
        ],
      });
      expect(aRename.acked).toEqual(["a-rename"]);

      // Device B: a second browser on the SAME account, seeding
      // independently. SEED_HLC is a fixed constant — every device's fresh
      // seed carries the exact same clock, which is what makes this safe:
      // it can only ever tie-or-lose against anything already established.
      const bPush = server.push(USER_ID, {
        protocol: SYNC_PROTOCOL_VERSION,
        entries: [
          {
            id: "b-seed-tab",
            kind: "tab",
            entityId: TAB_ID,
            patch: { name: "My Lists", isDefault: true, position: "a0" },
            hlc: SEED_HLC,
          },
        ],
      });
      expect(bPush.acked).toEqual(["b-seed-tab"]); // processed...
      expect(bPush.highestVersion).toBe(0); // ...but nothing changed — no churn
      expect(bPush.conflicts).toEqual([{ entityId: TAB_ID, fields: ["name", "isDefault", "position"] }]);

      // Device B pulls. Its own seed entry is already acked (deleted
      // locally), so nothing blocks the real name from landing.
      let resolved: Record<string, unknown> = { id: TAB_ID, name: "My Lists", isDefault: true, position: "a0" };
      const bPull = server.pull(0, 100);
      for (const change of bPull.changes) {
        const result = mergeRecord(resolved, [], change);
        resolved = { ...resolved, ...result.apply };
      }

      expect(resolved.name).toBe("Personal Lists");
    },
  );

  it(
    "REGRESSION (settings): a partial first write does not reset a device's real font/avatar " +
      "choice to the synthesized default",
    () => {
      const server = new FakeServer();

      // Only `theme` is a real edit; fontPairing/avatarKind are NOT NULL
      // with no SQL default, so a first-ever settings write missing them
      // gets FIELD_DEFAULTS' synthesized values — same mechanism as `name`
      // above, different entity kind.
      const hlc = encodeHlc({ phys: 1000, counter: 0, nodeId: "device-b" });
      const push = server.push(USER_ID, {
        protocol: SYNC_PROTOCOL_VERSION,
        entries: [
          { id: "b-settings", kind: "settings", entityId: "local-user", patch: { theme: "dark" }, hlc },
        ],
      });
      expect(push.acked).toEqual(["b-settings"]);

      const pull = server.pull(0, 100);
      const fontChange = pull.changes.find((c) => "fontPairing" in c.patch);
      expect(fontChange?.patch.fontPairing).toBe("hyperlegible"); // confirms synthesis fired

      // Device A already has a real font choice, fully synced.
      let local: Record<string, unknown> = { ownerId: "local-user", fontPairing: "editorial" };
      for (const change of pull.changes) {
        const result = mergeRecord(local, [], change);
        local = { ...local, ...result.apply };
      }

      expect(local.fontPairing).toBe("editorial");
      expect(local.theme).toBe("dark"); // the real edit still applies
    },
  );
});
