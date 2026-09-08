# The 3D room scene

The isometric living room on `/` — how it is built, why it is built that way,
and what to do to it next.

This file is the **room**. The page it sits on — the beat table, the hero
board, the traveling card, the ticks — is [HOMEPAGE.md](HOMEPAGE.md), and
neither repeats the other. The claims are governed by
[RESEARCH.md](RESEARCH.md); the point-in-time spike record with the original
measurements is `.ai/ei-272-3d-spike-runbook.md`. This file is the standing
procedure.

**The one-line summary:** a Node script bakes 22 CC0/CC-BY models into one
371 KB GLB of named nodes; a layout file places those nodes in meters; a
runtime pass re-tints them from CSS tokens; and the whole canvas is an
enhancement loaded strictly after first paint, on top of a flat page that
already tells the story.

---

## 1. Where everything lives

| File | Role |
|---|---|
| `assets/scene/models/*.obj,.mtl,.glb` | Vendored sources. ~350 KB of plain text, no textures anywhere. |
| `assets/scene/CREDITS.md` | Title / creator / license / source per model. A missing license is a blocker. |
| `scripts/scene/build-room.mjs` | `npm run scene`. Reads the sources, writes one merged GLB. |
| `public/scene/living-room.glb` | The committed build output. 371 KB, 23 nodes, 37 materials. |
| `src/components/scene/room-layout.ts` | Where every prop sits, in meters. No geometry. |
| `src/components/scene/room-materials.ts` | Material name → CSS custom property, and the re-tint pass. |
| `src/components/scene/beat-animations.ts` | What the room DOES during each beat: beat-local time, pure state functions, the commit-before-tick rule. Unit-tested. |
| `src/components/scene/room-camera.ts` | Which object each beat frames, and the interpolation between them. No three.js, so it is unit-tested. |
| `src/components/scene/room-scene.tsx` | The R3F canvas: shell, lights, camera rig, placed props, the fish. |
| `src/components/scene/room-stage.tsx` | The pinned stage, the lazy gate, the scroll listener, the flat fallback. |
| `src/components/scene/webgl.ts` | Capability + reduced-motion probe. |
| `src/lib/story-beats.ts` | One row per beat: headline, body, citation, the sub-task it ticks, and the object it frames. The room reads `focus` and `TICK_AT` from here. |
| `src/app/globals.css` | The `--room-*` token block, light and dark. |

The page's own files — `app/page.tsx` and everything in
`src/components/marketing/` — are [HOMEPAGE.md §2](HOMEPAGE.md).

Generated output is **committed**, same convention as `assets/icons/`
(`docs/APP-ICON.md`). Run `npm run scene` and commit the GLB in the same
change as any edit to `build-room.mjs`.

---

## 2. The load architecture, and its three invariants

These are the whole reason the spike existed. Breaking one is a regression
even when nothing looks different.

**1. three.js is fetched strictly after first paint, and only where it can
run.** `room-stage.tsx` mounts the canvas behind `canUseWebGL()` inside a
`requestAnimationFrame` in an effect. The headline is server-rendered, so LCP
never depends on the 3D chunk. That is why 227 KB of three.js costs 0 ms of
LCP.

**2. Scroll writes to a ref, never to React state.** `progress.current` is
written by the scroll listener and read inside `useFrame`. A `setState` per
scroll event would re-render the tree at 60 fps and spend the entire INP
budget. **React renders the scene exactly once.**

**3. The flat page is the real page.** `prefers-reduced-motion` and no-WebGL
both fall back to a static panel that says the same thing. The canvas is an
enhancement on top of a page that already works, not the page itself.

A fourth, softer rule, **and EI-280 deliberately broke it — read why before
restoring it.** The spike's rule was: every prop is present from the first
frame, because furniture that pops in reads as a software demo while a room
that is simply there reads as a place someone lives. That was right for a room
with no story attached to it.

It stopped being right once each section became a *to-do*. The loveseat now
pops in and the old television animates out before the new one pops in —
because those are the payoffs of "Measure the room before ordering the couch"
and "Upgrade TV", and a to-do that gets checked off while the room visibly does
not do it is a lie told in two places at once (§11).

The surviving rule is narrower and still binding: **a prop appears only as the
payoff of a beat, never as decoration.** Anything not named by a
`STORY_BEATS` row is present from the first frame.

---

## 3. The measured budget

From the spike, at 412×915 with 4× CPU throttling and Slow 4G:

| Criterion | Budget | Measured |
|---|---|---|
| LCP | ≤ 2500 ms | **932 ms** |
| CLS | — | **0.00** |
| LCP node | must not be the canvas | **the server-rendered headline** |
| three.js eager (before paint) | 0 KB | **0.0 KB** |
| three.js lazy (after paint) | budgeted | **227.7 KB gz / 864.8 KB raw** |
| `/` homepage weight | unchanged | **+0.5 KB gz** |
| three.js in the app-shell bundle | 0 chunks | **0 chunks** |
| Scroll frame cost, 4× throttled | no dropped frames | **median 8.3 ms, p95 9.5 ms, 0 frames > 33 ms** |

Two caveats that were honest then and are still honest now. **TTFB was 6 ms
because the server was localhost** — a real deploy adds a round trip. And the
frame numbers were taken against a dozen untextured boxes, *not* the finished
room; the GLB is flat-shaded and unlit-cheap so the cost should stay flat, but
**re-measure on the live deploy before trusting it**. Scripts:
`scripts/spike/measure-page.mjs` and `measure-deferred.mjs`. The directory name
is historical: they were written for the EI-272 spike and kept their path so
the runbook and `.ai/lessons.md` still point at files that exist.

INP is not measured and is not meaningful here: the page has no tap targets,
and scroll is not an INP interaction. Frame cost is the real proxy.

---

## 4. The two permanent guards

### The app-shell build must never contain three.js — or the GLB

`npm run build:static` produces the payload that ships *inside* the Tauri
desktop app, where `/` is only a redirect script and the canvas can never
mount. Every byte of scene in there is dead weight that every installed
client re-downloads.

```ts
const IS_APP_SHELL = process.env.NEXT_PUBLIC_APP_SHELL === "1";
const RoomScene = IS_APP_SHELL ? () => null : dynamic(() => import("./room-scene"), { ssr: false });
```

`NEXT_PUBLIC_*` is inlined at build time, so the comparison folds to a literal
and the bundler drops the `import()` entirely. `next/dynamic` alone does **not**
do this — it defers fetching, it does not remove the module from the graph.

This has now failed twice: once with three.js (865 KB, caught by a grep) and
once with the GLB (240 KB, caught by an `ls`). The standing guard is
`src/lib/desktop/bundle-assets.test.ts`, which asserts on the exclusion list in
`scripts/desktop/bundle-assets.mjs`. **Adding a new scene asset means checking
it is excluded there.**

### The CC-BY chain must not break

CC0 waives everything. **CC-BY grants the license only if attribution is
given**, so a CC-BY model whose credit is not on a page a user can reach is a
model this project is not licensed to ship. Three places, one change:

1. `assets/scene/CREDITS.md` — the row.
2. `src/app/colophon/page.tsx` — the user-reachable credit, linked from the
   marketing footer.
3. `e2e/marketing-pages.spec.ts` — the creator's name in the assertion list of
   *"the colophon credits every CC-BY creator by name"*.

That e2e test is the enforcement. Four CC-BY models ship today: Kell Condon,
Jarlan Perez, sirkitree, Tiff Eidmann — all via Poly Pizza.

---

## 5. The asset pipeline (`npm run scene`)

Pure Node, no Blender. That is deliberate: these models are 60–750 faces each
with **no textures anywhere** — every material is a flat color — so the
conversion is a few hundred lines of arithmetic, and keeping it
dependency-free means the build works in CI and on any machine.

### The normalization contract

Every model is normalized so placement code can treat them all identically:

1. **Orientation** — rotated so its front faces **+Z**.
2. **Scale** — scaled so the axis named by `fit` measures `size` **meters**.
3. **Origin** — centered on X/Z, sitting on **Y = 0**.

So a position in `room-layout.ts` is a position in a real room. Sizes are
real-world and belong in the build spec; **never scale at placement time**, or
the scene stops being in meters and every later coordinate becomes a magic
number.

### Spec options

| Option | Effect |
|---|---|
| `fit` + `size` | The axis to measure and its target size in meters, applied **after** `rotateY`. |
| `rotateY` | Degrees, applied first, to bring the model's front round to +Z. |
| `rename` | Namespaces this model's materials. |
| `squash` | Scales Y/Z after normalising. Grounding and centering survive it. |
| `split` | Lifts one material's geometry into its own sibling node, after normalization. |

**`rename` is not cosmetic.** The Quaternius kit gives the couch and the rug
the same `DarkRed`, so without namespacing a blue couch forces a blue rug.
Poly Pizza models arrive with generic `mat3`/`mat17` names that **collide
across models** — the two televisions already own a `mat*` range, so any new
Poly Pizza asset must rename every material it brings.

**`split` is what makes the fish swim.** The fish is its own material inside
the bowl's GLB. Splitting after the shared normalization means both nodes keep
the same origin, so placing them at one position nests the fish back inside
the glass — and `room-scene.tsx` can then animate one without the other. The
pair must be given the **same `position` and the same `rotationY`**, or the
fish swims through the wall of its bowl.

### Two source formats

`.obj` + `.mtl` goes through `parseObj`/`parseMtl`. `.glb` goes through
`parseGlb`, which is deliberately minimal — it handles strided accessors but
throws loudly on node transforms, and reads flat `baseColorFactor` colors
only. It carries the **alpha** through, which is what makes the fish bowl's
glass glass: any material with alpha < 1 is emitted `BLEND` and
`doubleSided`, or it renders as an opaque dome.

Both paths converge on the same `{ groups, colors }` shape, so nothing
downstream knows which format a model came from.

---

## 6. Placement (`room-layout.ts`)

Placement is separate from geometry on purpose: a prop can be nudged without
re-running the build.

Two things to know before editing:

- **No `as const` on anything holding a coordinate.** It would make these
  readonly tuples, and three.js/R3F props want mutable ones. The two do not
  unify and the error surfaces far from here.
- **Surface heights are derived constants with a comment tying them to a
  build size** (e.g. `CONSOLE_TOP = 0.445`, from `Shelf_Small1`'s aspect ratio
  at a 1.5 m fit). Models sit on Y = 0 and nothing else corrects for it — **if
  a prop's `size` changes in `build-room.mjs`, every constant derived from it
  changes too.**

`CONTACT_SHADOWS` is a hand-maintained list of soft quads under anything with
mass. Flat-lit low-poly furniture floats without them. Note the `y` varies:
props standing *on the rug* need their shadow at the rug's top surface, not
the floor. **Removing a prop means removing its shadow row**, or a shadow
stays behind under nothing.

---

## 7. Theming (`room-materials.ts`)

The whole kit shares a semantic material palette (`Wood`, `White`,
`Plant_Green`, …) and carries no textures, which is what lets the room read
its colors from CSS custom properties at runtime rather than baking one look
into the GLB. The scene follows light/dark, and the design system can move
without a re-export.

Rules:

- **`MATERIAL_TOKENS` maps exactly the materials the GLB contains, no more.** A
  speculative mapping for a material that never ships is a token nobody can
  see drift. When a prop is removed, check whether its materials left with it
  and drop the orphaned tokens from both this file and `globals.css`.
- **Tokens must be hex.** `Color.setStyle` accepts hex, `rgb()` and `hsl()`;
  give it `oklch()` or `light-dark()` and it throws, the catch keeps the baked
  color, and the whole token system silently does nothing while looking like
  it works.
- Light and dark are two blocks, not one `light-dark()` call. **The room does
  not invert at night, it dims** — same hues, lower lightness.
- An unmapped material keeps the color baked into the GLB, so the failure
  mode is a slightly-off prop, never an invisible one. The televisions' and
  the books' own liveries are unmapped **on purpose**: a CRT should look like
  a CRT in any theme.

---

## 8. Recipe: adding or changing a model

1. Drop the source into `assets/scene/models/`.
2. Add its row to `assets/scene/CREDITS.md` — all four fields.
3. If CC-BY, add it to `src/app/colophon/page.tsx` **and** the creator list in
   `e2e/marketing-pages.spec.ts`, in the same commit. (§4)
4. Add it to `SCENE_MODELS` in `build-room.mjs` with a real-world `size`, and
   `rename` any generic `mat*` materials to a namespaced prefix. (§5)
5. `npm run scene`. Read the printed size table — it is the fastest check that
   `fit` and `rotateY` are right.
6. Place it in `room-layout.ts`, and add a `CONTACT_SHADOWS` row if it has
   mass. (§6)
7. Map any new semantic materials to tokens in `room-materials.ts` +
   `globals.css`, or deliberately leave them baked. (§7)
8. **Look at it.** (§9)
9. `npm run typecheck && npm run lint`, and commit the regenerated GLB.

---

## 9. Verifying a change: look at the room

Every composition bug on this scene was found by eye and none by a test. The
suite cannot tell you the sofa faces the wall.

Run the dev server, open `/`, scroll into the story, screenshot it, and crop in on what you
changed. Two failures worth knowing about, both recorded in `.ai/lessons.md`:

- **A "verified by render" comment verifies the model it was written against.**
  The love seat shipped facing the wall because a `rotateY: 180` survived a
  swap to a different couch model that already faced +Z. When the source file
  under a spec changes, every orientation and scale claim in that entry is
  unverified again.
- **An annotation arrow points at pixels, not at scene nodes.** A review asked
  to remove "the cactus"; there was no cactus. A white-globe floor lamp stood
  in front of a paddle-leaf plant and the two composited into one convincing
  cactus from the camera's single angle. Crop and zoom the target before
  mapping a label to a node.

For animation, a two-frame pixel diff is a cheap proof: capture, wait, capture,
and count changed pixels inside the region vs a control region. The fish reads
155 changed pixels in the bowl and 0 everywhere else.

---

## 10. Composition rules the review rounds produced

These are aesthetic, but they were expensive to learn, and each one replaced
something that looked wrong:

- **The rug anchors the seating zone.** Front feet of every seat land on it.
  Furniture scattered off-rug is what made the first pass read as a showroom.
- **Props relate to other props.** A prop with no relationship to another prop
  reads as clutter — the side table touches the couch's arm, the sideboard
  sits under the wall art so the art is not floating, plants go where the
  light is.
- **Real apartments are the small thing furniture fills**, not the big thing it
  rattles in. The room lost square footage (6×5 → 5.4×4.6 m) rather than
  inflating every prop past its real size.
- **Matched pairs read as a hotel lobby.** Two identical lamps in opposite
  corners, two clones of the same plant a meter apart — vary the silhouette.
- **The camera gets a vote on scale.** The book stack is 0.48 m, larger than
  life, because the honest 0.35 m read as specks at diorama distance. This is
  the *only* sanctioned exception to §5's real-world-size rule, and it belongs
  in the build spec with a comment saying why.
- **Check for occlusion illusions.** The scene is seen from one fixed angle.
  Two unrelated props that overlap from that angle become one prop to the
  viewer.

---

## 11. What the room does during a beat (`beat-animations.ts`)

Each of the six beats is a to-do, and the room acts it out. The strategy is
four rules, enforced in `beat-animations.ts` rather than remembered — the file
header is the long version; this is what you need before editing it.

**1. Beat-local time.** An animation is a pure function of `u`: 0 where its
beat's band starts, 1 where it ends, clamped outside. Never of global progress.
`beatLocalAt(t, focus)` derives the band from `STORY_BEATS`, so adding or
reordering a beat moves its animation with it and nothing needs re-tuning.

**2. Pure state, applied thinly.** Same split as `room-camera.ts`: these
functions return *what the room should show* and import no three.js, so they
are unit-tested without a canvas. `room-scene.tsx` lerps toward whatever they
say and holds no logic of its own.

**3. The act lands before the tick.** The decisive moment is `COMMIT_AT` (0.3),
under `TICK_AT` (0.4, in `story-beats.ts`). The wall is painted, the old set is
gone, *then* the card checks the line off — cause, then effect, readable at
scrolling speed. `beat-animations.test.ts` fails if the order flips.

`PAYOFF_AT` is the deliberate exception, and it equals `TICK_AT` rather than
sitting under it: a pop that *is* the reward for checking a line should land
with the check, not before it. It is a named constant precisely so the
asymmetry is a decision on the record instead of a number someone typed.

**4. Done stays done.** `u` clamps to 1 after the band, so a finished act holds
for the rest of the story. The spike cycled wall colors and snapped back bare —
"the indecision IS the animation" — which is the wrong story for a plan being
finished.

### The six acts

| Beat | `focus` | What the room does |
|---|---|---|
| capture | `room` | nothing; the establishing shot |
| scheduling | `swatches` | three chips cycle, one is chosen, **both walls** take it, the chips go |
| recurring | `plant` | leaves brown and droop across three rollovers, then rehydrate green |
| rollover | `couch` | the loveseat pops into the gap it was left out of |
| ambivalence | `shelf` | the books hesitate, then leave for the donation center |
| letting go | `tv` | the old set animates **out**, then the new one pops **in** |

### The curves

`popIn` and `popOut` are back-out curves — overshoot, then settle.

Two things about them are worth knowing before you write a third:

- **`popOut(p)` is exactly `popIn(1 - p)`.** Both expand to `1 - 3p³ + 2p²`.
  The doc comment used to claim they differed; a test disagreed at p = 0.744
  and the test was right. If you need a genuinely different exit, it has to be
  a different polynomial, not a reversed argument.
- **`smoothstep(p) + sin(smoothstep(p)·π)·0.12` cannot overshoot.** It looks
  like an overshoot and is not: it rises monotonically to exactly 1 and its
  derivative never reaches zero. That is why the pop is a back-out curve
  instead. The test that caught it failed with "expected 1 to be greater
  than 1".

### Adding an act

Add the state function here as a pure function of `u`; land the act by
`COMMIT_AT`; apply it in `room-scene.tsx` with a lerp and nothing else; add
the beat's row and framing per [HOMEPAGE.md §7](HOMEPAGE.md).

Nothing forces you to write one. A beat with no act still gets a camera move
and still ticks its line — the room just sits there while the card claims
something happened. That is the exact failure the four rules exist to prevent,
and it is the one case the type system cannot catch.

---

## 12. Traps

1. **`npm run build:static` prunes `.next/static/chunks`** even though it
   writes to `.next-static`. Measuring `.next` after `npm run verify` (which
   runs `build` *then* `build:static`) reports a lazily-imported library as
   0 KB — a measurement artifact, not a win. **Run `npm run build` immediately
   before measuring.**

2. **R3F v9 does not augment the global JSX namespace** — React 19 removed it.
   Without the `declare module "react"` block in `room-scene.tsx`, every
   `<mesh>` is a TS2339. The two narrow eslint disables beside it are forced by
   the shape of React 19's types; this is R3F's documented pattern verbatim.

3. **React Compiler's lint rules and R3F are structurally in tension.** R3F's
   model *is* imperative mutation of a scene graph inside `useFrame`.
   `react-hooks/immutability` fires on `useThree().camera`; moving the camera
   into a `useMemo` trips the same rule; a ref trips `react-hooks/refs`
   instead. Three attempts, three rules, worse code each time. Resolved with a
   **directory-scoped override** in `eslint.config.mjs` — if this code moves
   out of `src/components/scene/`, the override's `files` glob moves with it.

4. **three.js logs one `THREE.Clock` → `THREE.Timer` deprecation warning** from
   inside R3F. Not ours; it will clear on an R3F release.

5. **Interpolate with `(1 - t) * a + t * b`, not `a + (b - a) * t`.** The second
   form does not land exactly on `b` at `t = 1` in floating point — the camera
   settled ~1e-16 short of its final framing and never quite arrived. The room
   uses the first form everywhere. `card-travel.tsx` deliberately uses the
   second, because it interpolates pixel positions that are fully faded out at
   both ends; do not "unify" them.

6. **A curve that looks like an overshoot may not be one.** See §11 — one
   shipped that provably could not exceed 1, and the test caught it with
   "expected 1 to be greater than 1". Plot a candidate, or assert its peak, in
   preference to reading its shape off the algebra.

7. **A renamed to-do orphans the comment that reasoned about it.** The TV
   beat's split across the tick was justified in prose by the old wording
   ("Sell the old TV instead of moving it" — *selling* is the act). The line
   became "Upgrade TV" and the comment kept arguing from a name that no longer
   existed. Same failure mode as the "verified by render" entry in
   `.ai/lessons.md`: when a `STORY_BEATS` row changes, grep the scene for its
   old wording.

---

## 13. Status and what is next

The scene is **on the homepage** and the story around it is finished (EI-273,
merged to `main` 2026-09-07). `/spike-3d` is gone — the route, its
`PRIVATE_ROUTES` entry, and the throwaway premise with them — and
`src/components/spike/` became `src/components/scene/`, taking the eslint
override's `files` glob along.

`/` is the demanding home the spike was always measuring for: its entire
audience is a cold-cache first-time visitor, because `redirectIfKnownDevice`
sends everyone who has used the board before to `/board` ahead of paint. The
load invariants in **§2** are load-bearing now rather than exploratory.

Everything the sub-issues asked for shipped: per-beat camera framing (EI-276,
§11 and `room-camera.ts`), the live sub-task ticks (EI-278), and an act in the
room for every beat (EI-280, §11). `RoomStage` gained a `panel` slot for the
card pinned beside it and its stage is sticky at every width rather than `md:`
and up; nothing else about the load path changed from the spike.

Open work, in the order it should happen:

1. **Re-measure on the live deploy** with the real GLB. §3's frame numbers were
   taken against procedural boxes on localhost, and the room now animates five
   props and a camera on every frame rather than cycling one wall color. This
   is the one open item that could invalidate a number in this file.
2. **The room has no act for the first beat.** `focus: "room"` is the
   establishing shot, which is a deliberate choice and also the only beat where
   the card ticks a line while nothing moves. Worth revisiting if the opening
   ever reads as flat.
3. Consider Draco/meshopt compression if the GLB grows much past 371 KB. It is
   currently uncompressed indexed geometry; the dedupe in `indexGeometry`
   already took it from 455 KB.
