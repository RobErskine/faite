# Location — free text, saved places, and the Google lookup

Where a to-do happens. Three layers that look like one field:

1. **`Todo.location`** — free text. Always writable, always offline, never
   required to be a real address. "the shed out back" is a valid location.
2. **`Todo.placeId` → `Place`** — an optional link to a *saved* place with a
   nickname ("Home", "Gym"), so an address typed once can be recalled by name.
3. **Google Places** — an optional lookup that turns a few typed characters
   into a real formatted address plus `googlePlaceId`/`lat`/`lng`.

Each layer is optional and degrades to the one below it. A signed-out, offline
user gets layer 1 and 2 in full.

> One-time Google Cloud setup — enabling the API, creating and **restricting**
> the key, setting the secret, running it locally — is
> **[GOOGLE-PLACES-SETUP.md](GOOGLE-PLACES-SETUP.md)**. This file is how the
> feature works and how to change it.

**Out of scope, deliberately:** geofenced / location-triggered reminders. There
is no reliable background geolocation in a browser; that needs Capacitor plus a
native geofence plugin (`.ai/todo.md` P7) and is separate, later work. `lat`/`lng`
are stored today but nothing reads them.

---

## 1. Why `location` and `placeId` both exist (EI-63)

The obvious model — migrate `location` to `locationId` and point it at a table —
was rejected. `Todo.location` is free text that predates places, and a
`location` → `locationId` fork is an LWW merge hazard: two devices editing "the
same" location, one as text and one as a link, have no correct resolution.

So places shipped **additively**. `location` is unchanged and remains the
source of truth for display; `placeId` sits alongside it and is only ever a
*link*, never a replacement. The invariants:

- **Every todo with a place also has `location` text.** Selecting a place
  writes both. Nothing renders from `placeId` alone.
- **Typing clears `placeId`.** The moment the text diverges from the place it
  came from, the link goes — otherwise a stale nickname keeps showing for text
  that no longer matches it (`commitText`, `location-field.tsx`).
- **Deleting a place clears `placeId` on every todo, keeping `location`.**
  Nothing about a todo disappears, only the link (`deletePlace`,
  `repositories.ts` — mirrors `deleteLabel`'s `labelIds` cleanup).

Consequence worth knowing before "simplifying" this: there is no migration to
write, and no backfill. Old free-text locations render exactly as they always
did, and "Save … as a place" is the only promotion path.

## 2. Where it surfaces

| Surface | File | What it shows |
|---|---|---|
| To-do sheet → Location | `components/board/location-field.tsx` | The editable field: saved places + Google suggestions + "save as a place", plus a ✕ to clear |
| Settings → Places | `components/settings/places-section.tsx` | Manage the saved list; add one by hand or by lookup |
| Card / palette row | `components/board/todo-row-parts.tsx` | A **pin glyph with a tooltip**, inside the title's inline flow |

The card shows a pin, **not a chip** — deliberate, and pinned by a test named
exactly that in `todo-card.test.tsx`. `TitleMarkers` is the quiet inline glyph
run (deadline-ahead, rollover, location, recurrence); `TodoMetaBadges` is the
loud badge row reserved for things demanding attention (missed deadline,
Overflow age). Location is ambient context, so it stays quiet.

Picker mechanics — the three-way item list, the create-sentinel, the Base UI
traps — are **[PICKERS.md](PICKERS.md)** §3 and §5a, not repeated here.

## 3. The data model

No schema change was needed to add the Google lookup: `googlePlaceId`, `lat`
and `lng` shipped with EI-63 and were simply always `null` until EI-83 filled
them. `npm run schema:check` is a no-op for this feature.

| Layer | Where |
|---|---|
| Zod source of truth | `placeSchema`, `lib/schema.ts` |
| Dexie table | `places`, `lib/store/db.ts` |
| DO SQLite table | `places`, `server/db/user-schema.ts`; migration 9 `add-places` |
| Sync kind | `place` in `SYNC_KINDS` (`lib/sync/wire.ts`), column map in `server/sync/columns.ts` |
| Reads / writes | `usePlaces()` (`lib/store/hooks.ts`); `createPlace`/`updatePlace`/`deletePlace` (`lib/store/repositories.ts`) |

**`createPlace(name, address, google = {})` is one write, not two.** Saving a
looked-up place as `createPlace(...)` followed by `updatePlace(id, {lat, lng})`
would produce two outbox entries and two sync pushes for a single user action,
and every reader would briefly see an address with no coordinates.

## 4. The proxy

Google is called from the Worker, never the browser: `POST
/api/places/autocomplete` and `POST /api/places/details`, dispatched in
`server/worker.ts` beside `/api/auth/*` and `/api/sync/*` (all three read
`Request`, which `output: export` forbids in a Next Route Handler — see
[ARCHITECTURE.md](ARCHITECTURE.md) §2.12).

| File | Role |
|---|---|
| `server/places/routes.ts` | Status mapping and the two guards |
| `server/places/google.ts` | The only file that knows Google's shapes; pure mappers exported separately from the `fetch` wrappers |
| `server/places/validate.ts` | Parse-to-`null` request validation |
| `lib/places/wire.ts` | The contract both sides import — no DOM globals, it is typechecked under the worker's DOM-less `lib` |
| `lib/places/transport.ts` | Typed errors; routed through `apiUrl()` |

Why a proxy at all:

- The key stays a Worker secret and never enters a client bundle.
- **A browser-held key could not be restricted anyway** — Google's HTTP-referrer
  restrictions cannot cover `capacitor://localhost` (already in
  `TRUSTED_ORIGINS`). The same proxy works unchanged once Capacitor exists.
  The corollary bites in the other direction and is the single most expensive
  thing to get wrong here: a Worker's outbound `fetch` sends **no `Referer`**,
  so the key must carry *no* application restriction at all. See
  [GOOGLE-PLACES-SETUP.md](GOOGLE-PLACES-SETUP.md) §1.
- One place to enforce session tokens instead of trusting every caller.

**Both routes require a session; 401 otherwise.** The proxy spends real money
per call — unauthenticated it is an open, uncapped geocoder, and CORS does not
protect it (a non-browser caller ignores it entirely). The product rule that
falls out: *a signed-out user can still type a manual address, we just don't
match it against the Places API.* The client latches on 401/501/429 and
degrades to a plain text input — **no error, no nag, no "sign in to use this."**

Status mapping, all in `routes.ts`:

| Condition | Response | Why |
|---|---|---|
| No API key | `501 places-not-configured` | Checked **before** the session, so a misconfigured deploy doesn't read as an auth bug |
| No session | `401 unauthenticated` | Never a nag; the field degrades |
| Bad body | `400 invalid-request` | |
| Google 400/403 | `502 upstream-error` | Our validation already passed, so a rejection means *we* built it wrong. Returning 400 would blame the caller |
| Google 429 | `429 rate-limited` | Passed through so the client latches instead of retrying into a limit |
| Google 5xx / timeout | `502 upstream-unavailable` | |

Google's response body is never forwarded — it can name the key's restrictions.

## 5. Cost — the part that breaks silently

Autocomplete is billed per request unless requests are grouped into a
**session**: a run sharing one token, terminated by exactly one Place Details
call carrying that same token. Two rules from Google, both easy to violate
while the feature keeps working perfectly:

- An **abandoned** session (no terminating Details call) reverts every request
  in it to per-request pricing.
- A token **reused** across two completed sessions is invalidated, and
  everything in both is billed per-request.

`components/places/use-place-search.ts` owns all of it: a `crypto.randomUUID()`
minted when the **first request of a session actually goes out** (not on focus,
so focus-without-typing can't mint a token that is then discarded unspent),
reused while typing, spent on one Details call, then nulled.

Four things that quietly break the billing, every one regression-tested in
`use-place-search.test.ts`:

- **The debounce is the cost control**, not polish. Un-debounced, every
  keystroke is a billable request. `useDebouncedValue` at 350 ms.
- **Suppress the text a pick fills in.** Base UI writes the selected item's
  text into the input synchronously (`fillInputOnItemPress` — PICKERS §1),
  which flows straight back in as a new query. Unsuppressed, every selection
  costs an extra request *and* opens a session that can only be abandoned.
  `resolve(placeId, inputText)` suppresses both the optimistic label and the
  resolved address.
- **Never drop the token on blur.** Blur can fire as part of clicking a
  suggestion; dropping it there leaves the Details call carrying a token Google
  never saw during autocomplete, abandoning the session it was meant to
  terminate. The token is dropped when the field goes **empty** — the one
  unambiguous "no pick is coming" signal.
- **Recall-by-nickname must not call out at all.** `LocationField`
  short-circuits on a case-insensitive **prefix match against a saved place's
  `name`**, passing `enabled: false`. Deliberately a name prefix rather than
  "any local match": the list filter also matches on `address`, and an
  address-substring hit is exactly when the user *is* typing a real address and
  does want suggestions.

### The field mask is an Essentials one — keep it that way

Place Details bills by the **highest tier in the field mask**. `id`,
`formattedAddress` and `location` are all Essentials; `displayName` alone
promotes every call to Pro. We don't need it — the suggestion's
`structuredFormat.mainText` already gives us "Blue Bottle Coffee" to pre-fill
the nickname with.

The trade-off if you revisit it: terminating with a **Pro** Details call makes
every Autocomplete request in the session free, whereas **Essentials** bills the
first 12 and frees 13+. At a 350 ms debounce a session runs ~3–6 requests, so
the two land within noise of each other and Essentials has the larger free
allotment. `DETAILS_MASK` (`server/places/google.ts`) is one constant — flip it
if real metrics disagree.

## 6. Flow, end to end

1. Type → debounce → `POST /api/places/autocomplete` with the session token.
2. Pick → `POST /api/places/details` with the **same** token → `{ placeId,
   address, lat, lng }`. The optimistic label is committed to `Todo.location`
   first, then replaced by the canonical address when Details lands — so a
   failed lookup still leaves usable text.
3. Optionally name it → `createPlace(nickname, address, { googlePlaceId, lat,
   lng })`. Skippable: the address is already on the todo, which is why that
   prompt is labelled *(optional)*.
4. The todo carries `placeId` + `location`, exactly as a hand-entered place does.

## 7. Testing

No Miniflare, so `handlePlacesRequest` and the `worker.ts` dispatch line are
**deliberately untested** — same reason `sync/routes.ts` has none. They are
covered by `wrangler deploy --dry-run` and the manual smoke path in
GOOGLE-PLACES-SETUP.md §8.

| File | Guards |
|---|---|
| `components/places/use-place-search.test.ts` | **The billing file** — one request per burst, one token per session, a new token after, exactly one Details call, the latch |
| `server/places/google.test.ts` | Google's response shape, incl. dropping `queryPrediction` entries (no `placeId`); `sessionToken` present as a query param |
| `server/places/validate.test.ts` | The token regex as a query-string injection guard |
| `components/board/location-field.test.tsx` | Nickname prefix → **zero** network; row order; clear button; hand entry with the transport rejecting |
| `lib/api-origin.test.ts` | `next dev` reaches the preview worker |

Base UI testing traps (`fireEvent.input` vs `change`, `pointerDown` before
`click`, popups hiding the a11y tree, `waitFor` under fake timers) are
**[PICKERS.md](PICKERS.md)** §4.

## 8. If you change something here

- **Adding a field to `Place`** → [SCHEMA-CHANGES.md](SCHEMA-CHANGES.md) first;
  a field is declared in four places and derived in three more.
- **Adding a Google field** → check its SKU tier before adding it to a mask (§5).
- **Adding a `/api/places/*` route** → it goes in `server/worker.ts`, never a
  Next Route Handler, and `npx wrangler deploy --dry-run` is the only check
  that proves it bundles.
- **Any new client → Worker transport** → route it through `apiUrl()`
  (`lib/api-origin.ts`), never a bare relative path, or it 404s under
  `next dev`. See `.ai/lessons.md`.
