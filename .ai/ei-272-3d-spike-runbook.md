# EI-272 — 3D homepage scene spike

**Superseded by `docs/SCENE.md`** — that is the standing procedure; this file
is kept as the point-in-time record of the measurements below and the
reasoning that produced them.

Written as a throwaway on the premise that nothing on this branch would ship.
That premise did not survive: the spike answered its question, the room was
then designed over five review rounds, and `/spike-3d` ships deliberately so
§"Results" can be re-measured on real hardware. Read `docs/RESEARCH.md` §1 for
why the scene exists at all.

**Verdict: the architecture holds. Proceed to Tier 3 (three.js), with the two
guards below made permanent.**

---

## What was built

One beat of the homepage story — the wall-colour push-in — behind a throwaway
route at `/spike-3d`.

| File | Role |
|---|---|
| `src/app/spike-3d/page.tsx` | Server Component. Headline + 5 beats of real research copy. No client JS. |
| `src/components/spike/room-stage.tsx` | The pinned stage. Lazy-loads the canvas, owns the scroll listener, renders the flat fallback. **The actual subject of the spike.** |
| `src/components/spike/room-scene.tsx` | R3F scene: room shell, three paint swatches, coffee table, orthographic push-in rig. |
| `src/components/spike/webgl.ts` | Capability + reduced-motion probe. |
| `scripts/spike/measure-page.mjs` | Gzipped weight of everything a prerendered page references. |
| `scripts/spike/measure-deferred.mjs` | Splits three.js chunks into eager vs lazy. |

Geometry is procedural boxes, not the baked GLB the real scene ships. The
question this spike answers is **JS cost and load architecture**; asset weight
is a separate measurement against real Blender output.

Deps added: `three@0.185.1`, `@react-three/fiber@9.7.0`, `@types/three`.
**No drei** — a hand-rolled scroll rig is ~20 lines and keeps the floor honest.

---

## Results against the acceptance criteria

| Criterion | Budget | Measured | |
|---|---|---|---|
| LCP, 4x CPU + Slow 4G, 412x915 mobile | ≤ 2500 ms | **932 ms** | PASS |
| CLS | — | **0.00** | PASS |
| LCP depends on the 3D chunk | must not | **LCP node is the server-rendered headline** | PASS |
| three.js eager (before paint) | 0 KB | **0.0 KB** | PASS |
| three.js lazy (after paint) | budget the payload | **227.7 KB gz / 864.8 KB raw** | as predicted |
| `/` homepage weight | unchanged | **340.1 → 340.6 KB gz** (+0.5 KB, from the `site.ts` row) | PASS |
| three.js in the desktop app-shell bundle | 0 chunks | **0 chunks** (was 1 before the guard) | PASS |
| `npm run verify` | green | **exit 0, 151 files, 2341 tests** | PASS |
| Scroll frame cost, 4x throttled | no dropped frames | **median 8.3 ms, p95 9.5 ms, 0 frames > 33 ms** | PASS |
| Reduced-motion / no-WebGL fallback | tells the story | **0 canvases, static swatch panel renders** | PASS |

Two honest caveats. **TTFB was 6 ms because the server was localhost** — a real
deploy adds a round trip, though render delay (926 ms of the 932) is what the JS
weight actually moves. And **the scroll frame numbers flatter us**: a dozen
untextured boxes is not the real scene. Baking keeps the GPU cost flat, but
re-measure once the GLB exists.

**INP was not measured and is not meaningful here** — the page has no tap
targets, and scroll is not an INP interaction. Frame cost above is the real
proxy.

---

## The two guards that must survive into the real homepage

### 1. The app-shell build must never contain three.js

Before the guard, `npm run build:static` shipped **864.8 KB raw of three.js into
`.next-static`** — the bundle that becomes the Tauri desktop app's hot-asset
payload, in a build where `/` returns only a redirect script and the canvas can
never run. Dead weight that every installed client re-downloads (see the EI-255
note in `next.config.ts` on why bundle identity is size-sensitive).

The fix, in `room-stage.tsx`:

```ts
const IS_APP_SHELL = process.env.NEXT_PUBLIC_APP_SHELL === "1";
const RoomScene = IS_APP_SHELL
  ? () => null
  : dynamic(() => import("./room-scene"), { ssr: false, loading: () => null });
```

`NEXT_PUBLIC_*` is inlined at build time, so the comparison folds to a literal
and the bundler drops the `import()` in the dead branch. `.next-static` went
15M → 14M. **Make this an asserted test, not a convention.**

### 2. Copy paints before the canvas is requested

The headline is a Server Component; the WebGL probe runs in a
`requestAnimationFrame` inside an effect, so the chunk is requested strictly
after first paint. That is why 227 KB of three.js costs 0 ms of LCP.

Scroll writes to a **ref** read by `useFrame`, never to React state. React
renders the scene once.

---

## Three traps, for whoever picks this up

1. **`npm run build:static` prunes `.next/static/chunks`** even though it writes
   to `.next-static`. So measuring `.next` after `npm run verify` (build, *then*
   build:static) reports a lazily-imported library as 0 KB. That is a
   measurement artefact, not a win. **Run `npm run build` immediately before
   measuring.** Documented in the script header.

2. **R3F v9 does not augment the global JSX namespace** — React 19 removed it.
   Without the `declare module "react"` block in `room-scene.tsx`, every
   `<mesh>` is a TS2339. Two narrow eslint disables come with it; both are
   forced by the shape of React 19's types.

3. **React Compiler's lint rules and R3F are structurally in tension.** R3F's
   model is imperative mutation of a scene graph inside `useFrame` — that is the
   API, not a shortcut. `react-hooks/immutability` fires on
   `useThree().camera`; owning the camera in a `useMemo` trips the same rule;
   owning it in a ref trips `react-hooks/refs` instead. Three attempts, three
   rules, worse code each time. Resolved with a **directory-scoped** override in
   `eslint.config.mjs`, following the existing Playwright precedent. If the
   scene ships, that override moves to its real directory with its comment.

---

## Known rough edges (cosmetic, not architectural)

- The push-in overshoots: by the end of the beat the camera is close enough that
  the swatches leave frame and the composition is mostly floor. Tuning, not
  structure.
- three.js logs one deprecation warning (`THREE.Clock` → `THREE.Timer`) from
  inside R3F. Not ours; will clear on an R3F release.

---

## Next

1. Decide the real budget now that the floor is known: 227.7 KB gz of JS before
   a single asset byte.
2. Model the room in Blender from CC0 kits, bake one lighting setup, export GLB
   (Draco/meshopt), and **re-measure** with the real asset.
3. Turn both guards into asserted tests.
4. Delete `/spike-3d`, `src/components/spike/`, and the eslint override — or
   move them, deliberately, to the real homepage.
