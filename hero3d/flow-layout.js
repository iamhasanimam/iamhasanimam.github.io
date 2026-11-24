/* flow-layout.js - pure layout for flow3d. No DOM, no three.js: spec in, positions and volumes out.
 *
 * computeLayout(spec, {xScale>=1}) -> { boxes:[{id,layer,pos:{x,y,z},size:{w,h,d}}], volumes:[{id,kind:'layer'|'group',label,parent,boxes:[ids],min,max}], bounds:{min,max} }
 * Layers stack upwards (layer 0 at the bottom). pos is the box CENTRE. Spec col/row are scaled by the spacing minimums:
 * at least 2 box widths of clear space between boxes, 2.5 box heights between layer volumes.
 */
export const BOX = { w: 3.0, h: 0.36, d: 3.0 };   // the cube is 3.0 units; every other distance is a multiple of it
export const PITCH = { x: BOX.w * 2.1, z: BOX.w * 2.1 };                      // absolute units: column 3.6, row 3.4 (generous room)       // centre to centre => 2.4 box widths clear
export const LAYER_GAP = BOX.w * 1.4;                                 // clear space between floors
export const LAYER_H = 5.0;                       // every layer is exactly this tall (about 1.7 tile widths)
export const CARD = { w: BOX.w, h: 3.0, t: BOX.h };  // upright icon card: stands on the slab, facing +z
export const SLAB_T = 0.2;                           // clear vertical space between layer volumes
export const LAYER_ZGAP = 0;                          // clear depth between layer volumes: layers step FRONT TO BACK as well as up
export const PAD = { layer: { x: BOX.w * 0.6, z: BOX.w * 0.6, bottom: SLAB_T, top: LAYER_H - SLAB_T - BOX.h }, group: { x: 0.6, z: 0.6, bottom: 0.05, top: 3.0 } };

export const OUTSIDE_LABEL = 'Actors (outside the stack)';
export const OUTSIDE_GAP_BOXES = 2.5;                              // clear x gap between the stack and an outside layer, in box widths
export const replicaLabel = (label, n) => (Number.isFinite(n) && n >= 2 ? `${label} x ${Math.floor(n)}` : label);
/* ghost tiles behind the main tile for replicas: up to 2, each further back and lower, fading 70% then 45% */
/* shape: rounded cube by default (technologies and actors alike); an explicit box.shape cube|cuboid|sphere|cone is honoured */
const SHAPES = ['cube', 'cuboid', 'sphere', 'cone'];
export function shapeFor(b = {}) { return SHAPES.includes(b.shape) ? b.shape : 'cube'; } // every technology is a rounded cube; only an explicit shape changes it
/* bird's eye: temporary z offsets so every floor is seen separately from above (ids bottom to top; front = bottom floor) */
export function explodeOffsets(idsBottomUp, depth) {
  const n = idsBottomUp.length, m = new Map();
  idsBottomUp.forEach((id, i) => m.set(id, ((n - 1) / 2 - i) * 1.2 * depth));
  return m;
}
export const ghostOffsets = (n) => (Number.isFinite(n) && n >= 2 ? [{ dy: 0.24, dz: -0.45, opacity: 0.7 }, { dy: 0.48, dz: -0.9, opacity: 0.45 }].slice(0, Math.min(2, Math.floor(n) - 1)) : []);

const num = (v, d) => (Number.isFinite(v) ? v : d);

export function computeLayout(spec = {}, opts = {}) {
  const xs = Math.max(1, num(opts.xScale, 1));   // optional widening of column spacing (never below the minimum)
  const src = (spec.boxes || []).filter((b) => b && b.id);
  const layerOf = (b) => num(b.layer, 0);
  const outsideSet = new Set((spec.layers || []).filter((l) => l && l.kind === 'outside').map((l) => l.layer));
  const allKeys = [...new Set(src.map(layerOf))].sort((a, b) => a - b);
  const keys = allKeys.filter((k) => !outsideSet.has(k)), outKeys = allKeys.filter((k) => outsideSet.has(k));

  // resolve duplicate grid cells inside a layer by pushing to the next free row
  const cell = new Map(), grid = new Map();
  for (const b of src) {
    const k = layerOf(b); let col = num(b.col, 0), row = num(b.row, 0);
    while (cell.has(`${k}:${col}:${row}`)) row += 1;
    cell.set(`${k}:${col}:${row}`, b.id); grid.set(b.id, { col, row });
  }
  // square packing: stack floors (unless arrange:'grid') and vertical/square zones are auto-packed into the smallest square-ish grid in (row, col) reading order
  const packedLayers = new Set();
  const nRows = (mates) => new Set(mates.map((b) => grid.get(b.id).row)).size;
  const stag = (k, row, mates) => (packedLayers.has(k) && nRows(mates) > 1 ? (row % 2 ? 0.25 : -0.25) * PITCH.x : 0); // brick stagger: odd rows shift half a pitch so cards never share screen columns
  const layerCfg = (k) => (spec.layers || []).find((l) => l && l.layer === k) || {};
  for (const k of allKeys) {
    const cfg = layerCfg(k), isOut = outsideSet.has(k), want = isOut ? (cfg.arrange === 'vertical' || cfg.arrange === 'square') : cfg.arrange !== 'grid';
    if (!want) continue;
    const m = src.filter((b) => layerOf(b) === k).sort((p, q) => grid.get(p.id).row - grid.get(q.id).row || grid.get(p.id).col - grid.get(q.id).col), n = m.length;
    const cols = isOut && n <= 3 ? 1 : Math.max(1, Math.ceil(Math.sqrt(n)));
    m.forEach((b, i) => grid.set(b.id, { col: i % cols, row: Math.floor(i / cols) })); packedLayers.add(k);
  }
  const colMidOf = (mates) => { const c = mates.map((b) => grid.get(b.id).col); return c.length ? (Math.min(...c) + Math.max(...c)) / 2 : 0; };   // every layer is centred on x=0: wider layers are wider (pyramid / layer cake)

  const boxes = [], byId = new Map(), volumes = [];
  let y0 = 0, prevDepth = 0;
  const L = PAD.layer;
  // layers are stacked vertically only: every stack layer is centred on x=0 and z=0 (no front-to-back stagger) and shares one slab depth
  const maxRows = Math.max(1, ...keys.map((k) => { const r = src.filter((b) => layerOf(b) === k).map((b) => grid.get(b.id).row); return Math.max(...r) - Math.min(...r) + 1; }));
  const extent = (mates, pw, pd) => { const c = mates.map((b) => grid.get(b.id).col), rr = mates.map((b) => grid.get(b.id).row); return Math.max((Math.max(...c) - Math.min(...c)) * pw + BOX.w + (packedLayers.has(layerOf(mates[0])) && nRows(mates) > 1 ? 0.5 * PITCH.x : 0), (Math.max(...rr) - Math.min(...rr)) * pd + BOX.d); };
  const SQ = Math.max(0, ...keys.map((k) => extent(src.filter((b) => layerOf(b) === k), PITCH.x * xs, PITCH.z))) + 2 * L.x; // every stack floor is the same rounded SQUARE
  for (const k of keys) {
    const mates = src.filter((b) => layerOf(b) === k), rows = mates.map((b) => grid.get(b.id).row), rowMid = (Math.min(...rows) + Math.max(...rows)) / 2, colMid = colMidOf(mates);
    const yc = y0 + L.bottom + BOX.h / 2;
    const ids = [];
    for (const b of mates) {
      const g = grid.get(b.id);
      const rec = { id: b.id, layer: k, pos: { x: (g.col - colMid) * PITCH.x * xs + stag(k, g.row, mates), y: yc, z: (g.row - rowMid) * PITCH.z }, size: { ...BOX } };
      boxes.push(rec); byId.set(b.id, rec); ids.push(b.id);
    }
    const vol = boundsOf(ids.map((i) => byId.get(i)), L); vol.min.x = -SQ / 2; vol.max.x = SQ / 2; vol.min.z = -SQ / 2; vol.max.z = SQ / 2; vol.max.y = vol.min.y + LAYER_H;
    volumes.push({ id: `layer:${k}`, kind: 'layer', label: ((spec.layers || []).find((l) => l.layer === k) || {}).label || '', parent: null, boxes: ids, min: vol.min, max: vol.max });
    // deep layers get extra vertical air so their wireframes do not visually pile up (the 2.5 box heights is the minimum)
    y0 = vol.max.y + LAYER_GAP;
  }

  // outside layers: zones drawn beside the stack (side 'left' | 'right', default right), OUTSIDE_GAP_BOXES box widths clear in x and chained outwards,
  // centred on the stack's mid-height. arrange:'vertical' makes a tall column: row maps to height (row 0 on TOP), col to sub-columns.
  const stackV = volumes.slice(), edge = { left: stackV.length ? Math.min(...stackV.map((v) => v.min.x)) : 0, right: stackV.length ? Math.max(...stackV.map((v) => v.max.x)) : 0 };
  const midY = stackV.length ? (Math.min(...stackV.map((v) => v.min.y)) + Math.max(...stackV.map((v) => v.max.y))) / 2 : 0;
  const TALL = BOX.w;
  for (const k of outKeys) {
    const lay = (spec.layers || []).find((l) => l && l.layer === k) || {}, side = lay.side === 'left' ? 'left' : 'right', vertical = lay.arrange === 'vertical';
    const mates = src.filter((b) => layerOf(b) === k), cs = mates.map((b) => grid.get(b.id).col), rs = mates.map((b) => grid.get(b.id).row);
    const cMid = (Math.min(...cs) + Math.max(...cs)) / 2, rMid = (Math.min(...rs) + Math.max(...rs)) / 2, rMin = Math.min(...rs), rMax = Math.max(...rs), ids = [];
    const Wc = (Math.max(...cs) - Math.min(...cs)) * PITCH.x * xs + BOX.w + (packedLayers.has(k) && nRows(mates) > 1 ? 0.5 * PITCH.x : 0), Hc = (rMax - rMin) * PITCH.z + (vertical ? TALL : BOX.d);
    const S = Math.max(Wc, Hc) + 2 * L.x; // a square zone: side = max(content width, content height or depth) + padding
    const gap = OUTSIDE_GAP_BOXES * BOX.w, volMinX = side === 'right' ? edge.right + gap : edge.left - gap - S, shiftX = volMinX + S / 2;
    edge[side === 'right' ? 'right' : 'left'] = side === 'right' ? volMinX + S : volMinX;
    const H = vertical ? S : LAYER_H, minY = midY - H / 2, contentBottom = minY + (S - Hc) / 2;
    for (const b of mates) { const g = grid.get(b.id), x = (g.col - cMid) * PITCH.x * xs + shiftX + stag(k, g.row, mates), y = vertical ? contentBottom + (rMax - g.row) * PITCH.z + BOX.h / 2 : minY + SLAB_T + BOX.h / 2, z = vertical ? 0 : (g.row - rMid) * PITCH.z; const rec = { id: b.id, layer: k, pos: { x, y, z }, size: { ...BOX } }; boxes.push(rec); byId.set(b.id, rec); ids.push(b.id); }
    const vol = { min: { x: shiftX - S / 2, y: minY, z: vertical ? -(BOX.d / 2 + L.z) : -S / 2 }, max: { x: shiftX + S / 2, y: minY + H, z: vertical ? BOX.d / 2 + L.z : S / 2 } };
    volumes.push({ id: `layer:${k}`, kind: 'layer', outside: true, vertical, side, label: lay.label ? (/outside/i.test(lay.label) ? lay.label : (vertical ? lay.label : `${lay.label} (outside the stack)`)) : OUTSIDE_LABEL, parent: null, boxes: ids, min: vol.min, max: vol.max });
  }

  for (const g of spec.groups || []) {
    if (!g || !g.id) continue;
    const ids = (g.boxes || []).filter((i) => byId.has(i));
    if (!ids.length) continue;
    const recs = ids.map((i) => byId.get(i)), v = boundsOf(recs, PAD.group), layers = new Set(recs.map((r) => r.layer));
    volumes.push({ id: `group:${g.id}`, kind: 'group', label: g.label || '', parent: layers.size === 1 ? `layer:${recs[0].layer}` : null, boxes: ids, min: v.min, max: v.max });
  }

  const all = volumes.length ? volumes : [boundsOf(boxes, PAD.layer)];
  const bounds = { min: { x: Math.min(...all.map((v) => v.min.x)), y: Math.min(...all.map((v) => v.min.y)), z: Math.min(...all.map((v) => v.min.z)) }, max: { x: Math.max(...all.map((v) => v.max.x)), y: Math.max(...all.map((v) => v.max.y)), z: Math.max(...all.map((v) => v.max.z)) } };
  return { boxes, volumes, bounds };
}

function boundsOf(recs, pad) {
  const xs = recs.map((r) => r.pos.x), ys = recs.map((r) => r.pos.y), zs = recs.map((r) => r.pos.z);
  return {
    min: { x: Math.min(...xs) - BOX.w / 2 - pad.x, y: Math.min(...ys) - BOX.h / 2 - pad.bottom, z: Math.min(...zs) - BOX.d / 2 - pad.z },
    max: { x: Math.max(...xs) + BOX.w / 2 + pad.x, y: Math.max(...ys) + BOX.h / 2 + pad.top, z: Math.max(...zs) + BOX.d / 2 + pad.z },
  };
}
