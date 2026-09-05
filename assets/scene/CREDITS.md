# Scene asset credits

Source models for the homepage story scene (EI-272). `npm run scene` reads
`models/` and writes `public/scene/living-room.glb`.

**Two of these are CC-BY, and that is a condition of use, not a courtesy.**
CC0 waives everything — you may ship it uncredited. CC-BY grants the licence
*only* if attribution is given. So the credits below have to reach a user, not
just sit in this file: they render at `/colophon`, which is linked from the
marketing footer. If a CC-BY model is added here and not added there, the page
is shipping something it is not licensed to ship.

Attribution follows the standard CC form — **title, creator, licence, source.**

| Model | Title | Creator | Licence | Source |
|---|---|---|---|---|
| `old-tv` | Featured Content | Kell Condon | **CC-BY 3.0** | Poly Pizza |
| `new-tv` | TV | Jarlan Perez | **CC-BY 3.0** | Poly Pizza |
| `houseplant` | Houseplant | Quaternius | CC0 | Poly Pizza |
| `furniture/*` | Ultimate House Interior Pack | Quaternius | CC0 | quaternius.com |

## Adding a model

1. Drop the `.obj` + `.mtl` (or `.glb`) into `models/`.
2. Add a row above with all four fields. A missing licence is a blocker, not a
   TODO.
3. If it is CC-BY, add it to `src/app/colophon/page.tsx` in the same commit.
4. Add it to `SCENE_MODELS` in `scripts/scene/build-room.mjs` with its target
   real-world size.
5. `npm run scene`, then commit the regenerated
   `public/scene/living-room.glb` — generated files are committed here, same
   convention as `assets/icons/` (`docs/APP-ICON.md`).

## Why the sources are vendored

A build that reads `~/Downloads` is not a build. These files are small (~350 KB
of plain-text OBJ, no textures anywhere) and committing them makes
`npm run scene` reproducible on any machine and in CI.
