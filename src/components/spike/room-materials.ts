/**
 * EI-272 — re-tint the room from design tokens.
 *
 * The whole asset library shares a 31-name semantic material palette
 * (`Wood`, `White`, `Grey`, `Plant_Green`, `Couch_Blue`, ...) and carries NO
 * TEXTURES - every material is a flat colour. That is what makes this file
 * possible: instead of baking one look into the GLB, the scene reads its
 * colours from CSS custom properties at runtime.
 *
 * Which matters for a specific reason. The visual design system is in flight
 * (EI-265/267/271), and the homepage story has to be written against tokens
 * rather than colours. A baked render would need re-exporting every time the
 * palette moved, and could not follow light/dark at all. This walks the loaded
 * scene once and assigns.
 *
 * Anything not in the map below keeps the colour baked into the GLB, so an
 * unmapped material is a slightly-off prop, never an invisible one.
 */

import type { Object3D, Mesh, MeshStandardMaterial } from "three";
import { Color } from "three";

/**
 * Material name -> CSS custom property.
 *
 * Exactly the materials `living-room.glb` contains, no more — a speculative
 * mapping for a material that never ships is a token nobody can see drift.
 * The `Couch_*`, `Rug_*` and `Curtain_*` names are namespaced by
 * `build-room.mjs`, because the kit paints the couch and the rug with the
 * same `DarkRed` — shared names mean shared colours, and a blue couch must
 * not force a blue rug.
 *
 * The `mat*` names on the two televisions are deliberately absent: those are
 * the sets' own liveries from a different author, and a CRT should look like
 * a CRT in any theme.
 */
export const MATERIAL_TOKENS: Record<string, string> = {
  // Kit-wide semantics.
  White: "--room-white",
  Grey: "--room-grey",
  Black: "--room-black",
  Brown: "--room-brown",
  Wood: "--room-wood",
  Metal: "--room-metal",
  LightMetal: "--room-metal-light",
  Glass: "--room-glass",
  Light: "--room-light",
  Plant_Green: "--room-plant",
  DarkGreen: "--room-plant-dark",
  LightOrange: "--room-terracotta",
  Wood_Dark: "--room-wood-dark",
  Wood_Light: "--room-wood-light",
  // Namespaced per piece.
  Couch_Main: "--room-couch",
  Couch_Base: "--room-couch-base",
  Loveseat_Main: "--room-loveseat",
  Rug_Main: "--room-rug",
  Rug_Trim: "--room-rug-trim",
  Curtain_Main: "--room-curtain",
};

/**
 * Reads the resolved value of each token once.
 *
 * `getComputedStyle` is a forced style resolution, so this is deliberately
 * called once per theme change and never per frame. Twenty-five reads batched
 * together resolve style once; twenty-five reads spread across a frame loop
 * would thrash it.
 */
export function readRoomPalette(el: HTMLElement = document.documentElement) {
  const style = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const [material, token] of Object.entries(MATERIAL_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) out[material] = value;
  }
  return out;
}

/**
 * Walks the scene and re-tints every material whose name is in the palette.
 *
 * Materials are shared across meshes by the loader, so the same instance can
 * be visited repeatedly - `seen` keeps that to one assignment each. Names come
 * straight from the OBJ `newmtl` declarations, preserved through
 * `scripts/scene/build-room.mjs`; renaming a material there silently unhooks
 * it from its token here, which is why that script says not to.
 */
export function applyRoomPalette(
  root: Object3D,
  palette: Record<string, string>,
) {
  const seen = new Set<string>();
  const scratch = new Color();

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const raw of materials) {
      const material = raw as MeshStandardMaterial;
      if (!material?.name || seen.has(material.uuid)) continue;
      seen.add(material.uuid);

      const value = palette[material.name];
      if (!value) continue; // unmapped: keep the GLB's own colour

      try {
        scratch.setStyle(value);
        material.color.copy(scratch);
      } catch {
        // An unparseable token is a design-system bug, not a render bug.
        // Keeping the baked colour is the right failure.
      }
    }
  });
}
