"use client";

/**
 * EI-272 spike - beat 2/3 of the homepage story: the wall-colour push-in.
 *
 * Everything here is throwaway. The geometry is procedural boxes, not the
 * baked GLB the real scene will ship, because the question this spike answers
 * is the JS cost and the load architecture - asset weight is a separate
 * measurement taken against real Blender output.
 *
 * THE ONE RULE THIS FILE EXISTS TO DEMONSTRATE: scroll drives the camera
 * through a ref that `useFrame` reads, never through React state. A
 * `setState` per scroll event would re-render the tree at 60fps and put the
 * INP budget straight into the bin. React renders this scene once.
 */

import { Canvas, useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

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

/** The candidate wall colours the beat cycles through, then abandons. */
const CANDIDATES = ["#c8ccc4", "#d8c3a5", "#a8b8c8", "#c9a9a6"] as const;
const BARE_WALL = "#e8e4dd";

/**
 * Maps 0..1 scroll progress onto the beat.
 *
 * 0.00-0.35  wide isometric, bare wall, three swatches
 * 0.35-0.85  push in; the wall cycles through the candidates
 * 0.85-1.00  snap back to bare. The indecision IS the animation.
 */
function wallColourAt(t: number): string {
  if (t < 0.35 || t > 0.85) return BARE_WALL;
  const span = (t - 0.35) / 0.5;
  return CANDIDATES[Math.min(CANDIDATES.length - 1, Math.floor(span * CANDIDATES.length))];
}

function Rig({ progress }: { progress: Progress }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 1.1, 0), []);

  useFrame(() => {
    const t = progress.current;
    const orth = camera as THREE.OrthographicCamera;

    // Orthographic zoom is the isometric equivalent of a dolly-in.
    const zoom = THREE.MathUtils.lerp(52, 132, THREE.MathUtils.smoothstep(t, 0, 0.9));
    orth.zoom += (zoom - orth.zoom) * 0.12;

    // Drift a few degrees around the room so the push-in has parallax rather
    // than reading as a flat scale.
    const angle = Math.PI / 4 + t * 0.22;
    const r = 12;
    orth.position.set(Math.cos(angle) * r, 8.5 - t * 2.2, Math.sin(angle) * r);
    orth.lookAt(target);
    orth.updateProjectionMatrix();
  });

  return null;
}

function Room({ progress }: { progress: Progress }) {
  const wall = useRef<THREE.MeshLambertMaterial>(null);
  const scratch = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!wall.current) return;
    scratch.set(wallColourAt(progress.current));
    wall.current.color.lerp(scratch, 0.09);
  });

  const legs: [number, number][] = [
    [-0.4, 0.7],
    [1.6, 0.7],
    [-0.4, 1.7],
    [1.6, 1.7],
  ];

  return (
    <group>
      {/* floor */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[9, 0.1, 9]} />
        <meshLambertMaterial color="#b9a48c" />
      </mesh>

      {/* back wall - the one being painted */}
      <mesh position={[0, 2.2, -4.5]}>
        <boxGeometry args={[9, 4.5, 0.12]} />
        <meshLambertMaterial ref={wall} color={BARE_WALL} />
      </mesh>

      {/* side wall, stays neutral */}
      <mesh position={[-4.5, 2.2, 0]}>
        <boxGeometry args={[0.12, 4.5, 9]} />
        <meshLambertMaterial color="#dcd8d1" />
      </mesh>

      {/* the three swatches: the whole point of the beat */}
      {CANDIDATES.slice(0, 3).map((c, i) => (
        <mesh key={c} position={[-1.5 + i * 1.5, 2.4, -4.42]}>
          <boxGeometry args={[1.05, 1.05, 0.02]} />
          <meshLambertMaterial color={c} />
        </mesh>
      ))}

      {/* coffee table - the item that never gets refinished */}
      <mesh position={[0.6, 0.45, 1.2]}>
        <boxGeometry args={[2.4, 0.16, 1.2]} />
        <meshLambertMaterial color="#8a6f52" />
      </mesh>
      {legs.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.19, z]}>
          <boxGeometry args={[0.14, 0.38, 0.14]} />
          <meshLambertMaterial color="#7a6047" />
        </mesh>
      ))}
    </group>
  );
}

export default function RoomScene({ progress }: { progress: Progress }) {
  return (
    <Canvas
      orthographic
      camera={{ position: [8.5, 8.5, 8.5], zoom: 52, near: -100, far: 200 }}
      // No antialias: this is a flat-shaded diorama, and AA costs fill rate on
      // exactly the mid-range mobile GPUs the budget is written against.
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      dpr={[1, 1.75]}
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[6, 10, 4]} intensity={1.9} />
      <directionalLight position={[-6, 4, -3]} intensity={0.5} />
      <Rig progress={progress} />
      <Room progress={progress} />
    </Canvas>
  );
}
