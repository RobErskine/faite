# P5 — documented API + tokens (EI-50), and Milestone A — Public API + MCP

**Status, updated through A5 (EI-230):** the token model
(`src/server/auth-tokens.ts`), the OpenAPI generator (A1, EI-226 —
`scripts/openapi/generate.ts`, two documents: `openapi/openapi.json`
internal, `openapi/v1.json` public), the durable server HLC (A4, EI-229 —
`UserDurableObject.nextServerHlc()`), enforced key scopes plus the
`/api/v1` read routes (A2, EI-227 — see "Key scopes" below), the Settings →
API Keys panel (A3, EI-228), and the first write endpoints —
`POST`/`PATCH /api/v1/todos` (A5, EI-230 — see "Parity gaps," below the Key
scopes section) — are all real and live. What's below this point is the
ORIGINAL P5 design doc, kept because its constraints still hold; treat
"open question" language in the historical sections as answered where a
later note says so, not as current uncertainty. Remaining open work: the
MCP server (A6, EI-52) and published public docs (A7, EI-231).

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

## Write endpoints and parity gaps (A5, EI-230)

`POST /api/v1/todos` and `PATCH /api/v1/todos/{id}` are the first writes:
`src/server/v1/routes.ts` → `src/server/service/todos.ts`'s
`createTodo`/`updateTodo` → `push()`, exactly the shape "A write is a push"
above describes. Five gaps between `src/lib/service/todos.ts`'s builders
and the client's real `store/repositories.ts` closed here:

- **`reminderTime`** now resolves the list's `defaultReminderPresetId` —
  `UserDurableObject.defaultReminderTimeForList()`, a new read RPC mirroring
  the client's own function, resolved by the route before calling
  `createTodo` (same pattern `nextTodoPosition()` already established).
- **`parentId`** is threaded through `CreateTodoInput` instead of
  hard-coded `null`.
- **A `todoEvent` "created"/"edited" row** is now built alongside every
  create/update and pushed in the SAME batch — `buildCreateTodoEntry` and
  `buildUpdateTodoEntry` both return `PushEntry[]`, not a single entry, for
  exactly this reason. Both entries must land in one `push()` call so the DO
  applies them in one `transactionSync`.
- **`updatedAt`** is now stamped on every `buildUpdateTodoEntry` patch,
  matching `mutate()`.
- **`position`** was already answered correctly by EI-186 (`nextTodoPosition()`,
  resolved at the call site) — A5 just extends the same pattern to
  `reminderTime` rather than inventing a second one.

**Two entries, two HLC stamps, one synchronous contract.** Each `PushEntry`
a builder returns calls `ctx.nextHlc()` separately, but `nextHlc` must stay
synchronous while `UserDurableObject.nextServerHlc()` (the durable mode
updates require, per "Key scopes" above) is an async RPC call.
`src/server/service/hlc.ts`'s `durableHlcQueue()` bridges this: it
pre-fetches N durable stamps up front, then hands them out one at a time
from a plain closure. Over-requesting (always 2, whether or not a
companion `todoEvent` ends up firing) is harmless — a wasted
`sync_meta.server_last_hlc` tick costs nothing.

## MCP server (A6, EI-52)

A remote MCP server at `/mcp` — deliberately not under `/api`, matching the
milestone doc's own design. First consumer: Pointer (EI-221).

`src/server/mcp/routes.ts` builds on `createMcpHandler` (`agents@0.21.0`'s
`agents/mcp`, wrapping `@modelcontextprotocol/server@2.0.0`), **not** the
older `McpAgent` class from the same SDK — that class is feature-frozen.
The handler is stateless per request: `resolveIdentity()` re-authenticates
the bearer token (or session cookie) on every call via `authorizeScope()`
(the same module A2 built), so a revoked key stops working on its very next
request — no separate revocation path to keep in sync. Tools wrap
`src/server/service/*`, never DO tables directly, same as the `/api/v1`
routes.

Registered: `list_todos`, `create_todo`, `complete_todo` tools, plus a
`summarize_backlog` prompt (a resource-only server without at least one
prompt fails to connect for clients that require the `prompts` capability).

Two SDK behaviors worth knowing before touching this file:

- **406 on a JSON-only `Accept` header.** The transport's pre-dispatch gate
  rejects any request whose `Accept` header omits `text/event-stream`, and
  `responseMode` cannot relax that gate — it only picks the response shape
  once a request is past it. `src/server/mcp/accept.ts`'s
  `withEventStreamAccept()` widens (never narrows) the header before the
  request reaches the SDK. Kept in its own dependency-free module, mirroring
  `hlc-core.ts`'s split from `hlc.ts`, because `routes.ts` transitively
  imports `agents/mcp`, which has a hard `cloudflare:workers` runtime
  dependency vitest's Node environment can't resolve.
- **SSE framing is not fully eliminated for "legacy"-era clients.** Setting
  `responseMode: "json"` had zero observed effect in live testing — every
  request negotiated back protocol version `2025-11-25` ("legacy" era, per
  the SDK's own era classification), and `responseMode` only applies to
  "modern" (2026-07-28) era traffic. Left at the default (`'auto'`). This is
  a known, documented residual risk, not something this ticket resolved —
  worth re-checking against Pointer specifically once it's a real client.

Never expose DO-internal fields (`version`, HLC stamps) through a tool
result — `todoOrNull()` runs every write tool's response through
`todoSchema.parse()` before returning it, same rule as `/api/v1`.

## Published docs (A7, EI-231)

`/docs` renders `openapi/v1.json` — the public document only, never
`openapi/openapi.json` — via Scalar's React component
(`@scalar/api-reference-react`). `src/components/docs/api-reference.tsx`
imports the spec at build time rather than fetching it at runtime: this app
also ships as a static Capacitor export with no server to fetch from, and a
build-time import means a spec that fails the CI drift check
(`openapi:generate && git diff --exit-code`) fails the build before a stale
copy could ever ship. The page itself skips `PageShell` — that component's
`max-w-2xl` reading-measure container is for prose, and Scalar renders its
own full-viewport layout that a narrow wrapper would clip.

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
