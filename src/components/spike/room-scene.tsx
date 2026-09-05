"use client";

/**
 * EI-272 — the living room.
 *
 * Loads `public/scene/living-room.glb` (built by `scripts/scene/build-room.mjs`
 * from the vendored CC0/CC-BY sources in `assets/scene/`) and places its named
 * nodes according to `room-layout.ts`. The room shell, the paint swatches and
 * the framed prints stay procedural — the asset library has no wall art of any
 * kind, and a painted rectangle is a painted rectangle.
 *
 * THE RULE THIS FILE STILL EXISTS TO DEMONSTRATE: scroll drives the camera
 * through a ref that `useFrame` reads, never through React state. A `setState`
 * per scroll event would re-render the tree at 60fps and put the INP budget
 * straight into the bin. React renders this scene once.
 *
 * If the GLB is missing — nobody has vendored the sources yet, or the fetch
 * fails — `RoomShell` alone still renders and the page still tells its story.
 * That is deliberate: the scene degrades to a bare room rather than to a blank
 * canvas.
 */

import { Canvas, useFrame, useLoader, useThree, type ThreeElements } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyRoomPalette, readRoomPalette } from "./room-materials";
import {
  PRINTS,
  ROOM,
  SHELF_PROPS,
  STATIC_PROPS,
  SWATCHES,
  TV_NEW,
  TV_OLD,
  type PropPlacement,
} from "./room-layout";

declare module "react" {
  // Both disables are forced by the shape of React 19's JSX types: the
  // augmentation target IS a namespace, and the interface IS a pure re-export
  // of ThreeElements. This is R3F v9's documented pattern verbatim.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}

/** Scroll progress 0..1, written by the scroll listener, read by useFrame. */
export type Progress = { current: number };

const SCENE_URL = "/scene/living-room.glb";

/**
 * Maps 0..1 scroll progress onto the beat.
 *
 * 0.00-0.35  wide isometric, bare wall, three swatches
 * 0.35-0.85  push in; the wall cycles through the candidates
 * 0.85-1.00  snap back to bare. The indecision IS the animation.
 */
function wallColourAt(t: number): string {
  if (t < 0.35 || t > 0.85) return SWATCHES.bareWall;
  const span = (t - 0.35) / 0.5;
  const n = SWATCHES.candidates.length;
  return SWATCHES.candidates[Math.min(n - 1, Math.floor(span * n))];
}

/** The TV is bought late. Before that the console holds the old set. */
function tvUpgradedAt(t: number): boolean {
  return t > 0.9;
}

// --- camera -----------------------------------------------------------------

function Rig({ progress }: { progress: Progress }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 1.0, 0), []);

  useFrame(() => {
    const t = progress.current;
    const orth = camera as THREE.OrthographicCamera;

    // Orthographic zoom is the isometric equivalent of a dolly-in. The range is
    // deliberately narrow: the first spike pushed 52 -> 132 and by the end of
    // the beat the walls and floor were cropped off every edge, which loses the
    // room. A diorama has to stay a diorama - the payoff is a finished ROOM, and
    // you cannot read that through a keyhole.
    const zoom = THREE.MathUtils.lerp(84, 116, THREE.MathUtils.smoothstep(t, 0, 0.9));
    orth.zoom += (zoom - orth.zoom) * 0.12;

    // Drift a few degrees around the room so the push-in has parallax rather
    // than reading as a flat scale.
    const angle = Math.PI / 4 + t * 0.2;
    const r = 14;
    orth.position.set(Math.cos(angle) * r, 9.5 - t * 1.2, Math.sin(angle) * r);
    orth.lookAt(target);
    orth.updateProjectionMatrix();
  });

  return null;
}

// --- the room shell ---------------------------------------------------------

/**
 * Floor and two walls. Procedural because they are boxes, and because the back
 * wall is the one surface whose colour animates — it is the subject of the
 * beat, not scenery.
 */
function RoomShell({ progress }: { progress: Progress }) {
  const wall = useRef<THREE.MeshLambertMaterial>(null);
  const scratch = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!wall.current) return;
    scratch.set(wallColourAt(progress.current));
    wall.current.color.lerp(scratch, 0.09);
  });

  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const midY = ROOM.wallHeight / 2;

  return (
    <group>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[ROOM.width, 0.1, ROOM.depth]} />
        <meshLambertMaterial color="#c8b49a" />
      </mesh>

      {/* back wall — the one being painted */}
      <mesh position={[0, midY, -halfD - 0.06]}>
        <boxGeometry args={[ROOM.width, ROOM.wallHeight, 0.12]} />
        <meshLambertMaterial ref={wall} color={SWATCHES.bareWall} />
      </mesh>

      {/* side wall, stays neutral */}
      <mesh position={[-halfW - 0.06, midY, 0]}>
        <boxGeometry args={[0.12, ROOM.wallHeight, ROOM.depth]} />
        <meshLambertMaterial color="#dcd8d1" />
      </mesh>
    </group>
  );
}

/** The three swatches. The whole point of the beat. */
function Swatches() {
  const { candidates, size, gap, origin } = SWATCHES;
  return (
    <group>
      {candidates.slice(0, 3).map((c, i) => (
        <mesh
          key={c}
          position={[origin[0] + i * (size + gap), origin[1], origin[2]]}
        >
          <planeGeometry args={[size, size]} />
          <meshLambertMaterial color={c} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Framed prints, taken down in beat 5. Two quads each: a border and a face.
 * The library ships no wall art, so this is the gap filled by geometry.
 */
function Prints({ progress }: { progress: Progress }) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!group.current) return;
    group.current.visible = progress.current < 0.45;
  });

  return (
    <group ref={group}>
      {PRINTS.map((p, i) => (
        <group key={i} position={p.position}>
          <mesh>
            <planeGeometry args={p.size} />
            <meshLambertMaterial color="#6b5f52" />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[p.size[0] - 0.07, p.size[1] - 0.07]} />
            <meshLambertMaterial color="#b9b0a4" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// --- the loaded props -------------------------------------------------------

function Placed({
  scene,
  placement,
}: {
  scene: THREE.Group;
  placement: PropPlacement;
}) {
  // Cloned so the same GLB node can be placed more than once, and so React
  // remounting this subtree never reparents a node out from under another.
  const object = useMemo(() => {
    const found = scene.getObjectByName(placement.node);
    return found ? found.clone(true) : null;
  }, [scene, placement.node]);

  if (!object) return null;
  return (
    <primitive
      object={object}
      position={placement.position}
      rotation-y={placement.rotationY ?? 0}
    />
  );
}

function LivingRoomProps({ progress }: { progress: Progress }) {
  const gltf = useLoader(GLTFLoader, SCENE_URL);
  const scene = gltf.scene as THREE.Group;

  const oldTv = useRef<THREE.Group>(null);
  const newTv = useRef<THREE.Group>(null);
  const shelves = useRef<THREE.Group>(null);

  // Re-tint from design tokens, and again whenever the theme class changes.
  // `applyRoomPalette` walks the scene once; this is never per-frame.
  useEffect(() => {
    const paint = () => applyRoomPalette(scene, readRoomPalette());
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-font"],
    });
    return () => observer.disconnect();
  }, [scene]);

  useFrame(() => {
    const t = progress.current;
    const upgraded = tvUpgradedAt(t);
    if (oldTv.current) oldTv.current.visible = !upgraded;
    if (newTv.current) newTv.current.visible = upgraded;
    // The shelves go up in beat 5 and stay up.
    if (shelves.current) shelves.current.visible = t > 0.4;
  });

  return (
    <group>
      {STATIC_PROPS.map((p) => (
        <Placed key={p.node} scene={scene} placement={p} />
      ))}

      <group ref={shelves}>
        {SHELF_PROPS.map((p) => (
          <Placed key={p.node} scene={scene} placement={p} />
        ))}
      </group>

      <group ref={oldTv}>
        <Placed scene={scene} placement={TV_OLD} />
      </group>
      <group ref={newTv} visible={false}>
        <Placed scene={scene} placement={TV_NEW} />
      </group>
    </group>
  );
}

/**
 * If the GLB is absent the room should still be a room.
 *
 * A missing asset is the normal state on a fresh clone until `npm run scene`
 * has run, and a hard failure there would take the whole canvas — and with it
 * the story — down with it. React needs a class for this; there is no hook
 * form of `componentDidCatch`.
 */
class PropsBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// --- entry point ------------------------------------------------------------

export default function RoomScene({ progress }: { progress: Progress }) {
  return (
    <Canvas
      orthographic
      camera={{ position: [10, 9.5, 10], zoom: 78, near: -100, far: 400 }}
      // No antialias: this is a flat-shaded diorama, and AA costs fill rate on
      // exactly the mid-range mobile GPUs the budget is written against.
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      dpr={[1, 1.75]}
    >
      <ambientLight intensity={1.35} />
      <directionalLight position={[8, 12, 6]} intensity={1.8} />
      <directionalLight position={[-8, 5, -4]} intensity={0.45} />

      <Rig progress={progress} />
      <RoomShell progress={progress} />
      <Swatches />
      <Prints progress={progress} />

      <PropsBoundary>
        <Suspense fallback={null}>
          <LivingRoomProps progress={progress} />
        </Suspense>
      </PropsBoundary>
    </Canvas>
  );
}
