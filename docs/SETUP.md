# Faite — one-time setup runbook

Work top to bottom — **order matters**, because §2 and §4 both bake
`myfaite.app` into URLs that are annoying to re-register.

## Status

| § | Step | State |
|---|---|---|
| 0 | wrangler token scopes | ✅ done |
| 1 | `myfaite.app` on Cloudflare DNS | ✅ was already Active |
| 2 | Worker on the custom domain | ✅ live at https://myfaite.app |
| 3 | Cloudflare Email Sending | ✅ enabled, test message delivered |
| 4 | GitHub + Google OAuth apps | ⬜ **needs you** |
| 5 | Production secrets | 🟡 `BETTER_AUTH_SECRET` set; OAuth ones pending §4 |
| 6 | Email verification flag | ⬜ **needs you** — after §7 |
| 7 | Smoke test | ⬜ **needs you** |
| 8 | CI/CD | 🟡 `preview_urls` enabled in config; dashboard connection **needs you** |

Email/password sign-up, sign-in, and password reset should work on
https://myfaite.app right now. Only the two OAuth buttons are dead until §4.

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
"workers_dev": false,
"preview_urls": true,
```

> ⚠️ **Declaring a route silently disables both `workers_dev` and
> `preview_urls`.** Wrangler only mentions it in a warning at the very end of a
> deploy, well after the success line. Two consequences, both found the hard
> way:
>
> - `faite.bfmw-dev.workers.dev` started returning **404** the moment the
>   custom domain went live. That's fine here — `myfaite.app` is the only
>   origin auth works on, so `workers_dev: false` is deliberate rather than
>   accidental.
> - **Preview URLs went off too**, which would have quietly broken the
>   per-branch previews in §8 — `opennextjs-cloudflare upload` produces nothing
>   else. Hence the explicit `preview_urls: true`.

```bash
npm run deploy
curl -sI https://myfaite.app | head -1     # expect HTTP/2 200
```

Verify with a real request, and **poll before diagnosing** — per
`.ai/lessons.md`, a 404 immediately after a deploy was propagation lag, not a
broken worker.

> **Why this comes before §4:** `src/server/auth.ts` already hardcodes
> `baseURL: "https://myfaite.app"` outside development. Register OAuth
> callbacks against the workers.dev URL and you will be redoing them.

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

## 6. Turn on email verification

§3 already delivers real mail, so this is unblocked — but **do §7's smoke test
first**. Confirm the signup → email → verify loop actually works end to end
before putting it in front of every signup, including your own.

In `src/server/auth.ts`:

```ts
const REQUIRE_EMAIL_VERIFICATION = true;   // was false
```

Flipping this before mail can actually send locks every signup — including
yours — out of their own account. Deploy after changing it.

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
   `npx wrangler d1 execute faite-auth --remote --file=drizzle/auth/<file>.sql`
   applied by hand. Schema-dependent code deployed without it fails at runtime,
   not at build.

---

## Known-failing baseline

`npm run verify` currently fails on one **pre-existing** lint error in
`src/components/board/use-day-track.ts:156` (`react-hooks/set-state-in-effect`),
unrelated to auth or setup. Typecheck, all 239 tests, and both build targets
are green. Don't read a red `verify` here as "something I just did broke it."
