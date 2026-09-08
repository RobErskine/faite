import { describe, expect, it } from "vitest";
import { listSchema, tabSchema } from "@/lib/schema";
import { parseCreateTodoRequest, parsePatchRequest, parseUpdateTodoRequest } from "./validate";

describe("parseCreateTodoRequest", () => {
  it("accepts a minimal request — just a title, every optional field defaulted", () => {
    // Zod's own `.default(...)` on each field, same as `buildCreateTodoEntry`
    // would apply via `input.x ?? null` anyway — this is create-input
    // shorthand, not the sparse-patch trap `parseUpdateTodoRequest` guards
    // against below.
    expect(parseCreateTodoRequest({ title: "Buy milk" })).toEqual({
      title: "Buy milk",
      description: null,
      priority: null,
      scheduledDate: null,
      deadline: null,
      listId: null,
      projectId: null,
      labelIds: [],
      location: null,
      placeId: null,
      reminderTime: null,
      source: null,
      parentId: null,
    });
  });

  it("rejects a missing title", () => {
    expect(parseCreateTodoRequest({})).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    expect(parseCreateTodoRequest(null)).toBeNull();
    expect(parseCreateTodoRequest("not an object")).toBeNull();
    expect(parseCreateTodoRequest({ title: "x", priority: "not-a-number" })).toBeNull();
  });

  it("carries every writable field through", () => {
    const parsed = parseCreateTodoRequest({
      title: "Call dentist",
      description: "re: molar",
      priority: 2,
      scheduledDate: "2026-08-20",
      deadline: "2026-08-25",
      listId: "list-1",
      projectId: "project-1",
      labelIds: ["label-1"],
      location: "123 Main St",
      placeId: "place-1",
      reminderTime: "09:00",
      source: null,
      parentId: null,
    });
    expect(parsed).toMatchObject({
      title: "Call dentist",
      description: "re: molar",
      priority: 2,
      scheduledDate: "2026-08-20",
      deadline: "2026-08-25",
      listId: "list-1",
      projectId: "project-1",
      labelIds: ["label-1"],
      location: "123 Main St",
      placeId: "place-1",
      reminderTime: "09:00",
    });
  });

  it("REGRESSION: never accepts position — it is server-resolved, not client-settable", () => {
    const parsed = parseCreateTodoRequest({ title: "x", position: "z9" });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("position");
  });

  it("REGRESSION: never accepts status or completedAt — a new todo is always open, per buildCreateTodoEntry", () => {
    const parsed = parseCreateTodoRequest({ title: "x", status: "done", completedAt: "2026-01-01" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("completedAt");
  });
});

describe("parseUpdateTodoRequest", () => {
  it("accepts a single-field patch WITHOUT expanding it to every other field's default", () => {
    // The regression this file's own header comment describes: an earlier
    // version of this function used a static `.pick(ALL).partial()` schema,
    // which silently expanded this into a 14-key patch that would have
    // clobbered every other field on the real row.
    expect(parseUpdateTodoRequest({ status: "done" })).toEqual({ status: "done" });
  });

  it("accepts a multi-field patch with exactly those fields, nothing else", () => {
    expect(parseUpdateTodoRequest({ title: "New title", priority: 1 })).toEqual({
      title: "New title",
      priority: 1,
    });
  });

  it("rejects an empty patch — never a valid PATCH", () => {
    expect(parseUpdateTodoRequest({})).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    expect(parseUpdateTodoRequest(null)).toBeNull();
    expect(parseUpdateTodoRequest("not an object")).toBeNull();
    expect(parseUpdateTodoRequest({ status: "not-a-status" })).toBeNull();
  });

  it("ignores unwritable keys (position, id, ownerId) rather than rejecting the whole patch", () => {
    expect(parseUpdateTodoRequest({ status: "done", position: "z9", id: "evil" })).toEqual({
      status: "done",
    });
  });

  it("a patch containing ONLY unwritable keys is treated as empty", () => {
    expect(parseUpdateTodoRequest({ position: "z9" })).toBeNull();
  });

  it("accepts completedAt, which only an update may set", () => {
    expect(parseUpdateTodoRequest({ completedAt: "2026-08-20T12:00:00.000Z" })).toEqual({
      completedAt: "2026-08-20T12:00:00.000Z",
    });
  });
});

/**
 * REGRESSION (A11, EI-291). `parseUpdateTodoRequest` is now a wrapper over the
 * generic `parsePatchRequest`, which A14/A15 reuse for lists, labels and tabs.
 * These assert the extraction actually generalizes — i.e. that the dynamic
 * mask still suppresses `.default()` on a schema OTHER than `todoSchema`.
 *
 * The stakes are higher here than for todos. A static
 * `listSchema.partial().parse({ name })` returns EVERY field at its default,
 * including `isBacklog: false` — which, pushed at the Backlog list, leaves the
 * account with no backlog at all, a delete guard that never fires again, and
 * homeless todos with nowhere to land. `tabSchema.isDefault` is the same shape.
 */
describe("parsePatchRequest generalizes beyond todos", () => {
  const LIST_FIELDS = new Set(["name", "color", "emoji", "description", "tabId", "archivedAt"]);
  const TAB_FIELDS = new Set(["name", "color", "emoji", "description", "archivedAt"]);

  it("a rename patch on a list does NOT expand to isBacklog: false", () => {
    const patch = parsePatchRequest(listSchema, LIST_FIELDS, { name: "Errands" });

    expect(patch).toEqual({ name: "Errands" });
    expect(patch).not.toHaveProperty("isBacklog");
    expect(patch).not.toHaveProperty("color");
    expect(patch).not.toHaveProperty("tabId");
  });

  it("a rename patch on a tab does NOT expand to isDefault: false", () => {
    const patch = parsePatchRequest(tabSchema, TAB_FIELDS, { name: "Work" });

    expect(patch).toEqual({ name: "Work" });
    expect(patch).not.toHaveProperty("isDefault");
    expect(patch).not.toHaveProperty("archivedAt");
  });

  it("drops keys outside the updatable allow-list, so a server-owned field can't be reached", () => {
    // `isBacklog` is never in a route's `updatable` set — naming it explicitly
    // must not smuggle it through, and must not count toward "non-empty".
    expect(parsePatchRequest(listSchema, LIST_FIELDS, { isBacklog: true })).toBeNull();
    expect(parsePatchRequest(listSchema, LIST_FIELDS, { name: "Errands", isBacklog: true })).toEqual({
      name: "Errands",
    });
  });

  it("still rejects malformed and empty bodies", () => {
    expect(parsePatchRequest(listSchema, LIST_FIELDS, null)).toBeNull();
    expect(parsePatchRequest(listSchema, LIST_FIELDS, "nope")).toBeNull();
    expect(parsePatchRequest(listSchema, LIST_FIELDS, {})).toBeNull();
  });

  it("still rejects a well-formed key carrying the wrong type", () => {
    expect(parsePatchRequest(listSchema, LIST_FIELDS, { name: 42 })).toBeNull();
  });
});
