# P5 — documented API + tokens (EI-50)

**Scaffolded, not cut over.** A scoped-down first pass landed the token model
(`src/server/auth-tokens.ts`), an OpenAPI-from-Zod generator
(`scripts/openapi/generate.ts`), and the transport-agnostic service-layer
shape (`src/lib/service/`, `src/server/service/`) — groundwork for the
desktop-shell bearer-auth work (D2), reviewed but deliberately not wired
into `/api/sync/*`'s live auth path. **"Who stamps the server-side HLC?"
below is still open** — the scaffold makes it an injectable seam
(`ServiceContext.nextHlc` in `src/lib/service/context.ts`) rather than
answering it. See that PR for the rest of this file's open questions and
what's still needed before any of this is real. This file otherwise remains
the design constraint a fresh agent needs *before* writing any endpoint, not
a spec.

[EI-50](https://linear.app/rob-erskine/issue/EI-50/zod-openapi-documented-api-tokens):
generate OpenAPI from the P1 Zod schemas, add API tokens with scopes and rate
limits, publish docs. Its own stated constraint:

> Keep the service layer transport-agnostic so REST, MCP, and the sync
> endpoints all wrap the *same* functions. Build the business logic once and
> MCP becomes a thin adapter rather than a parallel implementation.

## The thing that will go wrong

**A REST write that touches the Durable Object's tables directly is invisible
to sync, and gets silently reverted.**

Every synced write in this system does three things together, inside one
`transactionSync` (`user-do.ts`'s `push()`):

1. writes the row
2. allocates a **`version`** from `sync_meta` — this is the entire changelog;
   a pull is `WHERE version > cursor`
3. writes a **`field_clocks`** row per changed field — this is what
   field-level LWW compares against

Skip (2) and no device ever learns the row changed: their cursor is already
past it, so it is never pulled. Skip (3) and the field has no server clock, so
the next client push wins the comparison by default and overwrites it — the
API's write vanishes and looks like a sync bug, not an API bug.

So: **a REST/MCP write is not a database write. It is a push.** The natural
shape is for the service layer to construct `PushEntry`s and go through the
existing `push()` path, rather than to add a second write path beside it.

Two consequences worth deciding early:

- **Who stamps the HLC?** Client writes carry an HLC from the device's clock
  (`hlc.ts`). A server-originated write has no device. Either the DO stamps
  one with its own node id, or the API caller supplies one. The DO stamping it
  is simpler and keeps `nodeId` meaningful; it needs a stable server node id,
  which does not exist yet.

  **Half-answered by EI-186.** `serverHlcClock()`
  (`src/server/service/hlc.ts`) stamps `<phys>:<counter>:server` and is safe
  **for creates**: a create targets an entity with no `field_clocks` rows, so
  there is no LWW comparison to lose and no durable node id is required.
  **Server-originated UPDATES are still open** — the clock is per-isolate, so
  two isolates can issue the same stamp inside one millisecond and an update
  would silently lose. Do not reach for it from an update path until the
  persisted-node-id question is answered.

- **How does a server write resolve `position`?** *Answered by EI-186.* It
  cannot use `buildCreateTodoEntry`'s `fallbackPosition()`, which is the
  constant `"a0"` — every server-created todo would collide on one sort key.
  `UserDurableObject.nextTodoPosition()` is the read-only RPC that resolves a
  real one, mirroring the client's `nextTodoPosition()`
  (`store/repositories.ts:137`). Reuse it; do not add a second answer.
- **Live push comes free if you route through `push()`** — the P4 broadcast
  fires from inside it, so an API write already wakes every connected device.
  A parallel write path would not, and nobody would notice until a device sat
  stale.

## What already exists and should be reused

| Piece | Where | Note |
|---|---|---|
| Zod entity schemas | `src/lib/schema.ts` | The OpenAPI source. Don't hand-write a spec. |
| Request validation | `src/server/sync/validate.ts` | Already shared by HTTP + WebSocket; same idea extends here |
| Column whitelist + JS↔SQL coercion | `src/server/sync/columns.ts` | `sanitizePatch`, `toColumnValue`, `fromColumnValue` |
| LWW decision | `src/server/sync/apply-patch.ts` | Pure |
| Auth + routing seam | `src/server/worker.ts`, `sync/routes.ts`, `places/routes.ts` | `output: export` forbids Next Route Handlers that read `Request` — API routes must live here too (ARCHITECTURE §2.12) |
| A route that already gates on a session and proxies a paid upstream | `src/server/places/routes.ts` | The closest existing shape to a public API route: 501/401/400/429/502 mapping, and validation split into a testable pure module beside it |
| The service layer's first real consumer | `src/server/email/ingest.ts` (EI-186) | Non-HTTP transport (`email()`) going through `createTodo` → `push()`. Shows what a `ServiceContext` and a `PushTransport` actually look like at a call site |
| CORS allow-list | `src/server/auth.ts`'s `TRUSTED_ORIGINS` | One list |

## Open questions for P5

- **Tokens live where?** Sessions are in D1; per-user data is in the DO. An
  API token is global-ish (it authenticates a user, then addresses their DO),
  so D1 alongside Better Auth's tables is the natural home. Better Auth has
  an API-key plugin — check whether it fits before hand-rolling.
- **Rate limits keyed on what?** A DO is single-threaded per user and already
  has a documented ~1,000 req/s soft ceiling, so per-user limiting has a
  natural home in the DO itself. Global limits do not.
- **Does the API expose `version`/`hlc`?** They are currently
  `SERVER_ONLY_FIELDS` and never cross the sync wire. A documented API
  probably wants an opaque `updatedAt` and nothing else — exposing the clock
  makes it a compatibility surface forever.
- **Read path.** Reads are much simpler than writes: no version, no clocks.
  Consider shipping read-only endpoints first.

## Before writing code

- `docs/SCHEMA-CHANGES.md` if any entity shape changes.
- `docs/SYNC.md` — especially "The one decision to understand before touching
  anything (D2)" and the P4 section.
- `.ai/lessons.md`.
- The rule that has held twice now: **do not change merge semantics to make a
  transport work.** REST is just another transport.
