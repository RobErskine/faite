/**
 * Transport-agnostic service layer (EI-50 P5, scoped-down). See
 * `src/lib/service/todos.ts` for the first real builder and docs/API.md for
 * the constraint this exists to satisfy: "Keep the service layer
 * transport-agnostic so REST, MCP, and the sync endpoints all wrap the same
 * functions."
 *
 * DOM-free by the same contract as `lib/sync/wire.ts` and `hlc-core.ts` —
 * nothing here may import Dexie (`lib/store/db.ts`) or `localStorage`
 * (`lib/sync/hlc.ts`), because this needs to run inside `src/server` (a
 * Worker, no DOM) just as much as it needs to run in the browser. `npm run
 * typecheck`'s worker pass (`tsc -p tsconfig.worker.json`) enforces this
 * transitively: anything under `src/server` that imports this module drags
 * it into that DOM-less program too.
 */

/**
 * What every service-layer call needs, regardless of transport.
 *
 * Deliberately just two fields. A REST handler builds this from a verified
 * bearer token's `referenceId`; an MCP tool builds it from whatever session
 * the MCP transport authenticates; the client's own outbox drain builds it
 * from `getCurrentOwnerId()`/`getNodeId()`. None of that belongs here.
 */
export interface ServiceContext {
  /**
   * The authenticated user this call is scoped to. Never read from a request
   * body — always the caller's own verified identity, exactly like
   * `userId` in `user-do.ts`'s `push()`.
   */
  userId: string;

  /**
   * Produces the HLC to stamp on entries this call builds.
   *
   * Deliberately injected rather than decided in here. docs/API.md flags
   * "who stamps the server-side HLC" as OPEN and UNRESOLVED: a client push
   * carries an HLC from the device's own clock (`lib/sync/hlc.ts`), but a
   * server-originated write (REST, MCP) has no device — and the DO stamping
   * one itself would need a stable server node id, which doesn't exist yet.
   * Whichever answer the real cutover picks, injecting the clock here means
   * picking it doesn't require touching every builder function — only the
   * one call site that constructs a `ServiceContext`.
   *
   * NOT resolved by this ticket. Deliberately left to the caller so this
   * scaffold doesn't quietly pick an answer nobody signed off on.
   */
  nextHlc: () => string;
}
