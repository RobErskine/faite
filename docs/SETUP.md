# Faite — one-time setup runbook

Work top to bottom — **order matters**, because §2 and §4 both bake
`myfaite.app` into URLs that are annoying to re-register.

## Status

**Setup is complete.** Kept as the record of how it was done and why, and as
the runbook for standing this up again in a second environment.

| § | Step | State |
|---|---|---|
| 0 | wrangler token scopes | ✅ done |
| 1 | `myfaite.app` on Cloudflare DNS | ✅ was already Active |
| 2 | Worker on the custom domain | ✅ live at https://myfaite.app |
| 3 | Cloudflare Email Sending | ✅ enabled, real messages delivering |
| 4 | GitHub + Google OAuth apps | ✅ both registered |
| 5 | Production secrets | ✅ all five set |
| 6 | Email verification flag | ✅ `true` as of `c48f7fe` |
| 7 | Smoke test | ✅ verified in the UI **and** against D1 |
| 8 | CI/CD | ✅ deploys on `main`; branch previews enabled |

Verified against production D1, not just the UI: GitHub, Google, and
email/password each produced the expected `account.provider_id`; OAuth users
arrive `email_verified: 1` while `credential` users do not; and the
signup → email → verify → sign-in loop leaves a verified user row, a consumed
`verification` token, and a live session.

**Known consequence of turning §6 on:** any `credential` user created *before*
the flip still has `email_verified: 0` and can no longer sign in. Verify or
delete those rows.

---

## 0. Refresh your wrangler token first

`wrangler whoami` reports **missing** `email_sending:write` and
`email_routing:write` scopes. Everything in §3 fails on a permissions error
until this is done, in a way that reads like a Cloudflare bug rather than a
local auth problem:

```bash
npx wrangler login
npx wrangler whoami          # the missing-scopes warning should be gone
```

---

## 1. Get `myfaite.app` onto Cloudflare DNS

Owning the domain is not enough — the **zone** has to live on your Cloudflare
account before Email Sending or a custom domain will work.

*Bought through Cloudflare Registrar?* Already done, skip to §2.

Otherwise: dashboard → **Add a site** → `myfaite.app` → Free plan → copy the
two nameservers it gives you → replace the registrar's nameservers with those
→ wait for the zone to read **Active** (usually minutes, occasionally up to
24h).

```bash
dig +short NS myfaite.app     # expect *.ns.cloudflare.com
```

---

## 2. Point the Worker at the domain

Add this to `wrangler.jsonc` at the top level, beside `"main"`. A custom domain
creates its own DNS record — do **not** hand-add an A or CNAME:

```jsonc
"routes": [{ "pattern": "myfaite.app", "custom_domain": true }],
"workers_dev": true,
"preview_urls": true,
```

> ⚠️ **Declaring a route silently disables both `workers_dev` and
> `preview_urls`.** Wrangler only mentions it in a warning at the very end of a
> deploy, well after the success line. Two consequences, both found the hard
> way:
>
> - `faite.bfmw-dev.workers.dev` started returning **404** the moment the
>   custom domain went live.
> - **Preview URLs went off too**, which quietly broke the per-branch previews
>   in §8 — they are only ever served on the workers.dev subdomain, so
>   `workers_dev: false` disables them no matter what `preview_urls` says.
>
> Both flags are therefore `true`. This was `false` through P0–P4 on the
> reasoning that "`myfaite.app` is the only origin auth works on" — stale since
> `createAuth(env, request)` started deriving `baseURL` from the request origin.
> See the comment block in `wrangler.jsonc` for the full account.

```bash
npm run deploy
curl -sI https://myfaite.app | head -1     # expect HTTP/2 200
```

Verify with a real request, and **poll before diagnosing** — per
`.ai/lessons.md`, a 404 immediately after a deploy was propagation lag, not a
broken worker.

> **Why this comes before §4:** an OAuth app accepts a fixed callback URL, and
> that has to be the domain users actually land on. Register the callbacks
> against the workers.dev URL and you will be redoing them. (`src/server/auth.ts`
> does *not* hardcode `baseURL` — `createAuth` derives it per request, so the
> API itself works on any origin. The OAuth providers are the fixed part.)

---

## 3. Turn on Cloudflare Email Sending

Requires §1 to be Active. Powers password reset and email verification.

```bash
npx wrangler email sending enable myfaite.app   # auto-adds SPF + DKIM
npx wrangler email sending dns get myfaite.app  # 5–15 min to propagate
```

No code change needed. The `send_email` binding is already in `wrangler.jsonc`
(restricted to `noreply@myfaite.app`), and `src/server/email.ts` already wraps
it — until this step lands it catches `E_SENDER_NOT_VERIFIED` and logs the
reset/verify link to the worker console instead of throwing.

`enable` creates all the DNS records for you — 3 MX on `cf-bounce`, plus SPF,
DKIM, and a `DMARC p=reject`. Nothing to add by hand.

Send yourself a test:

```bash
npx wrangler email sending send --from "noreply@myfaite.app" \
  --to "roberskine13@gmail.com" --subject "Faite email test" \
  --text "If you got this, Email Sending works."
```

> **If that first send fails with `sending_disabled [code: 10203]`, wait a
> minute and retry — don't go debugging.** It happened here 30 seconds after
> `enable` and succeeded on the retry with no other change. The account-level
> quota takes a moment to propagate after the first domain is onboarded.
> `wrangler email sending dns get` listing records is *not* proof the service
> is ready; check `GET /accounts/{id}/email/sending/limits` returns a real
> quota (1000/day) rather than `null`.

---

## 3b. Turn on Email Routing for `in.myfaite.app` (EI-186)

Separate from §3, and in the opposite direction: §3 is **sending**, this is
**receiving**. Needed only for the email-capture feature.

Nav is **account-level**, not per-zone: **Compute → Email Service → Email
Routing**, then pick the domain with the selector at the top. That selector is
the thing to watch — see the trap below.

1. Domain selector → `myfaite.app` → **Settings → Subdomains** → add
   `in.myfaite.app`. Cloudflare writes that subdomain its own MX/SPF records.
2. **Switch the domain selector to `in.myfaite.app`** → **Routing rules** →
   turn **Catch-all** on → Action **Send to a Worker** → `faite` → Save.
3. **Switch back to `myfaite.app`** and leave *its* Catch-all **Disabled**.

Do step 2 before step 3, so there is never a window with no working path.

### The trap: which domain is the catch-all on?

**Routing rules are per-domain, and a subdomain is a separate domain.** The
rules list defaults to an "All domains" filter, where a catch-all on the apex
and a catch-all on `in.myfaite.app` look identical — same row, same
`Catch-all` label, same Worker.

Get this wrong and **the feature fails silently.** Mail to
`<localpart>@in.myfaite.app` matches no rule on that domain, so Email Routing
rejects it at the rule-match stage and **the Worker is never invoked** —
nothing in `wrangler tail`, nothing in the app's logs, no `bad-recipient`. Just
a bounce to the sender and silence everywhere you would think to look.

To check unambiguously, set the selector to `in.myfaite.app` and confirm the
Catch-all row is there and Active. The **Activity log** tab is the other
tell: a message that never reached the Worker shows as **Dropped**, whereas a
handled one shows **Handled**.

Note **Catch-all is a toggle at the top of the Routing rules page**, not
something you add with "Create routing rule".

### Why the apex catch-all stays Disabled

Not Drop, and not Send to a Worker:

- **Disabled** → unknown apex recipients get a clean 550, and `rob@myfaite.app`
  stays available as a literal rule later.
- **Drop** → a silent blackhole; you would never learn mail to `rob@` was being
  eaten.
- **Send to a Worker** → the ingest Worker hard-550s `postmaster@`, `abuse@`,
  and any bounce addressed to `noreply@myfaite.app`. Hard-rejecting
  `postmaster@`/`abuse@` on a domain you *send* from is a deliverability
  liability.

Want `rob@myfaite.app`? Domain selector → `myfaite.app` → Create routing rule →
pattern `rob` → **Send to an email** → your Gmail. Free, no Worker, and it
needs the destination address verified by a confirmation email first.

### What this does to the apex

Onboarding the zone **does** put Email Routing MX/SPF/DKIM on the apex and
**locks** them — `dig MX myfaite.app` now returns `route1/2/3.mx.cloudflare.net`.
The apex is *recoverable*, not *untouched*: Email Routing supports **Unlock**
on those records so another provider can be swapped in later while
`in.myfaite.app` keeps routing here (limit: 30 domains/subdomains per zone).
Cloudflare's guidance is to unlock and add the new provider's records **before**
disabling Email Routing, so mail flow is never interrupted.

> **The SPF merge is the part that will bite.** The apex already publishes
> `v=spf1 include:_spf.mx.cloudflare.net ~all` and `_dmarc.myfaite.app` is
> `p=reject` (both from §3, Email **Sending**). When you point the apex at
> Google Workspace you must **merge into the single existing SPF TXT**:
>
> ```
> v=spf1 include:_spf.google.com include:_spf.mx.cloudflare.net ~all
> ```
>
> Two SPF TXT records on one name is a permerror, and with `p=reject` already
> published that silently destroys every password-reset and verification email
> the app sends. One record, both includes.

### Not in `wrangler.jsonc`

Routing rules are zone configuration — dashboard or the Email Routing REST API.
The only config change receiving needed was the `EMAIL_INGEST_DOMAIN` var.
(The API exposes `source: "api" | "wrangler"` on rules, hinting that
config-managed routing exists, but wrangler 4.118.0's config schema has no
`email_routing` key. Worth revisiting on a later wrangler.)

**Deploy with `npm run deploy:with-migrations`**, not `npm run deploy`:
`email_ingest` is a new D1 table and Workers Builds does not run migrations.

Testing this without touching DNS at all: `scripts/email-smoke/README.md`.
Full rationale and the privacy invariants: `docs/EMAIL-INGEST.md`.

---

## 4. Register the OAuth apps

### GitHub

<https://github.com/settings/developers> → **New OAuth App**

| Field | Value |
|---|---|
| Application name | Faite |
| Homepage URL | `https://myfaite.app` |
| Authorization callback URL | `https://myfaite.app/api/auth/callback/github` |

> ⚠️ **A GitHub OAuth App accepts exactly one callback URL.** If you also want
> GitHub sign-in working against localhost, register a *second* app
> ("Faite (local)") pointing at
> `http://localhost:8787/api/auth/callback/github` and swap the values in
> `.dev.vars`. Google has no such limit.

### Google

<https://console.cloud.google.com> → new project ("Faite")

1. **APIs & Services → OAuth consent screen** → External. Fill in app name,
   support email, developer email. While the app is in *Testing*, only
   addresses listed under **Test users** can sign in — add your own.
2. **Credentials → Create credentials → OAuth client ID → Web application**

| Field | Value |
|---|---|
| Authorized JavaScript origins | `https://myfaite.app` |
| Authorized redirect URIs | `https://myfaite.app/api/auth/callback/google` |
| | `http://localhost:8787/api/auth/callback/google` |

Google allows several redirect URIs on one client, so local dev shares it.

---

## 5. Set the production secrets

Generate a real auth secret — the value in `.dev.vars` is a dev placeholder:

```bash
npx @better-auth/cli secret        # or: openssl rand -base64 32
```

Wrangler prompts for each value, so nothing reaches shell history or the repo:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret list           # confirm
```

Mirror the same values into `.dev.vars` (git-ignored) for local work. Email
needs no key — it is a binding.

---

## 6. Email verification

**Done, and no longer a manual switch.** `src/server/auth.ts` derives it from
the hostname the request arrived on:

```ts
const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
const requireEmailVerification = !isLocal;
```

On in production and on branch previews (they share production's D1), off on
localhost. That asymmetry is a deadlock fix, not a convenience: the
`send_email` binding does not deliver under local `wrangler dev` without
`"remote": true`, so requiring verification locally strands every local signup
with no way to reach the link. `sendEmail` also logs the whole message — reset
and verify URLs included — to the worker console locally, so the flow stays
inspectable without a mailbox.

Keyed on the request hostname rather than `NEXTJS_ENV` deliberately: an env
var can disagree with the origin a request actually came in on, and that
disagreement is invisible until auth mysteriously 403s.

**If you ever gate a *new* environment on verification, confirm mail actually
delivers there first.** Turning it on somewhere that cannot send locks every
signup out of its own account, including yours.

**One-off consequence of turning it on:** any `credential` user created before
the flip still has `email_verified = 0` and can no longer sign in. Verify or
delete those rows (all such test accounts were deleted; only
`rob@roberskine.com` remains).

---

## 7. Smoke test

Against `https://myfaite.app`:

- [ ] Sign up with email + password → verification email arrives
- [ ] Click the link → `/verify-email` confirms
- [ ] Sign in → header shows your email; Log out works
- [ ] Forgot password → reset email arrives → new password works
- [ ] Continue with GitHub → returns signed in
- [ ] Continue with Google → returns signed in
- [ ] **Offline check:** DevTools offline + hard reload → the board still
      renders from IndexedDB. Auth must never become a render dependency
      (ARCHITECTURE §2.4)
- [ ] Create todos signed out, then sign in → they adopt into the account
      (`getDb().todos.toArray()` in the console; `ownerId` should be your real
      user id, per ARCHITECTURE §2.12)

---

## 8. CI/CD — deploy on `main`, preview per branch

Repo: <https://github.com/RobErskine/faite> (remote already configured).

| System | Job |
|---|---|
| GitHub Actions (`.github/workflows/ci.yml`) | Quality gate — typecheck, lint, tests, both build targets |
| Cloudflare Workers Builds | Deploy — production on `main`, preview URL per branch |

Workers Builds is a better fit than deploying from Actions here: it needs no
`CLOUDFLARE_API_TOKEN` stored in GitHub, and stable per-branch preview URLs
posted as PR comments come free rather than needing to be scripted.

### Connect it

Dashboard → **Workers & Pages** → the `faite` Worker → **Settings → Build** →
**Connect** → GitHub → authorize → `RobErskine/faite`, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx opennextjs-cloudflare deploy` |
| Non-production deploy command | `npx opennextjs-cloudflare upload` |
| Root directory | *(blank)* |

Then **Settings → Build → Branch control** → tick **Builds for non-production
branches**. It is off by default, and it is what produces the per-branch
preview URLs and the PR comments.

`opennextjs-cloudflare upload` is OpenNext's equivalent of
`wrangler versions upload` — it publishes a version with a preview URL without
promoting it to production.

### Two teeth in the single-environment choice

Production-as-staging is a reasonable call while Faite has one user, but:

1. **Preview deployments share production's D1 database and Durable Objects.**
   Bindings are per-Worker, not per-version — so a branch preview reads and
   writes the real auth tables and, once P3 lands, real synced todo data.
   Treat previews as "the real app on a different URL", not a sandbox. This is
   the first thing to fix when environments get split.
2. **Deploys do not run D1 migrations.** New ones need
   `npm run auth:migrate:remote` (`wrangler d1 migrations apply AUTH_DB
   --remote`) applied by hand. Schema-dependent code deployed without it
   fails at runtime, not at build. `npm run deploy:with-migrations` (EI-79)
   runs the migration step before deploying, but it is a standalone opt-in
   script — nothing invokes it automatically; see docs/AUTH.md "Change auth
   config" for the one-time bootstrap production needs before it's safe to
   use with `--remote`.

---

## Local development

### Two servers, and what each one can do

`next dev` (:3000) never runs the worker entry (`src/server/worker.ts`), so
**all of `/api/*` is absent there** — it exists only under the real Workers
runtime that `npm run preview` starts on :8787. Run both, in two terminals, and
open :3000; `.env.local` points the auth client at :8787 so you get hot reload
and a working login at once.

| | `npm run dev` (:3000) | `npm run preview` (:8787) |
|---|---|---|
| Hot reload | ✅ | ❌ rebuild + restart |
| UI, board, drag-and-drop | ✅ | ✅ |
| `/api/auth/*` | ✅ cross-origin to :8787 | ✅ |
| `/api/sync/*` + WebSocket | ❌ **silent no-op** | ✅ |

The cross-origin half only works because `src/server/cors.ts` answers the
preflight for every origin on `TRUSTED_ORIGINS`. Better Auth does not do this
itself — `trustedOrigins` is a CSRF and redirect-target check that emits no CORS
headers — and before that file existed, signing in on :3000 failed as an opaque
`TypeError: Failed to fetch`. If that symptom ever returns, test the preflight
directly, not the POST:

```bash
curl -i -X OPTIONS http://localhost:8787/api/auth/sign-in/email \
  -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST'
# expect 204 + Access-Control-Allow-Origin: http://localhost:3000
```

### Sync is off on :3000, deliberately and silently

`src/lib/sync/transport.ts` fetches `/api/sync/*` same-origin-relative and
`ws-transport.ts` opens its socket the same way, so on :3000 the HTTP calls 404
and the handshake fails. The engine gives up **quietly** — no toast, no error —
because the board is local-first and correct without it: edits are written to
IndexedDB and simply stay on that device instead of reaching the account.

This is an accepted limit, not a defect, and **push/pull itself is fine** — it
is shipped, live in production, and works under `npm run preview`. Verify sync
on :8787 alone. See "Known limits, deliberately accepted" in `docs/SYNC.md`.

### Local D1 is a completely separate database

`wrangler dev` (and therefore `npm run preview`) uses a **local** SQLite file
under `.wrangler/state/v3/d1`, not the D1 instance in Cloudflare. The two share
only a schema, because the same migration was applied to each with `--local`
and `--remote`.

Consequences worth internalising:

- **Your production account does not exist locally.** Sign up fresh on
  `http://localhost:8787` — it is a different user table.
- **Nothing you do locally can affect production data.** Wipe and re-seed
  freely.
- **New migrations must be applied twice**, once with `--local` and once with
  `--remote`. Forgetting `--local` produces "no such table" only in dev;
  forgetting `--remote` produces it only in production, after a deploy.

Inspect and reset the local auth tables:

```bash
# What users exist locally?
npx wrangler d1 execute faite-auth --local \
  --command "SELECT email, email_verified FROM user;"

# Unstick a local account (verification is off on localhost, but a row created
# before that was true may still read email_verified = 0).
npx wrangler d1 execute faite-auth --local \
  --command "UPDATE user SET email_verified = 1;"

# Start completely clean. Child rows first — SQLite only enforces
# ON DELETE CASCADE when PRAGMA foreign_keys is on, which is not guaranteed.
npx wrangler d1 execute faite-auth --local \
  --command "DELETE FROM session; DELETE FROM account; DELETE FROM user; DELETE FROM verification;"
```

### What works locally, and what doesn't

| | Local | Why |
|---|---|---|
| Email/password sign-up + sign-in | ✅ | Verification is off on localhost (§6). Cross-origin from :3000 works via `src/server/cors.ts` |
| Sync — push/pull + WebSocket | ✅ on :8787, ❌ on :3000 | `next dev` runs no worker; the engine degrades silently. See above |
| Verification / reset **emails** | ⚠️ logged, not sent | The `send_email` binding needs `"remote": true` to deliver. The full message, links included, goes to the `preview` terminal — copy the URL from there |
| Google OAuth | ⚠️ needs config | Works once the real client ID/secret are in `.dev.vars` — `http://localhost:8787/api/auth/callback/google` is already a registered redirect URI on that client |
| GitHub OAuth | ❌ | A GitHub OAuth App accepts exactly **one** callback URL, and it points at production. Needs a separate "Faite (local)" app to work locally |

### `npm run preview` does not hot-reload

It is `opennextjs-cloudflare build && … preview` — the build runs **once, at
startup**. Any change under `src/server/` (or anywhere else) needs a full
restart, not a page refresh. A stale worker serving old code looks exactly
like a bug that "won't go away", so restart before diagnosing.

---

## The known-failing baseline is gone

`npm run verify` had a long-standing lint error in
`src/components/board/use-day-track.ts` (`react-hooks/set-state-in-effect`) that
several docs told you to expect and not fix. **It is fixed** — the queued jump is
a monotonic request now rather than state the layout effect cleared on its way
out, so nothing calls `setState` from inside an effect. See DRAG-AND-DROP §4.11.

Typecheck, lint and all 692 tests are green as of 2026-08-09. So a red `verify`
here now really does mean something just broke — there is no baseline to discount
any more.

One thing that shape hid, worth remembering: `verify` runs its steps in sequence,
so a failure at lint means **the two build targets never run** — including the
static-export Capacitor guard. That was true for however long the baseline lasted.
CI now runs the test suite *before* lint for the same reason.
