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
  └─ src/lib/auth-client.ts          createAuthClient(), baseURL = NEXT_PUBLIC_AUTH_URL || same origin
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
| `src/components/auth/` | `session-provider` (adoption + account-switch dialog), `welcome-dialog`, `signed-out-banner`, `oauth-buttons`, `auth-shell` |
| `src/app/{login,signup,forgot-password,reset-password,verify-email}/` | The pages |

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
npx wrangler d1 execute faite-auth --local  --file=drizzle/auth/<new>.sql
npx wrangler d1 execute faite-auth --remote --file=drizzle/auth/<new>.sql
```

Deploys do **not** run migrations. Applying only `--remote` breaks local dev;
only `--local` breaks production *after* the next deploy, not at build time.

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

- **Account deletion.** Better Auth can delete the D1 rows, but a user's
  Durable Object is addressed by `idFromName(userId)` and has no foreign key to
  anything — its storage would persist, unreachable and billed, and a
  re-registration on the same email would inherit the old board. Needs an
  explicit DO wipe. See `docs/SYNC.md`.
- **Magic link** (Linear EI-58) and **passkeys**.
- **Capacitor OAuth** (P7, EI-51) — a WebView needs custom-scheme deep links;
  `capacitor://localhost` is already in `trustedOrigins` so it is not designed
  out.
- **Authorization.** Nothing server-side gates data yet, because no server-side
  data exists. The client-side nudges secure nothing. Real enforcement arrives
  with P3's sync routes.
