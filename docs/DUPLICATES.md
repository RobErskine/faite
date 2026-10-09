# Duplicate detection (EI-346)

To-dos arrive from five places: the board, REST (the Raycast extension),
MCP, email forwarding, and the desktop shell. It is easy to add the same thing
twice. With a TypeSafe Jev key saved in **Settings → Duplicates**, every new
open to-do is compared against the open ones, and a likely repeat is flagged.

## 1. The one hook

Every create, from every source, reaches `UserDurableObject.push()`
(`src/server/user-do.ts`). So the check lives there and nowhere else:

1. Inside the push transaction, each new `todo` insert is collected.
2. After commit, `selectNewTodosToCheck()` (`src/server/duplicates/check.ts`)
   keeps the open, top-level, non-occurrence ones. A push with more than
   `MAX_NEW_TODOS_PER_PUSH` (3) new to-dos is a bulk write (first sign-in
   uploading a device, a seed, an import) and is not checked at all.
3. `checkDuplicates()` runs **without being awaited**, so the push acks at
   once. `ctx.waitUntil` does nothing in a Durable Object; the object stays
   alive while it has pending I/O, and a Jev call is far inside the idle
   window.
4. If Jev finds a match, the flag is written **through `push()`** with a
   durable server HLC — a direct SQL write would never reach a device.

The check is best effort and total: no key, a Jev error, or a to-do that
changed meanwhile all end in "no flag". Logs never carry titles.

## 2. The judgment

One Jev **Noul** per candidate, in one request per 100 candidates, run in
parallel — the documented dedupe pattern
(<https://docs.typesafe.ai/primitives/noul.md>). The new to-do is `state`;
each existing one is a question's `instructions`. A Choice over all
candidates was rejected: it always ranks something first, so it cannot say
"none of them".

| Constant | Value | Why |
|---|---|---|
| `JEV_MODEL` | `jev-1.13.0` | Pinned, so a model update cannot move the threshold silently. |
| `DUPLICATE_THRESHOLD` | 0.8 | The docs' confident-yes band. A false flag costs one tap. |
| `MAX_CANDIDATES` | 300 | Most recently updated open to-dos. |
| Notes | first 300 chars | Titles carry most of the meaning. Dates are never sent; Jev is weak at them. |

Candidates exclude sub-tasks, recurring occurrences, to-dos in archived
lists, already-flagged to-dos, and the push's own other new to-dos.

Cost runs on the user's key: about $0.001 per check at $0.042 per million
input tokens.

## 3. The fields

Two nullable synced fields on `todo` (migration 24):

- **`duplicateOf`** — the id of the matched to-do. Null means not flagged.
- **`duplicateHeld`** — hold it off the board until reviewed. True when every
  HLC on the create ends in `:server`, i.e. it came from REST, MCP or email.
  A to-do typed on the board carries its device's HLC and stays visible, only
  flagged; hiding it would make it vanish a second after typing.

**Settings → Duplicates → Hold every duplicate** (`settings.holdAllDuplicates`,
synced, migration 25) holds every match, board-typed ones too. It is read on
the client, never by the server, so turning it on or off also applies to
flags that already exist. `isHeldDuplicate()` (`src/lib/duplicates.ts`) is the
one rule: flagged, and either `duplicateHeld` or the setting.
`use-board-data.ts`'s `visibleTodos` drops held duplicates, so every board
surface and ⌘K search skip them.

## 4. The key

`POST/GET/DELETE /api/duplicates/key` (`src/server/duplicates/routes.ts`),
cookie session only. The key is checked with a one-question Jev request
first: 401/403 rejects it; a busy or unreachable Jev saves it anyway and the
user is told it was not checked.

Stored in the user's DO **KV storage** (`jev-key`), AES-GCM under an HKDF
subkey of `BETTER_AUTH_SECRET` with its own `info` (`jev-key.ts`). Never in
the synced `settings` row. `wipe()` removes it with the account. Rotating
`BETTER_AUTH_SECRET` makes it unreadable, which reads as "no key".

## 5. The UI

| Surface | File |
|---|---|
| Toast with **Review** for a newly flagged to-do | `use-duplicate-toasts.ts` |
| Dot on the avatar (Status channel `--info`, not Urgent red) and **Duplicates** menu item | `app-header.tsx` |
| ⌘K **Review duplicates (N)**, only while N > 0 | `command-registry.ts` |
| The review sheet | `duplicates-sheet.tsx` |
| The key, and the Hold every duplicate switch | `settings/duplicates-section.tsx` |

In the sheet, **Mark as duplicate and remove** is the board's own delete, with
its Undo toast. **Add to board** (held) or **Keep both** (flagged but visible)
clears both fields.

The toast hook remembers the first loaded set and announces only what appears
after it, so a reload never repeats old flags. Several at once become one
toast.

## 6. Known limits

- Not tested against a live key in CI. `check.test.ts` covers selection,
  chunking, threshold and errors with a fake `fetch`.
- A to-do edited into a duplicate later is not checked; only creates are.
- The server never re-flags a to-do once it is cleared.
