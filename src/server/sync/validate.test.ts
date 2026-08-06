import { describe, expect, it } from "vitest";
import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  MAX_PUSH_ENTRIES,
  SYNC_PROTOCOL_VERSION,
} from "@/lib/sync/wire";
import { clampPullArgs, parsePushRequest } from "./validate";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    kind: "todo",
    entityId: "todo-1",
    patch: { title: "x" },
    hlc: "019f0000000a:0000:node-a",
    ...overrides,
  };
}

function pushBody(entries: unknown[] = [entry()]) {
  return { protocol: SYNC_PROTOCOL_VERSION, entries };
}

describe("parsePushRequest", () => {
  it("accepts a well-formed request", () => {
    const parsed = parsePushRequest(pushBody());
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.protocol).toBe(SYNC_PROTOCOL_VERSION);
  });

  it("accepts an empty batch", () => {
    // The client can legitimately push nothing (`planDrain` dropped every
    // entry). Rejecting it would turn a no-op into a 400.
    expect(parsePushRequest(pushBody([]))?.entries).toEqual([]);
  });

  it("rejects a wrong protocol version", () => {
    expect(parsePushRequest({ ...pushBody(), protocol: 2 })).toBeNull();
  });

  it("rejects a missing protocol version", () => {
    expect(parsePushRequest({ entries: [entry()] })).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(parsePushRequest(pushBody([entry({ kind: "wormhole" })]))).toBeNull();
  });

  it("rejects an empty id, entityId, or hlc", () => {
    expect(parsePushRequest(pushBody([entry({ id: "" })]))).toBeNull();
    expect(parsePushRequest(pushBody([entry({ entityId: "" })]))).toBeNull();
    expect(parsePushRequest(pushBody([entry({ hlc: "" })]))).toBeNull();
  });

  it("rejects a non-object patch", () => {
    expect(parsePushRequest(pushBody([entry({ patch: "nope" })]))).toBeNull();
    expect(parsePushRequest(pushBody([entry({ patch: null })]))).toBeNull();
  });

  it("accepts exactly MAX_PUSH_ENTRIES", () => {
    const entries = Array.from({ length: MAX_PUSH_ENTRIES }, (_, i) => entry({ id: `o-${i}` }));
    expect(parsePushRequest(pushBody(entries))?.entries).toHaveLength(MAX_PUSH_ENTRIES);
  });

  it("REGRESSION: rejects one past MAX_PUSH_ENTRIES", () => {
    // The WebSocket frame limit is 32 MiB, so without this cap a socket could
    // hand `push()` a 200k-entry batch to run inside one transactionSync.
    // The HTTP route has always enforced this; the WS path must not be the
    // way around it.
    const entries = Array.from({ length: MAX_PUSH_ENTRIES + 1 }, (_, i) => entry({ id: `o-${i}` }));
    expect(parsePushRequest(pushBody(entries))).toBeNull();
  });

  it("rejects garbage rather than throwing", () => {
    for (const body of [null, undefined, 42, "push", [], { entries: "x" }]) {
      expect(parsePushRequest(body)).toBeNull();
    }
  });
});

describe("clampPullArgs", () => {
  it("defaults both when absent", () => {
    expect(clampPullArgs(undefined, undefined)).toEqual({ cursor: 0, limit: DEFAULT_PULL_LIMIT });
  });

  it("accepts numeric strings, as the query-string path supplies them", () => {
    expect(clampPullArgs("42", "10")).toEqual({ cursor: 42, limit: 10 });
  });

  it("accepts real numbers, as the WebSocket JSON path supplies them", () => {
    expect(clampPullArgs(42, 10)).toEqual({ cursor: 42, limit: 10 });
  });

  it("REGRESSION: caps limit at MAX_PULL_LIMIT", () => {
    // Unclamped, this reaches `LIMIT ?` directly in `user-do.ts`'s pull(),
    // once per sync kind. `limit: 999999999` would pull the whole object
    // into memory six times over.
    expect(clampPullArgs(0, 999_999_999)?.limit).toBe(MAX_PULL_LIMIT);
  });

  it("falls back to the default limit for zero, negative, and non-numeric", () => {
    expect(clampPullArgs(0, 0)?.limit).toBe(DEFAULT_PULL_LIMIT);
    expect(clampPullArgs(0, -5)?.limit).toBe(DEFAULT_PULL_LIMIT);
    expect(clampPullArgs(0, "abc")?.limit).toBe(DEFAULT_PULL_LIMIT);
    expect(clampPullArgs(0, null)?.limit).toBe(DEFAULT_PULL_LIMIT);
  });

  it("REJECTS a bad cursor rather than defaulting it", () => {
    // Deliberately asymmetric with `limit`. Substituting 0 for an
    // unparseable cursor would silently replay the entire object at a client
    // that asked for a delta; there is no safe guess.
    expect(clampPullArgs("abc", 10)).toBeNull();
    expect(clampPullArgs(-1, 10)).toBeNull();
    expect(clampPullArgs(Number.NaN, 10)).toBeNull();
    expect(clampPullArgs(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("treats an explicitly empty query param as cursor 0, matching the HTTP route's prior behaviour", () => {
    expect(clampPullArgs("", undefined)?.cursor).toBe(0);
  });

  it("floors fractional input so it never reaches SQL as a float", () => {
    expect(clampPullArgs(10.9, 5.9)).toEqual({ cursor: 10, limit: 5 });
  });
});
