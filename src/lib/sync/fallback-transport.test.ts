import { describe, expect, it } from "vitest";
import { createFallbackTransport } from "./fallback-transport";
import type { SyncTransport } from "./transport";
import type { PullResponse, PushRequest, PushResponse } from "./wire";
import { SYNC_PROTOCOL_VERSION } from "./wire";

function labelled(label: string): SyncTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async push(): Promise<PushResponse> {
      calls.push("push");
      return { acked: [label], rejected: [], highestVersion: 0, conflicts: [] };
    },
    async pull(cursor): Promise<PullResponse> {
      calls.push("pull");
      return { protocol: SYNC_PROTOCOL_VERSION, changes: [], cursor, hasMore: false };
    },
  };
}

const request: PushRequest = { protocol: SYNC_PROTOCOL_VERSION, entries: [] };

describe("createFallbackTransport", () => {
  it("uses the primary while it is ready", async () => {
    const ws = labelled("ws");
    const http = labelled("http");
    const transport = createFallbackTransport(ws, http, () => true);

    expect((await transport.push(request)).acked).toEqual(["ws"]);
    await transport.pull(0, 100);
    expect(ws.calls).toEqual(["push", "pull"]);
    expect(http.calls).toEqual([]);
  });

  it("uses the fallback while the primary is not ready", async () => {
    const ws = labelled("ws");
    const http = labelled("http");
    const transport = createFallbackTransport(ws, http, () => false);

    expect((await transport.push(request)).acked).toEqual(["http"]);
    await transport.pull(0, 100);
    expect(ws.calls).toEqual([]);
    expect(http.calls).toEqual(["push", "pull"]);
  });

  it("re-checks readiness on EVERY call, not once at construction", async () => {
    const ws = labelled("ws");
    const http = labelled("http");
    let ready = false;
    const transport = createFallbackTransport(ws, http, () => ready);

    await transport.pull(0, 100);
    ready = true;
    await transport.pull(0, 100);
    ready = false;
    await transport.pull(0, 100);

    expect(http.calls).toEqual(["pull", "pull"]);
    expect(ws.calls).toEqual(["pull"]);
  });

  it("REGRESSION: a socket dying mid-cycle sends the pull down HTTP, not into the void", async () => {
    // `runSyncCycle` pushes then pulls. If the socket dies in between, the
    // pull must silently land on HTTP. This is the scenario per-call routing
    // exists for -- per-cycle routing would need a policy for it and this
    // design simply doesn't have the case.
    const ws = labelled("ws");
    const http = labelled("http");
    let ready = true;
    const transport = createFallbackTransport(ws, http, () => ready);

    await transport.push(request);
    ready = false; // socket dropped between push and pull
    const page = await transport.pull(41, 100);

    expect(ws.calls).toEqual(["push"]);
    expect(http.calls).toEqual(["pull"]);
    expect(page.cursor).toBe(41); // cursor threaded through unchanged
  });

  it("does not swallow a primary failure into the fallback", async () => {
    // Retrying a failed WS call over HTTP inside one logical call would
    // double-apply a push whose response was merely lost. `runSyncCycle`'s
    // own error handling is the right place for that decision, not here.
    const failing: SyncTransport = {
      push: async () => { throw new Error("socket exploded"); },
      pull: async () => { throw new Error("socket exploded"); },
    };
    const http = labelled("http");
    const transport = createFallbackTransport(failing, http, () => true);

    await expect(transport.push(request)).rejects.toThrow("socket exploded");
    expect(http.calls).toEqual([]);
  });
});
