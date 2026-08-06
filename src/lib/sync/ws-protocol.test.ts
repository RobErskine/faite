import { describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "./ws-protocol";
import {
  decodeClient,
  decodeServer,
  encode,
  MAX_SOCKET_AGE_MS,
  WS_CLOSE_ACCOUNT_DELETED,
  WS_CLOSE_REAUTH_REQUIRED,
} from "./ws-protocol";
import { SYNC_PROTOCOL_VERSION } from "./wire";

const pushMessage: ClientMessage = {
  id: "req-1",
  type: "push",
  payload: { protocol: SYNC_PROTOCOL_VERSION, entries: [] },
};

const pullMessage: ClientMessage = {
  id: "req-2",
  type: "pull",
  payload: { cursor: 7, limit: 100 },
};

describe("encode / decodeClient round trip", () => {
  it("round-trips a push", () => {
    expect(decodeClient(encode(pushMessage))).toEqual(pushMessage);
  });

  it("round-trips a pull", () => {
    expect(decodeClient(encode(pullMessage))).toEqual(pullMessage);
  });
});

describe("decodeClient is total", () => {
  /**
   * The whole point of this function. An uncaught throw out of
   * `webSocketMessage` can break the Durable Object stub for every socket
   * attached to it, not just the one that sent the bad frame — so a hostile
   * or truncated frame from one tab must not be able to disconnect another
   * device. Every input below must return null, and none may throw.
   */
  const garbage: unknown[] = [
    "",
    "not json",
    "{",
    '{"id":"a","type":"push"', // truncated
    "null",
    "42",
    '"a string"',
    "[]",
    '["push"]',
    JSON.stringify([pushMessage]), // array, not object
    JSON.stringify({ id: "a", type: "push" }), // no payload
    JSON.stringify({ id: "a", type: "push", payload: "nope" }),
    JSON.stringify({ id: "a", type: "push", payload: null }),
    JSON.stringify({ id: "a", type: "push", payload: [] }),
    JSON.stringify({ id: "", type: "push", payload: {} }), // empty id
    JSON.stringify({ type: "push", payload: {} }), // no id
    JSON.stringify({ id: 1, type: "push", payload: {} }), // non-string id
    JSON.stringify({ id: "a", type: "wipe", payload: {} }), // unknown type
    JSON.stringify({ id: "a", type: "push-response", payload: {} }), // server type
    JSON.stringify({ id: "a", payload: {} }), // no type
    new ArrayBuffer(8), // binary frames are never sent
    undefined,
    null,
    123,
  ];

  for (const [index, input] of garbage.entries()) {
    it(`returns null (never throws) for garbage input #${index}`, () => {
      expect(() => decodeClient(input)).not.toThrow();
      expect(decodeClient(input)).toBeNull();
    });
  }

  it("does not decode a __proto__ key into the prototype chain", () => {
    // `JSON.parse('{"__proto__":1}')` creates a normal OWN property, so it
    // really can appear in Object.keys — same trap `columns.test.ts` pins on
    // the push path. Decoding must not let it become a prototype write.
    const decoded = decodeClient('{"id":"a","type":"push","payload":{"__proto__":{"polluted":true}}}');
    expect(decoded).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("decodeServer", () => {
  it("round-trips a push-response", () => {
    const message: ServerMessage = {
      id: "req-1",
      type: "push-response",
      payload: { acked: ["a"], rejected: [], highestVersion: 3, conflicts: [] },
    };
    expect(decodeServer(encode(message))).toEqual(message);
  });

  it("round-trips a pull-response", () => {
    const message: ServerMessage = {
      id: "req-2",
      type: "pull-response",
      payload: { protocol: SYNC_PROTOCOL_VERSION, changes: [], cursor: 9, hasMore: false },
    };
    expect(decodeServer(encode(message))).toEqual(message);
  });

  it("round-trips an error", () => {
    const message: ServerMessage = { id: "req-3", type: "error", payload: { message: "boom" } };
    expect(decodeServer(encode(message))).toEqual(message);
  });

  it("round-trips an unsolicited changed, which carries no id", () => {
    const message: ServerMessage = { type: "changed", version: 41 };
    expect(decodeServer(encode(message))).toEqual(message);
  });

  it("accepts changed at version 0", () => {
    // Not reachable in practice (`push()` broadcasts only when
    // highestVersion > 0), but 0 must not be confused with "missing".
    expect(decodeServer(JSON.stringify({ type: "changed", version: 0 }))).toEqual({
      type: "changed",
      version: 0,
    });
  });

  it("REGRESSION: rejects a changed with no usable version", () => {
    // The version is what lets a receiver skip a redundant pull. Silently
    // treating a missing version as 0 would make every sibling tab pull on
    // every push -- the exact cost the field exists to remove.
    expect(decodeServer(JSON.stringify({ type: "changed" }))).toBeNull();
    expect(decodeServer(JSON.stringify({ type: "changed", version: "3" }))).toBeNull();
    expect(decodeServer(JSON.stringify({ type: "changed", version: null }))).toBeNull();
    expect(decodeServer(JSON.stringify({ type: "changed", version: Number.NaN }))).toBeNull();
  });

  it("rejects a correlated response with no id", () => {
    expect(decodeServer(JSON.stringify({ type: "push-response", payload: {} }))).toBeNull();
  });

  it("rejects a client-only type", () => {
    expect(decodeServer(JSON.stringify({ id: "a", type: "push", payload: {} }))).toBeNull();
  });

  it("returns null (never throws) for garbage", () => {
    for (const input of ["", "{", "null", "[]", undefined, null, 42, new ArrayBuffer(4)]) {
      expect(() => decodeServer(input)).not.toThrow();
      expect(decodeServer(input)).toBeNull();
    }
  });
});

describe("close codes and socket age", () => {
  it("uses the RFC 6455 private range, which the runtime never generates", () => {
    for (const code of [WS_CLOSE_ACCOUNT_DELETED, WS_CLOSE_REAUTH_REQUIRED]) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });

  it("distinguishes the two, since one means reconnect and the other means stop", () => {
    expect(WS_CLOSE_ACCOUNT_DELETED).not.toBe(WS_CLOSE_REAUTH_REQUIRED);
  });

  it("bounds how long a socket runs on its handshake-time session", () => {
    expect(MAX_SOCKET_AGE_MS).toBeGreaterThan(0);
    expect(MAX_SOCKET_AGE_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
