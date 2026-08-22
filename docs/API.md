# P5 — documented API + tokens (EI-50), and Milestone A — Public API + MCP

**Status, updated through A2 (EI-227):** the token model
(`src/server/auth-tokens.ts`), the OpenAPI generator (A1, EI-226 —
`scripts/openapi/generate.ts`, two documents: `openapi/openapi.json`
internal, `openapi/v1.json` public), the durable server HLC (A4, EI-229 —
`UserDurableObject.nextServerHlc()`), and enforced key scopes plus the first
`/api/v1` read routes (A2, EI-227 — see "Key scopes" below) are all real and
live. What's below this point is the ORIGINAL P5 design doc, kept because
its constraints still hold; treat "open question" language in the
historical sections as answered where a later note says so, not as current
uncertainty. Remaining open work: write endpoints (A5, EI-230), the MCP
server (A6, EI-52), and published public docs (A7, EI-231).

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

  **Half-answered by EI-186, fully answered by A4 (EI-229).**
  `serverHlcClock()` (`src/server/service/hlc.ts`) stamps
  `<phys>:<counter>:server` and, with its DEFAULT in-memory persistence, is
  safe **for creates only**: a create targets an entity with no
  `field_clocks` rows, so there is no LWW comparison to lose and no durable
  node id is required.

  **Server-originated UPDATEs are now safe too.** `serverHlcClock` takes an
  injectable `HlcPersistence`; `UserDurableObject.nextServerHlc()` backs it
  with `sync_meta.server_last_hlc`, read and written with plain synchronous
  `ctx.storage.sql.exec` calls — the DO is single-threaded per user, so this
  closes the collision hole with no `transactionSync` needed (there is no
  `await` between the read and the write). Call `nextServerHlc()` from an
  update path now; the old create-only in-memory mode is unchanged and still
  what `email/ingest.ts` uses.

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

## Key scopes (A2, EI-227)

`enableSessionForAPIKeys: true` (`auth-tokens.ts`, D2a) stays global and
untouched — narrowing it, or checking `permissions` inside Better Auth's own
session hook, would leave `useSession()` blind to a valid key, which is
exactly the mistake D2a's own comment warns against. Scopes are enforced one
layer up instead, in `src/server/auth-scopes.ts`:

- **Two permission sets, not one.** A desktop-handoff key
  (`/api/desktop/handoff`) is created with `DESKTOP_KEY_PERMISSIONS` — full
  equivalence (`read`, `write`, `sync`, `places`), unchanged from before this
  ticket: "this is me, on my own device." Any other key (A3's user-generated
  keys) gets `auth-tokens.ts`'s `defaultPermissions` — `{ api: ["read"] }` —
  unless a future UI asks for more.
- **`authorizeScope(auth, request, scope)`** gates `/api/sync/*` (`scope:
  "sync"`), `/api/places/*` (`scope: "places"`), and `/api/v1/*` (`scope:
  "read"`). A cookie session is unaffected — full access, exactly as before
  this ticket, because a cookie carries no permission set to check at all.
  An API-key-carrying request must additionally hold the required
  permission, checked with `role(...).authorize(...)` from
  `better-auth/plugins/access` (the same primitive `@better-auth/api-key`
  uses internally) against the key's OWN stored `permissions` — never by
  "is this an API key," which is exactly the naive rule that would have
  broken desktop.
- **One verification per request, not two.** `authorizeScope` calls
  `auth.api.verifyApiKey({ body: { key } })` with no `headers` and no
  `permissions` in the body. Passing `headers` would make Better Auth's own
  `enableSessionForAPIKeys` hook re-validate the SAME key a second time
  (it matches on `ctx.headers`), silently doubling the per-key rate-limit
  cost of every gated request — including every desktop sync push. Passing
  `permissions` would trigger the plugin's OWN internal check, which throws
  the identical error for "key doesn't exist" and "key lacks this
  permission," making 401 vs 403 impossible to tell apart from outside. See
  `auth-scopes.ts`'s doc comments for the full reasoning.

## Open questions for P5

- **Tokens live where?** Sessions are in D1; per-user data is in the DO. An
  API token is global-ish (it authenticates a user, then addresses their DO),
  so D1 alongside Better Auth's tables is the natural home. Better Auth has
  an API-key plugin — check whether it fits before hand-rolling.
- **Rate limits keyed on what?** A DO is single-threaded per user and already
  has a documented ~1,000 req/s soft ceiling, so per-user limiting has a
  natural home in the DO itself. Global limits do not.
- **Does the API expose `version`/`hlc`? Answered: no (A2, EI-227).**
  `/api/v1/*`'s responses run each Durable Object row through the entity's
  own Zod schema (`src/lib/schema.ts`) — `version` isn't a field either
  schema declares, so it's stripped by ordinary `.parse()` rather than
  hand-picked out. `hlc` never entered the shape at all; it lives in
  `field_clocks`, a table the read RPC (`UserDurableObject.listEntities()`)
  never touches.
- **Read path. Answered: yes (A2, EI-227).** `GET /api/v1/{todos,lists,
  labels,tabs}` shipped first, exactly as this section suggested — no
  version, no clocks, no push() involved at all.

## Before writing code

- `docs/SCHEMA-CHANGES.md` if any entity shape changes.
- `docs/SYNC.md` — especially "The one decision to understand before touching
  anything (D2)" and the P4 section.
- `.ai/lessons.md`.
- The rule that has held twice now: **do not change merge semantics to make a
  transport work.** REST is just another transport.
