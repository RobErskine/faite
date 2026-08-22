/**
 * Verified live (`wrangler dev`, real handshake) while building this ticket:
 * the transport's pre-dispatch validation gate 406s any request whose
 * `Accept` header doesn't list BOTH `application/json` AND
 * `text/event-stream` — a strict reading of the Streamable HTTP spec, which
 * `responseMode: 'auto'` cannot relax; that option only picks the response
 * SHAPE once past this gate, it can't change what the gate itself demands.
 * A minimal client that only ever asks for `application/json` — precisely
 * the client shape the milestone doc's own "SSE↔JSON" lesson was about,
 * just manifesting as a clean 406 against this SDK instead of a hang against
 * the old one — would otherwise fail to connect at all.
 *
 * So: widen the Accept header before handing the request to the SDK, never
 * narrow it. A client that already sends both is untouched. A client
 * sending only `application/json` gets `text/event-stream` added, which
 * satisfies the gate.
 *
 * Kept in its own dependency-free module (mirroring `hlc-core.ts`'s split
 * from `hlc.ts`) so it stays unit-testable in vitest's Node environment:
 * `./routes.ts` transitively imports `agents/mcp`, which has a hard runtime
 * dependency on the `cloudflare:workers` module scheme that Node's ESM
 * loader cannot resolve.
 */
export function withEventStreamAccept(request: Request): Request {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) return request;

  const headers = new Headers(request.headers);
  headers.set("accept", accept ? `${accept}, text/event-stream` : "application/json, text/event-stream");
  return new Request(request, { headers });
}
