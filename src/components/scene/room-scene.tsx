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
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyRoomPalette, readRoomPalette } from "./room-materials";
import {
  CONTACT_SHADOWS,
  FISH,
  PRINTS,
  ROOM,
  STATIC_PROPS,
  SWATCHES,
  TV_NEW,
  TV_OLD,
  type PropPlacement,
} from "./room-layout";
import { framingAt } from "./room-camera";

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
function wallColourAt(t: number): string | null {
  if (t < 0.35 || t > 0.85) return null; // bare - the wall's own theme color
  const span = (t - 0.35) / 0.5;
  const n = SWATCHES.candidates.length;
  return SWATCHES.candidates[Math.min(n - 1, Math.floor(span * n))];
}

/** The TV is bought late. Before that the console holds the old set. */
function tvUpgradedAt(t: number): boolean {
  return t > 0.9;
}

// --- camera -----------------------------------------------------------------

/**
 * The camera, aimed at whatever the beat on screen is about (EI-276).
 *
 * `framingAt()` (`room-camera.ts`) turns scroll progress into a target, a zoom,
 * an angle and a height; this does nothing but follow it. The split is so the
 * interpolation can be unit-tested — no canvas, no WebGL context, no headless
 * GPU — while the part that cannot be tested that way stays four lines long.
 *
 * Everything is DAMPED toward the framing rather than set to it. Scroll
 * position is not continuous — a wheel notch or a trackpad flick jumps it — and
 * a camera that tracked those exactly would snap. Following at a fixed fraction
 * per frame turns each jump into a short glide, and it means the camera keeps
 * easing for a few frames after the scroll stops, which is what makes it read
 * as settling on the object rather than being dragged onto it.
 */
function Rig({ progress }: { progress: Progress }) {
  const { camera } = useThree();
  // Allocated once and mutated in place: `useFrame` runs at 60fps, and three
  // new Vector3s a frame is garbage the collector has to chase mid-scroll.
  const aim = useMemo(() => new THREE.Vector3(0, 1.0, 0), []);
  const wanted = useMemo(() => new THREE.Vector3(), []);
  /** How much of the remaining distance to close each frame. */
  const FOLLOW = 0.12;

  useFrame(() => {
    const orth = camera as THREE.OrthographicCamera;
    const framing = framingAt(progress.current);

    wanted.set(framing.target[0], framing.target[1], framing.target[2]);
    aim.lerp(wanted, FOLLOW);

    orth.zoom += (framing.zoom - orth.zoom) * FOLLOW;

    // The camera rides a circle around the room, so the angle is damped as a
    // scalar and the position derived from it — lerping the POSITION instead
    // would cut the chord and pull the camera in toward the room as it swings.
    const r = 14;
    const current = Math.atan2(orth.position.z, orth.position.x);
    const angle = current + (framing.angle - current) * FOLLOW;
    const height = orth.position.y + (framing.height - orth.position.y) * FOLLOW;

    orth.position.set(Math.cos(angle) * r, height, Math.sin(angle) * r);
    orth.lookAt(aim);
    orth.updateProjectionMatrix();
  });

  return null;
}

// --- the room shell ---------------------------------------------------------

type ShellPalette = { floor: string; wall: string; side: string; dark: boolean };

const SHELL_FALLBACK: ShellPalette = {
  floor: "#d6c1a1",
  wall: "#edeae3",
  side: "#e3dfd6",
  dark: false,
};

/**
 * The shell's colors come from the same `--room-*` tokens as the furniture.
 * They were hardcoded at first, and the screenshot that caught it was
 * incoherent in exactly the way you would predict: dark mode dimmed every
 * loaded prop while the floor and walls stayed at noon.
 */
function useShellPalette(): ShellPalette {
  const [palette, setPalette] = useState(SHELL_FALLBACK);

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
      setPalette({
        floor: token("--room-floor", SHELL_FALLBACK.floor),
        wall: token("--room-wall", SHELL_FALLBACK.wall),
        side: token("--room-wall-side", SHELL_FALLBACK.side),
        dark: document.documentElement.classList.contains("dark"),
      });
    };
    // rAF-deferred, same reasoning as the WebGL gate in room-stage.tsx: keeps
    // `react-hooks/set-state-in-effect` honest and lands after first paint.
    const id = requestAnimationFrame(read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, []);

  return palette;
}

/**
 * Floor and two walls. Procedural because they are boxes, and because the back
 * wall is the one surface whose color animates — it is the subject of the
 * beat, not scenery.
 */
function RoomShell({ progress }: { progress: Progress }) {
  const wall = useRef<THREE.MeshLambertMaterial>(null);
  const scratch = useMemo(() => new THREE.Color(), []);
  const palette = useShellPalette();

  // useFrame reads refs, never state - the palette flows in through one.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  useFrame(() => {
    if (!wall.current) return;
    const candidate = wallColourAt(progress.current);
    scratch.set(candidate ?? paletteRef.current.wall);
    // A candidate is a paint chip picked in daylight; on a dark-mode wall it
    // would glow. Dim the paint, not the chip - the swatches themselves stay
    // true, like real samples under a lamp.
    if (candidate && paletteRef.current.dark) scratch.multiplyScalar(0.62);
    wall.current.color.lerp(scratch, 0.09);
  });

  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const midY = ROOM.wallHeight / 2;

  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[ROOM.width, 0.1, ROOM.depth]} />
        {/* Light oak. Warm floor + cool couch is the room's one big contrast. */}
        <meshLambertMaterial color={palette.floor} />
      </mesh>

      {/* back wall — the one being painted */}
      <mesh position={[0, midY, -halfD - 0.06]}>
        <boxGeometry args={[ROOM.width, ROOM.wallHeight, 0.12]} />
        <meshLambertMaterial ref={wall} color={palette.wall} />
      </mesh>

      {/* side wall, stays neutral */}
      <mesh position={[-halfW - 0.06, midY, 0]}>
        <boxGeometry args={[0.12, ROOM.wallHeight, ROOM.depth]} />
        {/* A step darker than the back wall: two walls the same value read as
            one folded plane, and the corner disappears. */}
        <meshLambertMaterial color={palette.side} />
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
 * A gallery pair over the sitting area. Two quads each: a frame and a mat.
 * The library ships no wall art, so this is the gap filled by geometry.
 */
function Prints() {
  return (
    <group>
      {PRINTS.map((p, i) => (
        <group key={i} position={p.position}>
          <mesh>
            <planeGeometry args={p.size} />
            <meshLambertMaterial color="#4a443d" />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[p.size[0] - 0.06, p.size[1] - 0.06]} />
            <meshLambertMaterial color="#d9d2c6" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * Soft radial shadow under anything with mass. Flat-lit low-poly furniture
 * floats without grounding; a 128px canvas gradient shared across six quads is
 * the cheapest possible fix, and needs no texture asset. `depthWrite: false`
 * keeps the transparent quads from punching holes in each other.
 */
function ContactShadows() {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, "rgba(30, 26, 20, 0.32)");
    g.addColorStop(1, "rgba(30, 26, 20, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);

  return (
    <group>
      {CONTACT_SHADOWS.map((shadow, i) => (
        <mesh key={i} position={shadow.position} rotation-x={-Math.PI / 2}>
          <planeGeometry args={shadow.size} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
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
  const fish = useRef<THREE.Group>(null);

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

  // The ONLY thing scroll changes about the furniture. Everything else is
  // simply there, from the first frame - a room where furniture pops in reads
  // as a software demo, and this has to read as a place someone lives.
  useFrame(({ clock }) => {
    const upgraded = tvUpgradedAt(progress.current);
    if (oldTv.current) oldTv.current.visible = !upgraded;
    if (newTv.current) newTv.current.visible = upgraded;

    // The fish swims: a slow bob, clock-driven rather than scroll-driven -
    // the fish does not care what the human is doing, which is the joke.
    // Amplitude is millimetres; it must stay inside a 0.24 m bowl.
    if (fish.current) {
      fish.current.position.y = Math.sin(clock.elapsedTime * 1.3) * 0.014;
    }
  });

  return (
    <group>
      {STATIC_PROPS.map((p, i) => (
        // Index in the key: the same GLB node may legitimately be placed more
        // than once (Placed clones), so node names alone can collide.
        <Placed key={`${p.node}-${i}`} scene={scene} placement={p} />
      ))}

      <group ref={oldTv}>
        <Placed scene={scene} placement={TV_OLD} />
      </group>
      <group ref={newTv} visible={false}>
        <Placed scene={scene} placement={TV_NEW} />
      </group>
      {/* The group takes the bob; Placed owns the placement. */}
      <group ref={fish}>
        <Placed scene={scene} placement={FISH} />
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
      {/* Hemisphere carries most of the fill: warm bounce from the floor,
          cool from above, which is what daylight in a real room does. The key
          comes from the window side so every face the camera sees is lit
          slightly differently - even shading is what made the first pass flat. */}
      <hemisphereLight args={["#fdf6ec", "#c9b394", 0.9]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 3]} intensity={1.5} />
      <directionalLight position={[-4, 6, -6]} intensity={0.4} />

      <Rig progress={progress} />
      <RoomShell progress={progress} />
      <ContactShadows />
      <Swatches />
      <Prints />

      <PropsBoundary>
        <Suspense fallback={null}>
          <LivingRoomProps progress={progress} />
        </Suspense>
      </PropsBoundary>
    </Canvas>
  );
}
