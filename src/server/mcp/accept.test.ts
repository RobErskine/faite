import { describe, expect, it } from "vitest";
import { withEventStreamAccept } from "./accept";

function requestWithAccept(accept: string | null): Request {
  const headers = new Headers();
  if (accept !== null) headers.set("accept", accept);
  return new Request("https://myfaite.app/mcp", { method: "POST", headers });
}

describe("withEventStreamAccept", () => {
  it("leaves an already-compliant Accept header untouched", () => {
    const request = requestWithAccept("application/json, text/event-stream");
    const widened = withEventStreamAccept(request);
    expect(widened.headers.get("accept")).toBe("application/json, text/event-stream");
  });

  it("REGRESSION: widens a JSON-only Accept header rather than 406ing the client", () => {
    // Verified live against the installed SDK while building this ticket:
    // the transport's pre-dispatch gate 406s any request whose Accept
    // header omits `text/event-stream`, and `responseMode` cannot relax
    // that gate. A minimal client sending only `application/json` must be
    // widened here or it never connects at all.
    const request = requestWithAccept("application/json");
    const widened = withEventStreamAccept(request);
    expect(widened.headers.get("accept")).toBe("application/json, text/event-stream");
  });

  it("widens a missing Accept header to the full compliant pair", () => {
    const request = requestWithAccept(null);
    const widened = withEventStreamAccept(request);
    expect(widened.headers.get("accept")).toBe("application/json, text/event-stream");
  });

  it("preserves every other header and the request body reference", () => {
    const request = new Request("https://myfaite.app/mcp", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer x" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
    });
    const widened = withEventStreamAccept(request);
    expect(widened.headers.get("content-type")).toBe("application/json");
    expect(widened.headers.get("authorization")).toBe("Bearer x");
    expect(widened.method).toBe("POST");
  });

  it("only ever adds text/event-stream, never removes an existing Accept value", () => {
    const request = requestWithAccept("application/json, text/plain");
    const widened = withEventStreamAccept(request);
    expect(widened.headers.get("accept")).toBe("application/json, text/plain, text/event-stream");
  });
});
