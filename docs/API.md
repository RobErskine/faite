# P5 — documented API + tokens (EI-50)

Not started. This is the design constraint a fresh agent needs *before*
writing any endpoint, not a spec.

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
