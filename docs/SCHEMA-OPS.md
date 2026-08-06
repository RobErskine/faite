# Changing the schema: the procedure

**How to actually make a data-model change, locally and on production.**

`docs/SCHEMA-CHANGES.md` is the *why* — where a field lives, which changes are
dangerous, and what breaks when you get one wrong. This file is the *how*, and
deliberately repeats none of the reasoning. Same split as ARCHITECTURE §2.12
and `AUTH.md`.

---

## Two modes, and the one event that switches them

Faite has one user. That makes a whole class of problem disappear: if a schema
change is awkward, you can throw the data away and start again.

| | **Tinker mode** (now) | **Locked mode** |
|---|---|---|
| Adding a column | migration, or edit bootstrap + reset | migration, always |
| Renaming a field | rename it and reset | three-deploy ladder |
| Removing a kind | delete it and reset | ladder, gated on telemetry |
| Backfilling data | reset and reseed | a real backfill |
| `bootstrap.ts` | editable, deliberately | frozen |

**The switch is a single event: a second real account exists.** Not a date,
not a launch. The moment someone else has data, resets stop being available,
because you cannot reset data that isn't yours.

Everything in locked mode is written up under "Not built yet, and why" in
`docs/SCHEMA-CHANGES.md`. Don't build it early.

---

## The local loop

```bash
# 1. Change the model.
#    src/lib/schema.ts + src/server/db/user-schema.ts at minimum.

npm run schema:generate     # drizzle-kit, for the record in drizzle/user/
npm run schema:check        # THE decision point — see below

# 2a. If schema:check passes, you're done. Ship it.
# 2b. If it fails, it will tell you which of the two things to do.

npm run schema:reset        # only if you chose to reset
node scripts/sync-smoke/smoke.mjs
```

`npm run schema:check` is the whole safety net. It runs three assertions
(`src/server/db/schema-parity.test.ts`):

1. **Bootstrap fingerprint** — did `bootstrap.ts` change?
2. **Zod ↔ drizzle parity** — is a field declared on only one side?
3. **Ledger replay** — does running every migration in order actually produce
   the schema `user-schema.ts` describes?

> Assertion 3 replaces the old "hand-diff the generated SQL against
> `bootstrap.ts`" step. That existed because nothing checked it mechanically.
> Something does now, and it checks against the thing that actually runs — the
> ledger — rather than a generated file that is never loaded at runtime.

### The decision point

When the fingerprint assertion fails, you edited `bootstrap.ts`. Pick one, on
purpose:

**(a) Reset.** Valid only while every account is one you personally control.

```bash
npm run schema:snapshot     # accept the new v1 shape
npm run schema:reset        # every account you have
```

**(b) Add a migration.** The only option once anyone else has data.

```ts
// src/server/db/migrations.ts — append, never edit or renumber
{ id: 2, name: "todos-add-energy",
  statements: ["ALTER TABLE todos ADD COLUMN energy text"] },
```

Then revert `bootstrap.ts`. New accounts still get the column: a fresh DO has
an empty ledger, so `runUserDbMigrations` applies **every** migration on first
boot, not just migration 1.

Prefer nullable. A `NOT NULL` column needs a `DEFAULT` or the `ALTER` fails on
any table with rows, and `upsert.ts` has to synthesize placeholders for NOT
NULL columns missing from a partial create — those reach clients under
`FLOOR_HLC`, which is machinery worth staying out of.

---

## The production loop

```bash
git push                              # Workers Builds deploys main
npm run schema:info -- --prod         # confirm the ledger advanced
```

`schema:info` is the only way to see inside a live Durable Object. Its SQLite
has **no external query endpoint** — unlike D1, which the Cloudflare API can
query directly. Before this existed, the only confirmation available was
`wrangler tail` catching `[faite] applied user-db migrations: N` at the moment
a DO happened to cold-start.

Check the reported `schema version` matches the highest id in
`migrations.ts`, and that the column you added is listed under its table.

If it isn't: the DO hasn't cold-started yet. Migrations run in the constructor,
under `blockConcurrencyWhile`. Touch the account (open the app) and re-check.

### Before you rely on `--dry-run`

```bash
npx wrangler deploy --dry-run
```

This is the **only** local check that bundles `src/server/worker.ts`. Neither
`npm run build` nor `build:static` does — they are pure Next builds. Read the
warnings *below* the success lines.

### Resetting production

```bash
npm run schema:reset -- --prod        # types-to-confirm
```

Wipes your own board only — the DO is keyed `idFromName(session.user.id)`, so
there is no id to tamper with and no cross-account reach.

---

## Reset: what it actually does

Two halves, and a script can only do one of them.

**Server half** (`POST /api/sync/reset` → `UserDurableObject.wipe()`): closes
sockets, `deleteAll()`, re-runs the **migration ledger**. Not just
`BOOTSTRAP_STATEMENTS` — `deleteAll()` drops `schema_migrations` too, so
replaying only v1 would leave the object on the v1 schema while
`COLUMNS_BY_KIND` still names every column added since, and the next push
would throw `no such column`.

**Client half** (`resetAccountData()`, `src/lib/store/reset.ts`): clears the
pull cursor **first**, then the server, then Dexie, then reseeds and re-adopts.
The order is not stylistic — see the crash table in that file's doc comment.

### The trap that used to make this dangerous, and why it's gone

Wiping a DO resets `sync_meta.next_version` to 1. A device still holding a
cursor above that asks for "everything newer than 42" against a server whose
newest row is version 3, gets nothing, and concludes it is caught up —
**silently, on every device at once, with nothing in any log.**

`docs/SYNC.md` documented this as a trap to avoid by careful procedure. That
was never going to be enough: a terminal script cannot reach browser
localStorage.

It is now detected instead. Every row's `version` is allocated from
`sync_meta`, so it is strictly below `next_version` — which makes
`cursor >= next_version` **provably unreachable** unless storage was wiped.
`pull()` returns `reset: true` with `cursor: 0`, and the ordinary pull loop
re-reads from the beginning. A device left open heals within one sync cycle.

You still cannot get away with clearing a browser's IndexedDB by hand and
leaving `faite:sync-cursor:*` behind — that strands data locally, which is a
different problem. Use the in-app reset.

---

## Squashing the ledger

When the model finally settles, collapse the accumulated migrations back into
a clean v1:

1. Rewrite `bootstrap.ts` as the new v1 DDL.
2. Reset `USER_DB_MIGRATIONS` to a single `{id: 1, name: "initial-schema"}`.
3. `npm run schema:snapshot`.
4. `npm run schema:reset` — **every account**.

**Precondition: every account is one you personally control.** This destroys
data on any account you miss, and there is no recovery. It is the operation
that tinker mode exists to make available, and the second real account is what
ends it.

---

## Troubleshooting

None of these look like schema problems when they hit you. That is the point
of the table.

| Symptom | Cause | Fix |
|---|---|---|
| "My edits aren't saving on this device." Outbox grows, pulls work fine. | A column in `user-schema.ts` with no migration → `no such column` inside `push()`'s transaction. | Add the migration. `npm run schema:check` catches this before deploy. |
| Sync silently dead on **every** device at once. | A DO wiped while clients held higher cursors. | Fixed at the source — `pull()` now returns `reset: true`. If you see this on an old bundle, reload. |
| A new field never appears on the other device. | Missing from `user-schema.ts`, so `sanitizePatch` strips it. | Assertion 2 of `schema:check`. |
| Lists renamed to "Untitled", orphaned from their tab. | `FLOOR_HLC`'s populate-only rule violated. | `merge.ts` — read `docs/SYNC.md`'s "Known traps" before touching it. |
| Pushes 400; the outbox stops draining. | `SYNC_PROTOCOL_VERSION` bumped, older clients rejected. | Only bump for a genuinely incompatible envelope change. |
| An old client's edits vanish after a kind was removed. | `rejected: "unknown-kind"` means *delete locally* (`wire.ts`). | Keep a retired kind in `SYNC_KINDS` until no old clients remain. |
| Migration applied locally, not on prod. | The DO hasn't cold-started. | Open the app, then `npm run schema:info -- --prod`. |

## Verification bar

```bash
npm run typecheck
npx vitest run
npm run build && npm run build:static     # static is the P7 guard
npx wrangler deploy --dry-run             # only thing that bundles worker.ts
node scripts/sync-smoke/smoke.mjs         # after any user-do.ts / routes.ts change
```

`npm run lint` has one pre-existing failure in
`src/components/board/use-day-track.ts:156`, unrelated to any of this. That is
the known baseline; don't "fix" it.
