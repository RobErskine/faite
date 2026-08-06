# Changing the data shape

**Read this before adding, renaming, or removing a field on todos, lists,
labels, projects, tabs, or settings — or before adding a new entity kind.**

A field in Faite is not declared in one place. It is declared in four, and
three *more* files derive behaviour from those declarations. Sync then
replicates it to a per-user Durable Object that has its own storage, its own
schema, and its own migration story. Getting one of the seven wrong usually
does not produce a type error; it produces a runtime failure on one device,
often only for accounts that already have data.

This document is the checklist. `src/server/db/migrations.ts` is the
mechanism. **`docs/SCHEMA-OPS.md` is the procedure** — how to actually make a
change locally and on production, which commands to run, and how to read the
failures. This file deliberately does not repeat it.

Two things now check the checklist for you, so read this to understand *why*
rather than to remember steps:

- **`npm run schema:check`** — `src/server/db/schema-parity.test.ts` replays
  the migration ledger and asserts the result is exactly what
  `user-schema.ts` declares, cross-checks Zod against Drizzle, and fingerprints
  `bootstrap.ts`. The failure that used to reach production silently now fails
  in CI.
- **`npm run schema:info`** — the schema state of a live Durable Object, which
  has no other query endpoint.

---

## The one thing that will bite you

**`bootstrap.ts` cannot deliver a new column to an existing account.**

The DO's storage is created by `CREATE TABLE IF NOT EXISTS` statements run in
the constructor. On a table that already exists, that is a no-op — so adding a
column to `user-schema.ts` gives it to *new* accounts and silently never gives
it to anyone who already has data.

What happens next is not a graceful degradation:

1. `COLUMNS_BY_KIND` (derived from `user-schema.ts`) starts allowing the field.
2. `sanitizePatch` lets it through.
3. `insertRow`/`updateRow` name that column in SQL.
4. The first push carrying it throws `no such column` **inside `push()`'s
   `transactionSync`**.
5. Pushes fail from then on. Pulls keep working.

So it presents as *"my edits aren't saving on this device"* — an
outbox that grows forever, sync apparently half-alive — rather than as
anything resembling a migration problem. On production that is your own
account, and the fix requires a deploy.

**This is why `src/server/db/migrations.ts` exists. Use it.** Adding a column
without a migration entry is the single easiest way to break sync.

---

## Where a field lives

| # | File | What it declares | Miss it and… |
|---|---|---|---|
| 1 | `src/lib/schema.ts` | Zod type + `EntityKind` | Type errors; caught at build |
| 2 | `src/lib/store/db.ts` | Dexie **indexes only** | Nothing, unless you need to query by it |
| 3 | `src/server/db/user-schema.ts` | Drizzle schema for DO SQLite | Field is stripped by `sanitizePatch`, never syncs |
| 4 | `src/server/db/bootstrap.ts` | Hand-written DDL for **new** DOs | New accounts lack the column |
| 5 | **`src/server/db/migrations.ts`** | Ledgered `ALTER` for **existing** DOs | **Push breaks permanently for anyone with data** |
| 6 | `src/server/sync/columns.ts` | Derived: whitelist + JS↔SQL coercion | Booleans/JSON round-trip wrong |
| 7 | `src/lib/sync/wire.ts` | `SYNC_KINDS`, `SETTINGS_SYNCED_FIELDS`, `SERVER_ONLY_FIELDS` | Field never crosses the wire, or crosses when it shouldn't |

Files 6 and 7 are mostly derived from 3, but not entirely — `columns.ts`
carries an explicit `dataType` per column, and settings has its own allow-list.

---

## Recipe: add a nullable field (the common case)

This is safe and you should reach for it by default.

1. **`src/lib/schema.ts`** — add to the Zod object, optional or nullable.
2. **`src/server/db/user-schema.ts`** — add the Drizzle column, **nullable**.
3. **`src/server/db/bootstrap.ts`** — add it to that table's `CREATE TABLE`,
   so new accounts get it directly.
4. **`src/server/db/migrations.ts`** — append a migration. **Never edit or
   renumber an existing one**; it has already run on real objects and will
   not run again.
   ```ts
   { id: 2, name: "todos-add-energy",
     statements: ["ALTER TABLE todos ADD COLUMN energy text"] },
   ```
5. **`npm run schema:generate`**, for the record in `drizzle/user/`. The
   generated file is not loaded at runtime (no filesystem in a Workers
   bundle).

   The hand-diff this step used to ask for is gone: `npm run schema:check`
   does it mechanically, and checks against the **migration ledger** — the
   thing that actually runs — rather than a generated file that never does.
6. **Dexie** — only if you need to *query* by the field. Adding an unindexed
   field needs no version bump; Dexie stores whole objects and `.stores()`
   declares indexes only. If you do need an index, bump to
   `this.version(2).stores({...})`.
7. Write through `mutate()` like everything else (ARCHITECTURE §2.5).

**Verify:** `npx vitest run && npm run typecheck && npx wrangler deploy --dry-run`,
then the live check below.

### Prefer nullable over NOT NULL

A `NOT NULL` column must be added with a `DEFAULT`, or the `ALTER` fails on
any table with existing rows. Worse, `upsert.ts` has to synthesize a
placeholder for every NOT NULL column missing from a partial create, and
those reach clients under `FLOOR_HLC` — the sentinel that caused the P3
data-loss incident. `FLOOR_HLC` is populate-only now and that carve-out is
tested, but there is no reason to walk back into that machinery for a field
that could simply be nullable.

---

## Recipe: add a new entity kind

More involved; the kind has to be threaded through the sync machinery.

1. `EntityKind` in `src/lib/schema.ts`, plus the Zod type.
2. `SYNC_KINDS` in `src/lib/sync/wire.ts`.
3. Dexie table in `db.ts` (this **does** need a `version(n)` bump).
4. `user-schema.ts` + `bootstrap.ts` + a migration (`CREATE TABLE IF NOT
   EXISTS` — note this is the one change the old bootstrap mechanism *could*
   have delivered on its own, but add the migration anyway for the record).
5. `TABLE_NAME_BY_KIND` and `COLUMNS_BY_KIND` in `columns.ts`.
6. `mutate.ts`'s table dispatch and `apply-remote.ts`'s dispatch.
7. `hydrate.ts` if remote creates need defaulting.

**Cost to know about:** `pull()` runs one query per kind, so the worst-case id
count feeding `readFieldClocksBulk` grows by `limit` per kind. That is already
chunked (`sql-limits.ts`), and `sql-limits.test.ts` pins the arithmetic — a
seventh kind will fail a test rather than production if it ever exceeds the
100-bound-parameter ceiling.

---

## The dangerous changes

### Renaming a field — don't, in one step

Field-level LWW keys on the **field name**. Rename `foo` → `bar` and:

- `field_clocks` holds independent rows for `foo` and `bar`
- they can never conflict, because they are different fields
- a device on the old bundle keeps writing `foo`; a device on the new one
  writes `bar`
- both values persist, forever, and the "rename" is silently a fork

Do it in three deploys instead: **add `bar`** → **backfill and dual-write**
→ **drop `foo`** once no client writes it.

### Removing a field — safe, but on a delay

`sanitizePatch` drops unknown fields, so a stale client still pushing the
removed field is ignored rather than erroring. That is graceful. But leave the
column in place for a deploy window before dropping it: SQLite's `DROP COLUMN`
is fine, while a client still *reading* it is not.

Stale `field_clocks` rows for a dead field are harmless — nothing reads a
clock for a column that no longer exists.

### Deployment skew is the constraint behind all of this

The client is a **cached static bundle**. After any deploy, open tabs keep
running the old code until someone reloads. Every schema change therefore has
to be forward- and backward-compatible for at least one deploy window.

**Additive-only is the rule that makes that automatic.**

### Changing the wire protocol

`SYNC_PROTOCOL_VERSION` is enforced as `z.literal` on push. Bumping it makes
the server reject every older client outright — their pushes 400 and their
outbox stops draining (it does not lose data, but sync wedges until reload).
Only bump for a genuinely incompatible envelope change, and expect to support
both versions across the transition.

---

## Resetting is now supported — see `docs/SCHEMA-OPS.md`

This section used to say **never reset a Durable Object**, because
`ctx.storage.deleteAll()` resets `sync_meta.next_version` to 1 and every
client's persisted `faite:sync-cursor:*` then sat *above* every new version,
so sync went silently dead on every device at once.

That failure is now detected rather than avoided. Every row's `version` is
allocated below `sync_meta.next_version`, so a cursor at or above it is
**provably** only reachable after a wipe — `pull()` returns `reset: true` and
the client re-reads from 0. `npm run schema:reset` is a supported operation,
and `resetAccountData()` (`src/lib/store/reset.ts`) does both halves in the
correct order.

The remaining rule still holds: **do not clear a browser's IndexedDB by hand
without also clearing `faite:sync-cursor:*`.** That strands local data, which
is a different problem the server cannot see.

## Not built yet, and why

Deliberately absent while Faite has one user. Each has a trigger, not a date.

| Missing | Build it when | Why not now |
|---|---|---|
| **Client backfill ledger** — ordered, idempotent one-time migrations writing through `mutate()` | the first schema change where losing the data is unacceptable | a reset is cheaper and there is nothing to preserve. Note `normalize-outbox.ts` is the existing one-off to fold in when this arrives |
| **Retirement ladder** (`RETIRED_KINDS`, three-deploy dance for removing a field or kind) | **a second real account exists** | with one user there is no deploy skew that matters — you control every open tab |
| **Client bundle stamp** in the push envelope | you need to *observe* when the old-bundle window closed | same trigger; without a second user there is nothing to observe |

**The trap to remember when the ladder does get built:** removing a kind from
`SYNC_KINDS` makes an older client's push return `rejected: "unknown-kind"`,
which `wire.ts` defines as *"Permanently unacceptable. Delete these locally."*
That is silent data loss for every tab still on the previous bundle. A retired
kind must stay in `SYNC_KINDS` until no old clients remain.

A backfill written server-side, inside a migration, is the other thing to get
right when the time comes: an `UPDATE` there allocates no `version` (so
`pull()`'s `version > cursor` never returns the row) and writes no
`field_clocks` entry (so it arrives under `FLOOR_HLC`, which `merge.ts` makes
populate-only). It would be invisible. Prefer a client backfill through
`mutate()`, which gets a real HLC and ordinary LWW for free — and which is the
only kind that works for a signed-out user, who has no Durable Object at all.

---

## Verifying a schema change

```bash
npm run typecheck                  # both projects
npx vitest run
npx wrangler deploy --dry-run      # the only thing that bundles worker.ts
```

Then prove the migration against a **real** Durable Object that **already has
data** — a fresh one proves nothing, because `CREATE TABLE` would have covered
it anyway:

```bash
npx wrangler dev --port 8790       # check the port is free first
# See scripts/sync-smoke/README.md for account setup.

# 1. BEFORE adding the migration: push a row, so the DO exists with real data.
# 2. Add the column + migration.
# 3. Restart wrangler dev  (the ledger only runs in the DO constructor,
#    which re-runs on cold start).
# 4. Push a row carrying the new field. This is the step that used to throw
#    `no such column`.
# 5. Pull it back and confirm it round-trips, and that pre-migration rows
#    are intact.
```

The worker log prints `[faite] applied user-db migrations: N` when the ledger
advances. Silence on a restart means everything was already applied.

Finally, re-run `scripts/sync-smoke/` — `smoke.mjs` and `broadcast.mjs` are
fast, and `hibernate.mjs` is the only thing that exercises a DO waking up
against your new schema.
