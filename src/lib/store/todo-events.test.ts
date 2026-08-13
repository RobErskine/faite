// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildEditedPayload, JOURNALLED_FIELDS, logTodoEvent, parseEventPayload } from "./todo-events";

beforeEach(async () => {
  localStorage.clear();
});

describe("logTodoEvent", () => {
  it("builds a row with a fresh UUIDv7 id, the local owner, and a null payload by default", () => {
    const event = logTodoEvent("todo-1", "created");
    expect(event.todoId).toBe("todo-1");
    expect(event.kind).toBe("created");
    expect(event.payload).toBeNull();
    expect(event.deletedAt).toBeNull();
    expect(event.id).toBeTruthy();
    expect(event.ownerId).toBeTruthy();
  });

  it("serializes a payload to JSON", () => {
    const event = logTodoEvent("todo-1", "scheduled", { v: 1, from: null, to: "2026-08-20" });
    expect(event.payload).toBe(JSON.stringify({ v: 1, from: null, to: "2026-08-20" }));
  });

  it("accepts an explicit `at`, distinct from `createdAt` (when the fact happened vs when the row was written)", () => {
    const event = logTodoEvent("todo-1", "created", null, "2020-01-01T00:00:00.000Z");
    expect(event.at).toBe("2020-01-01T00:00:00.000Z");
    expect(event.at).not.toBe(event.createdAt);
  });
});

describe("parseEventPayload", () => {
  it("round-trips a real payload", () => {
    const payload = { v: 1, fields: ["priority"] };
    expect(parseEventPayload(JSON.stringify(payload))).toEqual(payload);
  });

  it("returns null for a null payload", () => {
    expect(parseEventPayload(null)).toBeNull();
  });

  it(
    "REGRESSION: a malformed payload parses to null rather than throwing — " +
      "an unreadable payload must still render its row",
    () => {
      expect(parseEventPayload("{not valid json")).toBeNull();
    },
  );
});

describe("buildEditedPayload", () => {
  it("returns null when the patch touches no journalled field", () => {
    expect(buildEditedPayload({ position: "a0", updatedAt: "now" })).toBeNull();
  });

  it("lists every journalled field the patch touched", () => {
    const payload = buildEditedPayload({ title: "New title", priority: 2, position: "a0" });
    expect(payload?.fields.sort()).toEqual(["priority", "title"]);
  });

  it("captures values only for value-captured fields (priority, deadline)", () => {
    const payload = buildEditedPayload({ title: "New title", priority: 1, deadline: "2026-08-20" });
    expect(payload?.to).toEqual({ priority: 1, deadline: "2026-08-20" });
  });

  it("omits `to` entirely when no touched field captures a value", () => {
    const payload = buildEditedPayload({ title: "New title", location: "Home" });
    expect(payload?.to).toBeUndefined();
  });

  it("every JOURNALLED_FIELDS entry is recognized", () => {
    for (const field of JOURNALLED_FIELDS) {
      expect(buildEditedPayload({ [field]: "x" })?.fields).toEqual([field]);
    }
  });
});
