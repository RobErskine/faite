# Auth — map and operations

Where every piece of auth lives, what happens on a request, and how to do the
things you will actually need to do.

> **This doc deliberately does not explain *why*.** Every architectural
> decision — auth in the Worker rather than a Next route, the ownerId adoption
> model, the ungated board and its nudges — lives in `docs/ARCHITECTURE.md`
> §2.12 and §2.13, with the reasoning intact. Duplicating that here would give
> us two copies to keep in sync, and the stale one always wins an argument it
> should lose. **Rationale → ARCHITECTURE. Setup → SETUP. Orientation and
> operations → here.**

Stack: **Better Auth 1.6.x** + Drizzle adapter on **Cloudflare D1**, with
**Cloudflare Email Service** for transactional mail.

---

## What a request actually does

```
browser
  └─ src/lib/auth-client.ts          createAuthClient(), baseURL = resolveAuthBaseURL() —
     │                               NEXT_PUBLIC_AUTH_URL, or same origin. A localhost
     │                               value is DISCARDED on a real domain; see below.
       │  POST /api/auth/sign-in/email
       ▼
  src/server/worker.ts               intercepts /api/auth/* BEFORE the OpenNext handler
       │                             (a Next route handler would break `output: export`)
       ▼
  src/server/auth.ts                 createAuth(env, request) — built fresh per request,
       │                             because D1/EMAIL bindings only exist inside fetch()
       ├─ baseURL       ← new URL(request.url).origin      (never hardcoded — see below)
       ├─ database      ← drizzleAdapter(drizzle(env.AUTH_DB))
       ├─ schema        ← src/server/auth-schema.ts        (generated, do not hand-edit)
       └─ email         ← src/server/email.ts → env.EMAIL
       ▼
  D1 `faite-auth`: user / session / account / verification
```

Back on the client, the session drives three things, all of which read
**local** state first so they behave correctly offline:

| Concern | Module |
|---|---|
| Should we nudge them to sign up? | `src/lib/auth-nudge.ts` |
| Whose name/avatar do we show? | `src/lib/use-identity.ts` → `src/lib/profile.ts` |
| Whose data is this device's? | `src/lib/store/owner.ts`, `adopt-owner.ts` |

---

## File map

### Server

| File | Role |
|---|---|
| `src/server/auth.ts` | `createAuth(env, request)` — the whole Better Auth config |
| `src/server/worker.ts` | Mounts `/api/auth/*` ahead of OpenNext |
| `src/server/auth-schema.ts` | **Generated** by `npm run auth:schema`. Never hand-edit |
| `src/server/auth-cli.ts` | Dev-only `auth` export so the CLI can introspect config. Not imported by the worker |
| `src/server/email.ts` | `sendEmail()` over the `EMAIL` binding, with the log-instead-of-throw fallbacks |
| `drizzle/auth/*.sql` | Migrations. Apply with `--local` **and** `--remote` |

### Client

| File | Role |
|---|---|
| `src/lib/auth-client.ts` | `createAuthClient` + `useSession`/`signIn`/`signUp`/`signOut` |
| `src/lib/auth-nudge.ts` | `useShouldShowAuthNudges()` — offline-safe "are they signed out" |
| `src/lib/use-identity.ts` | Session name/email for the avatar |
| `src/lib/onboarding.ts` | Welcome-dialog and banner dismissal flags |
| `src/lib/store/owner.ts` | `getCurrentOwnerId()`, the bound-owner marker |
| `src/lib/store/adopt-owner.ts` | One-time local→account `ownerId` backfill |
| `src/lib/store/clear-device.ts` | `clearDeviceData()` — the sign-out wipe |
| `src/components/auth/` | `session-provider` (adoption + account-switch dialog), `welcome-dialog`, `signed-out-banner`, `oauth-buttons`, `auth-shell` |
| `src/app/{login,signup,forgot-password,reset-password,verify-email}/` | The pages |

---

## What sign-out does

Sign-out is a **local** operation. It ends the session and erases this device.
It never contacts the Durable Object: the account keeps its board server-side,
so signing back in pulls the whole thing down again.

The order is load-bearing, and lives in `app-header.tsx`'s `handleSignOut`:

1. **`flushOutbox()`** (`components/sync/sync-provider.tsx`), while the cookie
   is still valid. Returns how many entries are still un-pushed; anything above
   0 raises a confirmation, because the wipe below would destroy that work with
   no way back. A fully-synced sign-out is silent.
2. **Clear the desktop keychain token** (`isDesktopShell()` only) — it lives
   outside the cookie `signOut()` clears, and would keep authenticating.
3. **`signOut()`** — *before* the wipe. Wiping first leaves a live session
   against a cursor of 0, and the mounted sync engine's next tick pulls the
   entire board straight back down.
4. **`clearDeviceData()`** (`lib/store/clear-device.ts`) — cursors first, then
   the owner binding, then the two local-only content keys, then the tables in
   one transaction. See that file's comment for the crash table.
5. **`window.location.replace("/")`** — a hard navigation, so no React tree,
   `useLiveQuery` cache or undo stack survives holding the old user's values.
   App-shell builds (`NEXT_PUBLIC_APP_SHELL=1` — Tauri and Capacitor) go to
   `signed-out.html` instead, because `/` is only a redirect stub back to
   `/board` there. See `docs/DESKTOP.md` §11.

**The exception:** if `faite:bound-owner-id` is not the signed-in user — the
state `session-provider.tsx`'s "switch accounts?" dialog creates — sign-out
does none of this. It ends the session and stops. Flushing would push one
account's rows into another's DO, and wiping would destroy the bound account's
board to fix a different account's mistake.

**Kept** across a sign-out, deliberately: `faite:last-hlc` (monotone clock),
`faite:node-id` (device identity), `faite:theme` / `faite:font` (pre-paint
prefs — clearing them is a visible flash), the onboarding dismissal flags, and
`faite:outbox-hlc-normalized:v1`. `clear-device.test.ts` asserts each one.

### Smoke test

1. Sign in, add a few todos, wait for sync to settle.
2. Open `/board` in a second tab.
3. Log out in tab 1 → lands on `/`, the marketing page, and is *not* bounced
   back to `/board`.
4. DevTools → Application: the `faite` IndexedDB is empty; no
   `faite:bound-owner-id`, no `faite:sync-cursor:*`, no `faite:saved-views`.
5. Tab 2 shows an empty board and does not repopulate after 60s.
6. Open `/board` → a fresh seeded board, none of the old todos.
7. Sign back in → the original board pulls down from the DO intact.
8. Offline case: DevTools → Network → Offline, edit a todo, Log out → the
   confirmation appears with the pending count; "Stay signed in" leaves
   everything intact.

---

## Common tasks

### Add an OAuth provider

1. Register the app with the provider; callback is
   `https://myfaite.app/api/auth/callback/<provider>`.
2. `npx wrangler secret put <PROVIDER>_CLIENT_ID` (and `_SECRET`); mirror into
   `.dev.vars`.
3. Add to `socialProviders` in `src/server/auth.ts`.
4. Add a button in `src/components/auth/oauth-buttons.tsx`.
5. `npm run cf-typegen` so `CloudflareEnv` picks up the new vars.

No schema change — providers share the `account` table, keyed by `provider_id`.

### Change auth config (plugins, fields, providers)

Regenerate the schema and migration, then apply to **both** databases:

```bash
npm run auth:schema                                            # → auth-schema.ts + SQL
npm run auth:migrate:local
npm run auth:migrate:remote
```

(`wrangler d1 migrations apply AUTH_DB`, pointed at `./drizzle/auth` via
`migrations_dir` in `wrangler.jsonc` — replaces the old hand-rolled
`wrangler d1 execute --file=drizzle/auth/<new>.sql` two-liner. Same effect,
but idempotent: it tracks applied migrations in a `d1_migrations` bookkeeping
table and only runs what's new, so re-running either command is a safe no-op.
A migration that fails rolls back and exits non-zero instead of silently
leaving the DB half-migrated.)

`npm run deploy` (the one Rob actually runs) does **not** run migrations —
that's deliberate; see below. `npm run deploy:with-migrations` (EI-79) runs
`auth:migrate:remote` then `deploy`, and is **not** wired into any deploy
path (`npm run deploy`, CI, or Cloudflare Workers Builds) — it exists so the
step can be reviewed and opted into consciously, not so it runs tonight.

**Before ever using `auth:migrate:remote` / `deploy:with-migrations` for
real: the production `faite-auth` D1 database has no bookkeeping history.**
Every migration to date was applied by hand with `wrangler d1 execute
--file`, which doesn't write to the `d1_migrations` table `migrations
apply` uses to know what's already run. The first `--remote` run will see
an empty bookkeeping table, conclude `0000_amused_ink.sql` is unapplied, and
try to `CREATE TABLE account` etc. against tables that already exist —
confirmed locally (see EI-79 PR) that this fails loudly (exit 1, migration
rolled back, nothing left half-applied) rather than corrupting anything, but
it **will** block a deploy that depends on it until production's
`d1_migrations` table is manually seeded to mark `0000_amused_ink.sql` as
already applied. Do that once, deliberately, before wiring this in — don't
let a deploy discover it.

Applying only `--remote` breaks local dev; only `--local` breaks production
*after* the next deploy, not at build time.

### Inspect or fix users

Production, via the Cloudflare API (no app involvement):

```
POST /accounts/{account_id}/d1/database/d0be89ae-e45d-44f4-804f-7f88a2f169fa/query
{ "sql": "SELECT email, email_verified FROM user;" }
```

Local:

```bash
npx wrangler d1 execute faite-auth --local --command "SELECT email, email_verified FROM user;"
```

Deleting a user: remove `session` and `account` rows **first**, then `user`.
SQLite only honours `ON DELETE CASCADE` when `PRAGMA foreign_keys` is on, which
is not guaranteed here — deleting in dependency order is correct either way.

---

## Debugging

### `403` on a `/api/auth/*` call

Two very different causes, and the status code alone does not distinguish them.
**Read the JSON body** — it carries a `code`:

```bash
curl -s -i -X POST http://localhost:8787/api/auth/sign-in/email \
  -H "Content-Type: application/json" -H "Origin: http://localhost:8787" \
  -d '{"email":"you@example.com","password":"..."}'
```

| Body code | Meaning |
|---|---|
| `EMAIL_NOT_VERIFIED` | Real, and only possible where verification is required (not localhost) |
| origin/CSRF error | `baseURL` disagrees with the request's origin |

A useful discriminator: **sign-*up* returning 403 is never a verification
problem** — an unverified signup returns `200` with a "check your email" body.
A 403 on signup points at the origin check.

### Auth "mysteriously broken" on a branch preview

`baseURL` is derived from the request origin precisely so previews work. If
something hardcodes a host, every `*-faite.bfmw-dev.workers.dev` deploy breaks.
OAuth *will* still fail on previews — the redirect URI is registered with the
provider and only matches production. That is expected; email/password works.

### A local change appears to do nothing

`npm run preview` builds **once at startup**. Restart it. This has twice looked
like a persistent bug.

---

## Gotchas particular to this setup

- **`createAuth` must be called per request.** D1 and Email bindings only exist
  inside `fetch()`; a module-level singleton fails at runtime.
- **Never hardcode `baseURL`.** Better Auth builds its origin check and every
  callback URL from it. Deriving it from `request.url` is what makes
  production, previews, and both local ports work simultaneously — and it does
  not weaken CSRF, since browsers set `Origin` from the page's real origin.
- **`NEXT_PUBLIC_AUTH_URL` must never live in `.env.local`.** It is inlined into
  the client bundle at BUILD time, and Next loads `.env.local` in every
  environment — so a dev override there ships to production, and the live login
  page posts to `http://localhost:8787`. This happened: sign-in on
  https://myfaite.app failed a CORS preflight, with the console reporting
  `Access-Control-Allow-Origin: 'http://localhost:8787'`, which reads like a
  server misconfiguration and is actually a build-time leak. `.env.production`
  does not help — `.env.local` outranks it. The override lives in the `dev` script
  now, and `resolveAuthBaseURL()` discards a localhost target on a real domain as a
  backstop. **If you see auth requests going to localhost from a deployed page,
  this is the cause, and the fix is a rebuild, not an env var on the worker.**
- **OAuth users arrive `email_verified: 1`; `credential` users do not.** Read
  the field; never infer verification from the provider.
- **Better Auth links providers that share a verified email** into one user id
  with multiple `account` rows. `rob@roberskine.com` has both `github` and
  `credential`.
- **Turning on verification strands existing unverified users** — they can no
  longer sign in. Verify or delete those rows.
- **Verification is off on localhost** and on everywhere else, because the
  `send_email` binding cannot deliver under local `wrangler dev`. Requiring it
  locally is a deadlock with no recovery path.
- **A GitHub OAuth App accepts exactly one callback URL.** Local GitHub sign-in
  needs a second app. Google allows several redirect URIs on one client.
- **`src/server` is not typechecked by the Next tsconfig.** Run
  `npm run typecheck` (both projects) and `npx wrangler deploy --dry-run` — the
  latter is the only check that actually bundles worker code.

---

## Not built

- **Account deletion.** Better Auth's `user.deleteUser.afterDelete` now calls
  `UserDurableObject.wipe()`, closing the orphaned-DO trap this section used to
  describe. **Still open: unverified end-to-end** — a CSRF origin check
  blocked local testing of the full delete → wipe round trip. See
  `docs/SYNC.md:281-291` and Linear EI-80.
- **Magic link** (Linear EI-66) and **passkeys**. Google OAuth shipped in P2
  (EI-58).
- **Capacitor OAuth** (P7, EI-51) — a WebView needs custom-scheme deep links;
  `capacitor://localhost` is already in `trustedOrigins` so it is not designed
  out.
- **Authorization.** P3's sync routes shipped and are the real enforcement
  point: `/api/sync/*` requires an authenticated session, and each user's
  Durable Object is addressed by `idFromName(session.user.id)`, so a request
  can only ever read or write its own account's data.
