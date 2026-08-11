# Google Places setup — for wiring up saved-place typeahead

## Status

**Not started.** The data model and sync plumbing for saved places
(`Place` in `lib/schema.ts`, the `place` sync kind, the `places` table,
`Todo.placeId`) already exist — see the "Places" section in Settings, which
lets you add a place by hand today. This doc is what's left: replacing the
hand-typed address field with real Google typeahead.

Read this before writing any code — the API surface changed materially in
2025 and most search results/training data describe the deprecated version.

## 0. What you're integrating, and what you're not

- **In scope:** typing a few letters of an address and getting real
  suggestions; picking one fills in a formatted address (and, once you
  choose to store it, lat/lng and a Google place id).
- **Out of scope, deliberately:** geofenced/location-triggered reminders.
  There is no reliable background geolocation in a browser. That needs
  Capacitor + a native geofence plugin (see `.ai/todo.md`'s P7 section) and
  is a separate, later piece of work.

## 1. Google Cloud project + API

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
5. Restrict the key immediately (Credentials → the key → Application
   restrictions): **API restrictions** to "Places API (New)" only, and
   **HTTP referrer** restrictions to `https://myfaite.app/*` and your local
   dev origin. Note referrer restrictions can't cover `capacitor://localhost`
   (already in `TRUSTED_ORIGINS`, `src/server/auth.ts`) — that's one more
   reason the key stays server-side (§3), never shipped to the client.

## 2. Which API calls you need

Two, per place lookup:

- **Autocomplete (New)** — `POST https://places.googleapis.com/v1/places:autocomplete`
  as the user types. Returns suggestions.
- **Place Details (New)** — `GET https://places.googleapis.com/v1/places/{placeId}`
  once the user picks a suggestion. Returns the formatted address, lat/lng,
  and the place id to store in `Place.googlePlaceId`/`lat`/`lng`.

**Do not use `google.maps.places.Autocomplete`** (the `<script>`-loaded
JS widget) or `AutocompleteService` — both are the legacy API, and
`Autocomplete` has been unavailable to new customers since 2025-03-01. The
current replacements are `PlaceAutocompleteElement` (a web component) or the
REST endpoints above. This project should use the **REST endpoints via a
server proxy**, not the web component — see §3 for why.

## 3. Proxy through the Worker, don't call Google from the browser

Add two routes to `src/server/worker.ts`, alongside `/api/auth/*` and
`/api/sync/*` (same reason those aren't Next.js Route Handlers: `output:
"export"` forbids a Route Handler that reads `Request`):

- `POST /api/places/autocomplete` — forwards `{ input, sessionToken }` to
  Google's Autocomplete (New) endpoint with the server-side API key attached,
  returns the suggestions.
- `POST /api/places/details` — forwards `{ placeId, sessionToken }` to Place
  Details (New), returns the formatted address + lat/lng.

Why a proxy rather than calling Google directly from the client:

- The API key stays a Worker secret (`wrangler secret put GOOGLE_PLACES_API_KEY`),
  never bundled into client JS.
- HTTP-referrer key restrictions don't reach `capacitor://localhost` (§1) —
  a server-side key sidesteps that entirely, and this same proxy works
  unchanged once Capacitor exists.
- One place to enforce session tokens (§4) instead of trusting every caller.

## 4. Session tokens — this is the part that controls cost

Autocomplete (New) is billed under the `Autocomplete Session Usage` SKU,
which is **free**, but only when requests are grouped into a session that
terminates in exactly one Place Details (or Address Validation) call. Get
this wrong and every keystroke bills individually:

- If a session is abandoned (no terminating Details call), the Autocomplete
  requests in it are billed as if no session token had been used at all.
- If a session token is reused across more than one completed session,
  Google invalidates it and bills everything per-request.

Concrete implementation: generate a fresh UUID client-side the moment the
user starts typing in the place combobox (not per keystroke). Send that same
token on every Autocomplete request while they keep typing, and on the one
Details request when they select a suggestion. Discard the token after that
— a new one gets minted the next time the field is focused.

## 5. Data flow into the existing model

1. User types in the combobox → client debounces → `POST
   /api/places/autocomplete` with the session token → suggestions render.
2. User picks one → `POST /api/places/details` with the same token →
   `{ formattedAddress, lat, lng, placeId }`.
3. Prompt "Save as…" (a nickname) → `createPlace(nickname, formattedAddress)`
   (`lib/store/repositories.ts`), then `updatePlace(id, { googlePlaceId:
   placeId, lat, lng })` — or extend `createPlace` to take all fields at
   once, whichever reads better once you're writing the combobox component.
4. Assign the place to a todo exactly as today: `placeId` + `location` (see
   the Location field in `components/board/todo-sheet.tsx`).

No schema or sync changes needed for any of this — `Place.googlePlaceId`,
`lat`, `lng` already exist and already sync (verify with `npm run
schema:check`, which should already be green with no changes required).

## 6. Recall-by-nickname stays free and offline

Once a place is saved, typing its nickname to reuse it is a local Dexie
query (`usePlaces()`, `lib/store/hooks.ts`) — zero API calls, works offline.
Only a **new** address lookup needs Google. Build the combobox so typing a
name that matches a saved place's nickname short-circuits before ever
calling `/api/places/autocomplete`.

## 7. Verification checklist

- [ ] `wrangler secret put GOOGLE_PLACES_API_KEY` set for the target
      environment (and in `.dev.vars` locally — never commit that file).
- [ ] `npx wrangler deploy --dry-run` still bundles cleanly with the new
      routes (the usual worker-bundling gate — see `.ai/lessons.md`).
- [ ] One typed session in the real UI produces exactly one Details request
      in the Cloud Console's API metrics, not one per keystroke.
- [ ] A saved place recalls by nickname with the network tab showing no
      request at all.
- [ ] `npm run build:static` still passes — the Capacitor guard.

## Sources

- [Migrate to the new Place Autocomplete](https://developers.google.com/maps/documentation/javascript/legacy/places-migration-autocomplete)
- [Places Widgets — `PlaceAutocompleteElement`](https://developers.google.com/maps/documentation/javascript/reference/places-widget)
- [Autocomplete (New) and session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)
- [Places API usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
