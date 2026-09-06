/**
 * EI-272 — build the homepage story scene.
 *
 * Reads the vendored OBJ/MTL sources in `assets/scene/models/` and writes one
 * merged `public/scene/living-room.glb` with a named node per prop.
 *
 * Pure Node, no Blender. That is a deliberate choice, not a shortcut: these
 * models are 60-750 faces each with NO TEXTURES ANYWHERE - every material is a
 * flat `Kd` colour - so the conversion is a few hundred lines of arithmetic,
 * and keeping it dependency-free means `npm run scene` works in CI and on any
 * machine rather than only on one with a 1 GB app installed.
 *
 * Three normalisations happen here so that placement code downstream can treat
 * every prop identically:
 *
 *  1. **Orientation.** Each model is rotated so its front faces +Z. The sources
 *     disagree wildly - `new-tv`'s screen is a zero-thickness plane on the X
 *     axis, `old-tv` faces -Z, the Quaternius kit faces +Z already.
 *  2. **Scale.** Each model is scaled to a target real-world size in METRES.
 *     The kit is roughly 0.4 m per unit and the two TVs are in unrelated units,
 *     so there is no single factor to apply - only a per-model target.
 *  3. **Origin.** Each model is centred on X/Z and sits on Y=0. The kit is
 *     ground-aligned but the TVs are centre-origin (`Ymin` about -0.21), which
 *     would otherwise bury half the set in the shelf.
 *
 * Material NAMES are preserved (`Wood`, `White`, `Plant_Green`, ...). The whole
 * kit shares a 31-name palette, which is what lets `room-materials.ts` re-tint
 * the entire room from design tokens at runtime. Do not merge them — but a
 * model MAY namespace its materials via `rename`, and sometimes must: the kit
 * gives the couch and the rug the same `DarkRed`, which makes it impossible to
 * tint a blue couch onto a neutral rug. Namespacing (`DarkRed` -> `Couch_Base`)
 * keeps the semantics while giving each piece of furniture its own token.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "assets", "scene", "models");
const OUT = join(ROOT, "public", "scene", "living-room.glb");

/**
 * The cast. `size` is the target size in METRES of the axis named by `fit`,
 * measured AFTER `rotateY`. `rotateY` is in degrees and is applied first, to
 * bring the model's front round to +Z.
 *
 * Sizes are real-world, so they are arguable in a way the rest of this file is
 * not - a 2.1 m couch and a 1.3 m console are choices. Change them here rather
 * than scaling at placement time, or the scene stops being in metres and every
 * later position becomes a magic number.
 */
const SCENE_MODELS = [
  // --- the story cast -----------------------------------------------------
  { node: "shelf_console", file: "Shelf_Small1.obj", fit: "x", size: 1.3 },
  // "Featured Content" by Kell Condon, CC-BY. Stays deliberately small: it
  // should look lost on the console. That empty space is the story beat.
  { node: "tv_old", file: "old-tv.obj", fit: "x", size: 0.55, rotateY: 180 },
  // "TV" by Jarlan Perez, CC-BY. Screen is a flat plane on X, so 90 degrees
  // brings it round to face the room.
  { node: "tv_new", file: "new-tv.obj", fit: "x", size: 1.1, rotateY: 90 },
  // Fit by HEIGHT. Fit by width this model is 0.53 m tall - dining height. A
  // coffee table sits at ~0.42 m, below the couch seat, or the whole seating
  // zone reads out of scale.
  { node: "coffee_table", file: "Table_RoundSmall.obj", fit: "y", size: 0.42 },
  { node: "houseplant", file: "Houseplant_1.obj", fit: "y", size: 1.15 },
  // Shelf_Small2/3, NOT Shelf_1/2 — those are floor-standing bookcases with a
  // height/width ratio near 4, so fitting them by width produced a 4.5 m tower.
  // The `_Small` pair are the actual wall shelves (ratio 0.38).
  { node: "wall_shelf_a", file: "Shelf_Small2.obj", fit: "x", size: 0.9 },
  { node: "wall_shelf_b", file: "Shelf_Small3.obj", fit: "x", size: 0.9 },

  // --- dressing -----------------------------------------------------------
  // The kit paints this couch with the same `Red`/`DarkRed` it uses on the
  // rug, so they are namespaced apart or a blue couch forces a blue rug.
  {
    node: "couch",
    file: "Couch_Large1.obj",
    fit: "x",
    size: 2.1,
    rename: { Red: "Couch_Main", DarkRed: "Couch_Base" },
  },
  // Carpet_2 is near-square (z/x = 1.03); Carpet_1 is 1.45 deep per unit wide
  // and ran halfway across the room once scaled.
  {
    node: "rug",
    file: "Carpet_2.obj",
    fit: "x",
    size: 2.6,
    rename: { DarkRed: "Rug_Main", LightOrange: "Rug_Trim" },
  },
  { node: "floor_lamp", file: "Light_Floor1.obj", fit: "y", size: 1.5 },
  { node: "window", file: "Window_Large1.obj", fit: "x", size: 1.4 },
  // Double, not Single: two panels either side of the window instead of one
  // drape covering half the glass. Fit by HEIGHT - the source is 1.25x taller
  // than wide and by-width put it at 4.3 m in a 2.7 m room. The kit colours
  // curtains `Couch_Blue`; namespaced so linen curtains don't demand a blue
  // couch.
  {
    node: "curtains",
    file: "Curtains_Double.obj",
    fit: "y",
    size: 2.25,
    rename: { Couch_Blue: "Curtain_Main" },
  },
  { node: "door", file: "Door_1.obj", fit: "y", size: 2.0 },
  // A cube-ish nightstand reads as a modern side table at side-table scale.
  // It replaces the stool, which stood alone in the middle of the floor with
  // no job - real rooms don't have furniture without a reason.
  { node: "side_table", file: "NightStand_1.obj", fit: "x", size: 0.48 },
  // Console styling. A television alone on 1.3 m of console is a showroom;
  // a small plant next to it is a home.
  { node: "plant_small", file: "Houseplant_2.obj", fit: "y", size: 0.32 },
];

// --- OBJ + MTL parsing ------------------------------------------------------

/** `newmtl NAME` / `Kd r g b` -> { NAME: [r, g, b] }. Colours only; no maps. */
function parseMtl(path) {
  const out = {};
  if (!existsSync(path)) return out;
  let cur = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "newmtl") {
      cur = p.slice(1).join(" ");
      out[cur] = [0.8, 0.8, 0.8];
    } else if (p[0] === "Kd" && cur) {
      out[cur] = [Number(p[1]), Number(p[2]), Number(p[3])];
    }
  }
  return out;
}

/**
 * Returns { groups: Map<materialName, {positions:[], normals:[]}> } as
 * non-indexed triangle soup.
 *
 * Non-indexed on purpose: at 60-750 faces per model the buffer saving from
 * indexing is worth less than the bookkeeping, and OBJ's separate position and
 * normal indices do not map onto a single glTF index buffer without
 * de-duplicating vertex tuples anyway. N-gons are fan-triangulated. Where a
 * face carries no normal index the flat face normal is computed, which is the
 * correct look for this art style regardless.
 */
function parseObj(path) {
  const V = [];
  const N = [];
  const groups = new Map();
  let cur = "Default";

  const ensure = (m) => {
    if (!groups.has(m)) groups.set(m, { positions: [], normals: [] });
    return groups.get(m);
  };

  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const p = line.split(/\s+/);

    if (p[0] === "v") V.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === "vn") N.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === "usemtl") cur = p.slice(1).join(" ") || "Default";
    else if (p[0] === "f") {
      const verts = p.slice(1).map((tok) => {
        const [vi, , ni] = tok.split("/");
        const vIdx = Number(vi);
        const nIdx = ni ? Number(ni) : 0;
        return {
          v: V[vIdx > 0 ? vIdx - 1 : V.length + vIdx],
          n: nIdx ? N[nIdx > 0 ? nIdx - 1 : N.length + nIdx] : null,
        };
      });
      if (verts.some((x) => !x.v)) continue;

      const g = ensure(cur);
      for (let i = 1; i < verts.length - 1; i++) {
        const tri = [verts[0], verts[i], verts[i + 1]];
        const flat = faceNormal(tri[0].v, tri[1].v, tri[2].v);
        for (const { v, n } of tri) {
          g.positions.push(v[0], v[1], v[2]);
          const nn = n ?? flat;
          g.normals.push(nn[0], nn[1], nn[2]);
        }
      }
    }
  }
  return groups;
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

// --- normalisation ----------------------------------------------------------

/** Rotate about Y in place, degrees. Applied before measuring, so `fit` refers
 *  to the axis you can actually see in the finished scene. */
function rotateY(groups, deg) {
  if (!deg) return;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  for (const g of groups.values()) {
    for (const arr of [g.positions, g.normals]) {
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i];
        const z = arr[i + 2];
        arr[i] = c * x + s * z;
        arr[i + 2] = -s * x + c * z;
      }
    }
  }
}

/** Scale to `size` metres on `fit`, centre on X/Z, and sit on Y=0. */
function normalise(groups, fit, size) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const g of groups.values()) {
    for (let i = 0; i < g.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const val = g.positions[i + a];
        if (val < lo[a]) lo[a] = val;
        if (val > hi[a]) hi[a] = val;
      }
    }
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const axis = { x: 0, y: 1, z: 2 }[fit];
  const scale = size / (span[axis] || 1);

  const cx = (lo[0] + hi[0]) / 2;
  const cz = (lo[2] + hi[2]) / 2;
  for (const g of groups.values()) {
    for (let i = 0; i < g.positions.length; i += 3) {
      g.positions[i] = (g.positions[i] - cx) * scale;
      g.positions[i + 1] = (g.positions[i + 1] - lo[1]) * scale;
      g.positions[i + 2] = (g.positions[i + 2] - cz) * scale;
    }
  }
  return span.map((s) => +(s * scale).toFixed(3));
}

// --- indexing ---------------------------------------------------------------

/**
 * Collapses the triangle soup from `parseObj` into an indexed mesh.
 *
 * Flat-shaded low-poly geometry shares a *lot* of vertices - a cube face is two
 * triangles over four corners, and every corner of every box repeats its
 * position and normal three or six times. Non-indexed, the whole room came to
 * 455 KB; the dedupe below takes roughly half of that back for about twenty
 * lines, which is the best ratio available here short of quantising.
 *
 * The key is position AND normal together, never position alone: merging two
 * vertices that share a corner but face different directions would smooth the
 * seam and turn a crisp low-poly box into a soft blob. That is the whole look.
 */
function indexGeometry(group) {
  const positions = [];
  const normals = [];
  const indices = [];
  const seen = new Map();

  const count = group.positions.length / 3;
  for (let i = 0; i < count; i++) {
    const px = group.positions[i * 3];
    const py = group.positions[i * 3 + 1];
    const pz = group.positions[i * 3 + 2];
    const nx = group.normals[i * 3];
    const ny = group.normals[i * 3 + 1];
    const nz = group.normals[i * 3 + 2];

    // Rounded before hashing: OBJ text and the scale multiply leave float
    // noise well below anything visible at 1 mm, and an exact-match key would
    // silently fail to merge vertices that differ in the eighth decimal.
    const key =
      `${px.toFixed(5)},${py.toFixed(5)},${pz.toFixed(5)},` +
      `${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)}`;

    let idx = seen.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      seen.set(key, idx);
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
    }
    indices.push(idx);
  }
  return { positions, normals, indices };
}

// --- glTF assembly ----------------------------------------------------------

function buildGltf(models) {
  const json = {
    asset: { version: "2.0", generator: "faite scripts/scene/build-room.mjs" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let offset = 0;
  const materialIndex = new Map();

  /** Every bufferView must start on a 4-byte boundary or strict loaders reject it. */
  const align = () => {
    const rem = offset % 4;
    if (rem === 0) return;
    const pad = Buffer.alloc(4 - rem);
    chunks.push(pad);
    offset += pad.length;
  };

  const pushAccessor = (data, min, max) => {
    const buf = Buffer.alloc(data.length * 4);
    data.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    align();
    chunks.push(buf);
    json.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: buf.length,
      target: 34962, // ARRAY_BUFFER
    });
    offset += buf.length;
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: 5126, // FLOAT
      count: data.length / 3,
      type: "VEC3",
      min,
      max,
    });
    return json.accessors.length - 1;
  };

  const pushIndices = (indices, vertexCount) => {
    // Widen only when the mesh actually needs it. Every prop here is well under
    // 65k vertices, so this is UNSIGNED_SHORT in practice and halves the index
    // buffer against a blanket UNSIGNED_INT.
    const big = vertexCount > 65535;
    const buf = Buffer.alloc(indices.length * (big ? 4 : 2));
    indices.forEach((v, i) =>
      big ? buf.writeUInt32LE(v, i * 4) : buf.writeUInt16LE(v, i * 2),
    );
    align();
    chunks.push(buf);
    json.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: buf.length,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    offset += buf.length;
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: big ? 5125 : 5123,
      count: indices.length,
      type: "SCALAR",
    });
    return json.accessors.length - 1;
  };

  for (const m of models) {
    const primitives = [];
    for (const [matName, g] of m.groups) {
      if (!g.positions.length) continue;

      if (!materialIndex.has(matName)) {
        const [r, gg, b] = m.colours[matName] ?? [0.8, 0.8, 0.8];
        json.materials.push({
          name: matName, // semantic; room-materials.ts re-tints by this
          pbrMetallicRoughness: {
            baseColorFactor: [r, gg, b, 1],
            metallicFactor: 0,
            roughnessFactor: 0.85,
          },
        });
        materialIndex.set(matName, json.materials.length - 1);
      }

      const { positions, normals, indices } = indexGeometry(g);

      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const v = positions[i + a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
      primitives.push({
        attributes: {
          POSITION: pushAccessor(positions, lo, hi),
          NORMAL: pushAccessor(normals, [-1, -1, -1], [1, 1, 1]),
        },
        indices: pushIndices(indices, positions.length / 3),
        material: materialIndex.get(matName),
        mode: 4, // TRIANGLES
      });
    }
    if (!primitives.length) continue;
    json.meshes.push({ name: m.node, primitives });
    json.nodes.push({ name: m.node, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }

  const bin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: bin.length }];
  return { json, bin };
}

/** GLB container: 12-byte header, JSON chunk padded with spaces, BIN chunk
 *  padded with zeros. Both chunks must be 4-byte aligned or loaders reject it. */
function toGlb(json, bin) {
  const pad = (buf, filler) => {
    const rem = buf.length % 4;
    return rem === 0
      ? buf
      : Buffer.concat([buf, Buffer.alloc(4 - rem, filler)]);
  };
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBuf = pad(bin, 0x00);

  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.write("JSON", 4, "ascii");

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.write("BIN\0", 4, "ascii");

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

// --- main -------------------------------------------------------------------

const missing = SCENE_MODELS.filter((m) => !existsSync(join(SRC, m.file)));
if (missing.length) {
  console.error(
    `\nMissing ${missing.length} source model(s) in assets/scene/models/:\n` +
      missing.map((m) => `  - ${m.file}`).join("\n") +
      `\n\nVendor them first - see assets/scene/CREDITS.md. A build that reads` +
      `\n~/Downloads is not a build.\n`,
  );
  process.exit(1);
}

const models = [];
console.log(`\n${"node".padEnd(16)} ${"file".padEnd(24)} size (m)      tris`);
console.log("-".repeat(66));

for (const spec of SCENE_MODELS) {
  let groups = parseObj(join(SRC, spec.file));
  let colours = parseMtl(join(SRC, spec.file.replace(/\.obj$/, ".mtl")));

  // Namespace this model's materials where the spec asks for it. Applied to
  // the geometry groups and the colour table together, so a renamed material
  // can never fall back to the 0.8-grey default by accident.
  if (spec.rename) {
    const renamed = new Map();
    for (const [name, g] of groups) renamed.set(spec.rename[name] ?? name, g);
    groups = renamed;
    colours = Object.fromEntries(
      Object.entries(colours).map(([name, kd]) => [spec.rename[name] ?? name, kd]),
    );
  }

  rotateY(groups, spec.rotateY);
  const size = normalise(groups, spec.fit, spec.size);
  const tris =
    [...groups.values()].reduce((n, g) => n + g.positions.length, 0) / 9;
  console.log(
    `${spec.node.padEnd(16)} ${spec.file.padEnd(24)} ` +
      `${size.join(" x ").padEnd(22)} ${tris}`,
  );
  models.push({ ...spec, groups, colours });
}

const { json, bin } = buildGltf(models);
const glb = toGlb(json, bin);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);

console.log(
  `\nwrote public/scene/living-room.glb` +
    `  ${(glb.length / 1024).toFixed(1)} KB` +
    `  ${json.nodes.length} nodes, ${json.materials.length} materials\n` +
    `materials: ${json.materials.map((m) => m.name).join(", ")}\n`,
);
