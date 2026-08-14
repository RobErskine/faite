# Google Places setup — the one-time runbook

**Shipped (EI-83).** This is the vendor half: standing the Google Cloud project
up, creating and restricting the key, setting the secret, running it locally,
and verifying it. **How the feature works** — the data model, the proxy, the
cost discipline, what to test — is **[LOCATION.md](LOCATION.md)**.

Read this before touching the key. The Places API surface changed materially in
2025, and most search results and model training data still describe the
deprecated version.

## 1. Google Cloud project + API

**Use the REST endpoints, not the JS widget.** `google.maps.places.Autocomplete`
and `AutocompleteService` are the legacy API, and `Autocomplete` has been
unavailable to new customers since 2025-03-01. The current options are
`PlaceAutocompleteElement` (a web component) or the REST endpoints — we use the
REST endpoints through a Worker proxy, for the reasons in
[LOCATION.md](LOCATION.md) §4.

1. Create (or reuse) a project at https://console.cloud.google.com.
2. Enable **Places API (New)** — not "Places API", which is the legacy
   version. APIs & Services → Library → search "Places API (New)" → Enable.
3. Enable billing on the project. As of March 2025 the universal $200/month
   credit was retired in favor of per-SKU free tiers; check the current
   quantities at https://console.cloud.google.com/google/maps-apis/quotas
   before assuming a number — Google's own usage/billing docs don't state
   them in prose, only the console does.
4. Create an API key: APIs & Services → Credentials → Create Credentials →
   API key.
5. Restrict the key immediately, but **only by API**: Credentials → the key →
   **API restrictions** → "Places API (New)". Leave **Application
   restrictions** set to **None**.

   > **Do not add HTTP-referrer restrictions.** This key is used from a
   > Cloudflare Worker, and a Worker's outbound `fetch` sends **no
   > `Referer` header at all** — so a referrer-restricted key returns
   > `403 REQUEST_DENIED` for every call the proxy makes, from production
   > included. IP restrictions are no substitute either: Workers egress from
   > Cloudflare's shared, non-static address space. (An earlier version of
   > this doc told you to add referrer restrictions. It was wrong, and it
   > would have taken the feature down in production while working fine in
   > every test that mocks the transport.)

6. Cap the spend where restrictions can't: Google Maps Platform → Quotas, and
   set a daily request cap per API. That, not the key restriction, is the real
   guard on a proxy that any signed-in user can reach.

## 2. Running it locally

`/api/places/*` lives in the Worker, and **`next dev` (:3000) runs no Worker**.
Two terminals, exactly as with auth:

```
npm run preview   # builds + serves the worker on :8787 — the API
npm run dev       # the UI on :3000, with HMR
```

The client reaches the first from the second via `apiUrl()`
(`src/lib/api-origin.ts`), which reads `NEXT_PUBLIC_AUTH_URL` — already set to
`http://localhost:8787` by the `dev` script. `http://localhost:3000` is in
`TRUSTED_ORIGINS`, so the preflight and the credentialled POST both pass, and
the session cookie is shared because cookies ignore port.

**You must be signed in.** The proxy requires a session, so a signed-out field
is *supposed* to look like a plain text input.

Diagnose the route without a browser — the three failure modes are
indistinguishable in the UI, because the client latches on all of them and
falls silent:

```
curl -i -X POST http://localhost:8787/api/places/autocomplete \
  -H 'Content-Type: application/json' \
  -d '{"input":"1600 Amphi","sessionToken":"11111111-2222-3333-4444-555555555555"}'
```

| Response | Meaning |
|---|---|
| `401 unauthenticated` | Route is up, key is set, you're just not signed in — **this is the healthy answer to an unauthenticated curl** |
| `501 places-not-configured` | No `GOOGLE_PLACES_API_KEY` in `.dev.vars` (or not `wrangler secret put` in prod) |
| `404` | You hit `:3000`, not `:8787` |
| `502 upstream-error` | Reached Google and it refused — check the Worker's log line; a referrer-restricted key lands here (§1.5) |

## 3. Verification checklist

- [ ] `wrangler secret put GOOGLE_PLACES_API_KEY` set for the target
      environment (and in `.dev.vars` locally — never commit that file).
- [ ] `npx wrangler deploy --dry-run` still bundles cleanly with the new
      routes (the usual worker-bundling gate — see `.ai/lessons.md`).
- [ ] The curl above returns 401, not 404 or 501.
- [ ] One typed session in the real UI produces exactly one Details request
      in the Cloud Console's API metrics, not one per keystroke.
- [ ] A saved place recalls by nickname with the network tab showing no
      request at all.
- [ ] The Details SKU in Cloud Console metrics reads **Essentials**, not Pro —
      if it reads Pro, someone added `displayName` to `DETAILS_MASK`.
- [ ] `npm run build:static` still passes — the Capacitor guard, and the check
      that the key never entered a client bundle
      (`grep -rl "$KEY" out/ .next/ .open-next/` must be empty).

## Sources

- [Migrate to the new Place Autocomplete](https://developers.google.com/maps/documentation/javascript/legacy/places-migration-autocomplete)
- [Places Widgets — `PlaceAutocompleteElement`](https://developers.google.com/maps/documentation/javascript/reference/places-widget)
- [Autocomplete (New) and session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)
- [Places API usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
