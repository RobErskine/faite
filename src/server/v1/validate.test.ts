import { describe, expect, it } from "vitest";
import { parseCreateTodoRequest, parseUpdateTodoRequest } from "./validate";

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
