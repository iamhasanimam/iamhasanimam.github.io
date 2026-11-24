// arch.js - reusable Three.js "architecture explainer".
//   const h = await mountArch(el, spec, { slug, base, glbUrl, layoutUrl, posterUrl, ... });
//   h.unmount() / h.play() / h.pause() / h.select(id) / h.step(i)
// Two render paths:
//   1. GLB path (primary): Blender sculpture (<base><slug>.glb) + <slug>.layout.json; icon tiles and
//      labels float above the sculpture, interaction drives the GLB objects' emissive/opacity.
//   2. Procedural path (fallback): auto-laid-out glass tiles, glowing tubes, group boxes.
// See arch-README.md for the spec schema and options.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KIND_COLORS = {
  client: '#4cc9f0', proxy: '#ff6b6b', process: '#8f7cff', store: '#2ec4b6',
  service: '#5b8cff', control: '#f15bb5', observe: '#ffd166', network: '#9aa0ff',
};
const ORANGE = new THREE.Color('#ff9f1c');
const LINK_BASE = '#6f6bff';
const SX = 3.8, SY = 2.7, SZ = 2.0;   // grid unit -> world
const TILE = 1.5;                      // tile edge, procedural units
const MAX_GLB_BYTES = 14 * 1024 * 1024;
const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

/* ------------------------------------------------------------------ helpers */
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const norm = (s) => String(s).toLowerCase().replace(/\.\d+$/, '').replace(/[^a-z0-9]/g, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function fitFont(ctx, text, weight, size, maxW) {
  let s = size;
  for (; s > 18; s -= 3) { ctx.font = `${weight} ${s}px ${FONT}`; if (ctx.measureText(text).width <= maxW) break; }
  return s;
}
function ensureCss() {
  try {
    if (document.querySelector('link[href$="arch.css"], link[data-arch3d]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.arch3d = '1';
    l.href = new URL('./arch.css', import.meta.url).href; document.head.appendChild(l);
  } catch { /* host includes the css itself */ }
}
function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
function autoQuality(w) {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    if ((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)) return 'low';
    if (coarse && w < 700) return 'low';
  } catch { /* ignore */ }
  return 'high';
}

// icon image cache (slug|color -> Promise<HTMLImageElement>)
const iconCache = new Map();
function loadIcon(slug, color) {
  if (!/^[a-z0-9._-]+$/i.test(slug)) return Promise.reject(new Error('bad slug'));
  const key = slug + '|' + color;
  if (iconCache.has(key)) return iconCache.get(key);
  const p = (async () => {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/${slug}.svg`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('icon ' + r.status);
      let t = await r.text(); if (!/<svg/i.test(t)) throw new Error('not svg');
      t = t.replace(/<svg/i, `<svg width="256" height="256" fill="${color}"`);
      const url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
      try {
        return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      } finally { URL.revokeObjectURL(url); }
    } finally { clearTimeout(to); }
  })();
  iconCache.set(key, p); p.catch(() => iconCache.delete(key));
  return p;
}

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const c = mk(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace; return glowTex;
}

function canvasTex(c, renderer) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}

function drawFace(n) {
  const c = n.faceCanvas, ctx = c.getContext('2d'), S = c.width;
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, 'rgba(38,34,140,.94)'); g.addColorStop(1, 'rgba(8,6,48,.96)');
  rrPath(ctx, 8, 8, S - 16, S - 16, 44); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = n.colorHex; ctx.shadowColor = n.colorHex; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
  rrPath(ctx, 20, 20, S - 40, S - 40, 34); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.stroke();
  if (n.iconImg) {
    const sz = S * 0.52; ctx.drawImage(n.iconImg, (S - sz) / 2, (S - sz) / 2, sz, sz);
  } else {
    const m = (n.spec.label || n.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    ctx.fillStyle = n.colorHex; ctx.font = `800 ${S * 0.4}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = n.colorHex; ctx.shadowBlur = 18; ctx.fillText(m, S / 2, S / 2 + 6); ctx.shadowBlur = 0;
  }
  n.faceTex.needsUpdate = true;
}

function labelCanvas(label, sub) {
  const c = mk(1024, 256), ctx = c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const s1 = fitFont(ctx, label, 700, 104, 900); ctx.font = `700 ${s1}px ${FONT}`; const w1 = ctx.measureText(label).width;
  let w2 = 0, s2 = 0;
  if (sub) { s2 = fitFont(ctx, sub, 500, 62, 940); ctx.font = `500 ${s2}px ${FONT}`; w2 = ctx.measureText(sub).width; }
  const pw = Math.min(1004, Math.max(w1, w2) + 70), ph = sub ? 226 : 140, py = sub ? 15 : 58;
  rrPath(ctx, (1024 - pw) / 2, py, pw, ph, 40); ctx.fillStyle = 'rgba(6,5,40,.68)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(160,156,255,.28)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${s1}px ${FONT}`; ctx.fillText(label, 512, sub ? 96 : 128);
  if (sub) { ctx.fillStyle = '#c4c2ff'; ctx.font = `500 ${s2}px ${FONT}`; ctx.fillText(sub, 512, 190); }
  return c;
}
function pillCanvas(text, px = 56, color = '#fff') {
  const m = mk(8, 8).getContext('2d'); m.font = `700 ${px}px ${FONT}`;
  const tw = Math.ceil(m.measureText(text).width), w = tw + 48, h = px + 36;
  const c = mk(w, h), ctx = c.getContext('2d');
  rrPath(ctx, 2, 2, w - 4, h - 4, h / 2.4); ctx.fillStyle = 'rgba(6,5,40,.78)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,159,28,.55)'; ctx.stroke();
  ctx.fillStyle = color; ctx.font = `700 ${px}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 2);
  return c;
}

/* polyline utilities */
function polyInfo(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { cum, len: cum[cum.length - 1] || 1e-6 };
}
function polyAt(pts, cum, len, u, out) {
  const d = clamp(u, 0, 1) * len; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1e-6;
  return out.lerpVectors(a, b, clamp((d - cum[i - 1]) / seg, 0, 1));
}

/* auto layout (procedural) */
function autoLayout(nodes, links) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map(nodes.map((n) => [n.id, []])), inc = new Map(nodes.map((n) => [n.id, []]));
  const L = links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  L.forEach((l) => { out.get(l.from).push(l.to); inc.get(l.to).push(l.from); });
  let src = nodes.filter((n) => !inc.get(n.id).length).map((n) => n.id); if (!src.length) src = [nodes[0].id];
  const depth = new Map(); let q = [];
  const seed = (id) => { depth.set(id, 0); q.push(id); };
  src.forEach(seed);
  const bfs = () => { while (q.length) { const c = q.shift(); out.get(c).forEach((t) => { if (!depth.has(t)) { depth.set(t, depth.get(c) + 1); q.push(t); } }); } };
  bfs(); nodes.forEach((n) => { if (!depth.has(n.id)) { seed(n.id); bfs(); } });
  const fwd = L.filter((l) => depth.get(l.to) > depth.get(l.from));
  for (let p = 0; p < nodes.length; p++) {
    let ch = false; fwd.forEach((l) => { if (depth.get(l.to) < depth.get(l.from) + 1) { depth.set(l.to, depth.get(l.from) + 1); ch = true; } });
    if (!ch) break;
  }
  const cols = new Map(); nodes.forEach((n, i) => { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push({ n, i }); });
  const pos = new Map();
  cols.forEach((arr, d) => {
    arr.sort((a, b) => (a.n.layer ?? 0) - (b.n.layer ?? 0) || a.i - b.i);
    arr.forEach((e, i) => pos.set(e.n.id, new THREE.Vector3(d * SX, ((arr.length - 1) / 2 - i) * SY, 0)));
  });
  return pos;
}

function look(obj) {
  const items = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const cl = arr.map((m) => {
      const c = m.clone();
      items.push({ m: c, e: c.emissive ? c.emissive.clone() : null, ei: c.emissiveIntensity ?? 1, col: c.color ? c.color.clone() : null, op: c.opacity ?? 1, tr: c.transparent });
      c.transparent = true; return c;
    });
    o.material = Array.isArray(o.material) ? cl : cl[0];
  });
  return {
    apply(vis, boost = 0, tint = 0) {
      for (const it of items) {
        const m = it.m;
        if (it.e) {
          m.emissive.copy(it.e); if (tint) m.emissive.lerp(ORANGE, tint * 0.85);
          m.emissiveIntensity = it.ei * (0.3 + 0.7 * vis) * (1 + boost * 1.2 + tint * 0.8);
        } else if (it.col) { m.color.copy(it.col); if (tint) m.color.lerp(ORANGE, tint * 0.85); m.color.multiplyScalar(0.4 + 0.6 * vis); }
        m.opacity = it.tr ? it.op * (0.2 + 0.8 * vis) : 0.2 + 0.8 * vis;
      }
    },
  };
}

async function fetchJson(url, ms = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status + ' ' + url); return await r.json(); } finally { clearTimeout(t); }
}
async function loadGlbAssets(urls, spec) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try {
    const [layout, res] = await Promise.all([fetchJson(urls.layout), fetch(urls.glb, { signal: c.signal })]);
    if (!res.ok) throw new Error('glb ' + res.status);
    const len = +res.headers.get('content-length') || 0;
    if (len > MAX_GLB_BYTES) throw new Error('glb too large (' + len + ')');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_GLB_BYTES) throw new Error('glb too large');
    if (!layout || !layout.nodes) throw new Error('layout has no nodes');
    for (const n of spec.nodes) { const p = layout.nodes[n.id]; if (!Array.isArray(p) || p.length < 3) throw new Error('layout missing node ' + n.id); }
    const gltf = await new Promise((res2, rej) => new GLTFLoader().parse(buf, '', res2, rej));
    return { gltf, layout };
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------------ mount */
export async function mountArch(container, spec, opts = {}) {
  ensureCss();
  container.classList.add('arch3d');
  const root = el('div', 'arch3d__root'); container.appendChild(root);
  const nodesSpec = (spec.nodes || []).filter((n) => n && n.id);
  const linksSpec = (spec.links || []).filter((l) => nodesSpec.some((n) => n.id === l.from) && nodesSpec.some((n) => n.id === l.to));
  const stepsSpec = spec.steps || [];
  const reduced = opts.reducedMotion ?? (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const slug = opts.slug !== undefined ? opts.slug : (spec.slug || null);
  const base = (opts.base ?? 'assets/arch/').replace(/([^/])$/, '$1/');
  const urls = {
    glb: opts.glbUrl || (slug ? `${base}${slug}.glb` : null),
    layout: opts.layoutUrl || (slug ? `${base}${slug}.layout.json` : null),
    poster: opts.posterUrl || (slug ? `${base}${slug}.jpg` : null),
  };
  const quality = opts.quality || autoQuality(container.clientWidth || 1000);
  const low = quality === 'low';

  const fallbackHtml = () => {
    root.replaceChildren();
    const f = el('div', 'arch3d__fallback');
    f.appendChild(el('h3', '', spec.title || 'Architecture')); if (spec.summary) f.appendChild(el('p', '', spec.summary));
    const ol = el('ol'); stepsSpec.forEach((s) => { const li = el('li'); li.appendChild(el('strong', '', s.title + '. ')); li.appendChild(document.createTextNode(s.text || '')); ol.appendChild(li); });
    if (!stepsSpec.length) nodesSpec.forEach((n) => { const li = el('li'); li.appendChild(el('strong', '', n.label + ': ')); li.appendChild(document.createTextNode(n.detail || n.sub || '')); ol.appendChild(li); });
    f.appendChild(ol); root.appendChild(f);
    const noop = () => {};
    return { unmount() { container.classList.remove('arch3d'); root.remove(); }, play: noop, pause: noop, select: noop, step: noop, mode: 'fallback', quality };
  };
  if (!nodesSpec.length || !webglOk()) return fallbackHtml();

  /* renderer */
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: 'high-performance' }); } catch { return fallbackHtml(); }
  const dprCap = low ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement; canvas.className = 'arch3d__canvas'; canvas.tabIndex = -1;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', (spec.title || 'Architecture') + '. ' + (spec.summary || ''));
  canvas.style.touchAction = 'none';

  /* poster (shown instantly while GLB loads) */
  let poster = null;
  if (urls.poster && urls.glb) {
    poster = el('img', 'arch3d__poster'); poster.alt = ''; poster.decoding = 'async';
    poster.onerror = () => { poster && poster.remove(); poster = null; };
    poster.src = urls.poster; root.appendChild(poster);
  }
  root.appendChild(canvas);
  const loading = el('div', 'arch3d__loading', 'Loading 3D scene'); root.appendChild(loading);

  let disposed = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const world = new THREE.Group(); scene.add(world);   // sway applies here
  scene.add(new THREE.AmbientLight(0xaab0ff, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-6, 10, 12); scene.add(dl);
  const pl = new THREE.PointLight(0xff9f1c, 18, 60); pl.position.set(10, 4, 6); scene.add(pl);

  /* load GLB (optional) */
  let glb = null;
  if (urls.glb && urls.layout) {
    try { glb = await loadGlbAssets(urls, spec); } catch (e) { console.warn('[arch] GLB path unavailable, using procedural renderer:', e.message || e); glb = null; }
  }
  if (disposed) return null;
  if (!glb && poster) { poster.remove(); poster = null; }
  const mode = glb ? 'glb' : 'procedural';

  /* ------------------------------------------------ build scene objects */
  const nodes = []; const nodeById = new Map(); const links = []; const groups = []; const pickables = [];
  const particles = []; let ts = 1;   // ts = tile scale (world units per procedural unit)
  const nodeAnchor = new Map();       // id -> Vector3 (sculpture / tile centre used for links)
  let sceneBox = new THREE.Box3();
  let home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  if (glb) {
    const L = glb.layout;
    world.add(glb.gltf.scene);
    const objs = new Map(); glb.gltf.scene.traverse((o) => { if (o.name) objs.set(norm(o.name), o); });
    const anchors = nodesSpec.map((n) => new THREE.Vector3(...L.nodes[n.id]));
    if (anchors.length > 1) {
      const nn = anchors.map((a, i) => Math.min(...anchors.map((b, j) => (i === j ? Infinity : a.distanceTo(b)))));
      nn.sort((a, b) => a - b); ts = clamp(nn[Math.floor(nn.length / 2)] / 4.8, 0.4, 1.6);
    }
    nodesSpec.forEach((n, i) => {
      const a = anchors[i]; nodeAnchor.set(n.id, a);
      const o = objs.get(norm('node_' + n.id)); let top = a.y;
      const rec = newNode(n);
      if (o) { top = new THREE.Box3().setFromObject(o).max.y; rec.look = look(o); o.traverse((m) => { if (m.isMesh) { m.userData.nodeId = n.id; pickables.push(m); } }); }
      rec.tilePos = new THREE.Vector3(a.x, top + 0.2 + 1.8 * ts, a.z);
      buildTile(rec, true);
    });
    linksSpec.forEach((l) => {
      const key = `${l.from}_${l.to}`; const o = objs.get(norm('link_' + key));
      let pts = (L.links && L.links[key] || []).map((p) => new THREE.Vector3(...p));
      if (pts.length < 2) pts = [nodeAnchor.get(l.from).clone(), nodeAnchor.get(l.to).clone()];
      const rec = { l, key, pts, ...polyInfo(pts), act: 0, vis: 1, labelSpr: null };
      if (o) rec.look = look(o); else { const pl2 = procLink(pts[0], pts[pts.length - 1], l.style === 'dashed', ts); world.add(pl2.group); rec.proc = pl2; }
      if (l.label) rec.labelSpr = linkLabel(l.label, pts, ts);
      links.push(rec);
    });
    const gnames = [...new Set(nodesSpec.map((n) => n.group).filter(Boolean))];
    gnames.forEach((g) => {
      const o = objs.get(norm('group_' + g)); const rec = { name: g, members: nodesSpec.filter((n) => n.group === g).map((n) => n.id), vis: 1 };
      if (o) rec.look = look(o);
      const gl = L.groups && Object.entries(L.groups).find(([k]) => norm(k.replace(/^group_/i, '')) === norm(g));
      if (gl && gl[1].center && gl[1].size) {
        const c = gl[1].center, s = gl[1].size, spr = textSprite(g.toUpperCase(), 44, '#c4c2ff', ts * 1.0);
        spr.position.set(c[0], c[1] + s[1] / 2 + 0.5 * ts, c[2]); world.add(spr); rec.label = spr;
      }
      groups.push(rec);
    });
    sceneBox = new THREE.Box3();   // frame the tiles + sculpture anchors, not the (huge) floor
    nodes.forEach((n) => {
      const p = n.tilePos, a = nodeAnchor.get(n.id);
      sceneBox.expandByPoint(new THREE.Vector3(p.x - 1.4 * ts, p.y - 1.9 * ts, p.z)); sceneBox.expandByPoint(new THREE.Vector3(p.x + 1.4 * ts, p.y + 1.6 * ts, p.z)); sceneBox.expandByPoint(a);
    });
    if (L.camera && Array.isArray(L.camera.position) && Array.isArray(L.camera.target)) {
      home = { pos: new THREE.Vector3(...L.camera.position), target: new THREE.Vector3(...L.camera.target) };
      fitHome(home, sceneBox);   // keep the authored view direction, fit distance/target to the tiles
    } else {
      const d = new THREE.Vector3(-0.35, 0.28, 1).normalize(); home.target = sceneBox.getCenter(new THREE.Vector3()); home.pos = home.target.clone().add(d.multiplyScalar(30));
      fitHome(home, sceneBox);
    }
  } else {
    const auto = autoLayout(nodesSpec, linksSpec);
    nodesSpec.forEach((n) => {
      const p = auto.get(n.id).clone();
      if (Array.isArray(n.pos)) p.set(n.pos[0] * SX, n.pos[1] * SY, (n.pos[2] || 0) * SZ);
      auto.set(n.id, p);
    });
    const box = new THREE.Box3(); auto.forEach((p) => { box.expandByPoint(new THREE.Vector3(p.x - 1.3, p.y - 1.9, p.z - 0.3)); box.expandByPoint(new THREE.Vector3(p.x + 1.3, p.y + 1.6, p.z + 0.3)); });
    const c = box.getCenter(new THREE.Vector3()); c.z = 0; auto.forEach((p) => p.sub(c)); box.translate(c.clone().negate());
    nodesSpec.forEach((n) => {
      const p = auto.get(n.id); nodeAnchor.set(n.id, p);
      const rec = newNode(n); rec.tilePos = p.clone(); buildTile(rec, false);
    });
    linksSpec.forEach((l) => {
      const A = nodeAnchor.get(l.from), B = nodeAnchor.get(l.to);
      const pr = procLink(A, B, l.style === 'dashed', 1, true); world.add(pr.group);
      const rec = { l, key: `${l.from}_${l.to}`, pts: pr.pts, ...polyInfo(pr.pts), act: 0, vis: 1, proc: pr, labelSpr: null };
      if (l.label) rec.labelSpr = linkLabel(l.label, rec.pts, 1);
      links.push(rec);
    });
    [...new Set(nodesSpec.map((n) => n.group).filter(Boolean))].forEach((g) => {
      const mem = nodesSpec.filter((n) => n.group === g); const bb = new THREE.Box3();
      mem.forEach((n) => { const p = nodeAnchor.get(n.id); bb.expandByPoint(new THREE.Vector3(p.x - 1.5, p.y - 2.0, p.z - 0.6)); bb.expandByPoint(new THREE.Vector3(p.x + 1.5, p.y + 1.1, p.z + 0.3)); });
      const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, cc = bb.getCenter(new THREE.Vector3());
      const shp = rrShape(w, h, 0.7), fill = new THREE.Mesh(new THREE.ShapeGeometry(shp, 10), new THREE.MeshBasicMaterial({ color: 0x5b57e8, transparent: true, opacity: 0.1, depthWrite: false }));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shp.getPoints(10).map((q) => new THREE.Vector3(q.x, q.y, 0))), new THREE.LineBasicMaterial({ color: 0x8f8cff, transparent: true, opacity: 0.55 }));
      const grp = new THREE.Group(); grp.add(fill, line); grp.position.set(cc.x, cc.y, bb.min.z); world.add(grp);
      const spr = textSprite(g.toUpperCase(), 44, '#c4c2ff', 1); spr.position.set(bb.min.x + 0.3 + spr.scale.x / 2, bb.max.y - 0.3, bb.min.z + 0.05); world.add(spr);
      groups.push({ name: g, members: mem.map((n) => n.id), vis: 1, proc: { fill, line, spr } });
    });
    sceneBox = box;
    home.target.set(0, 0, 0); home.pos.set(0, 0, 30);
    const az = -0.38, el2 = 0.28; const d = new THREE.Vector3(Math.sin(az) * Math.cos(el2), Math.sin(el2), Math.cos(az) * Math.cos(el2));
    home.pos = d.clone().multiplyScalar(30); fitHome(home, sceneBox);
  }
  loading.remove();

  function newNode(n) {
    const color = new THREE.Color(KIND_COLORS[n.kind] || KIND_COLORS.service);
    const rec = { id: n.id, spec: n, color, colorHex: '#' + color.getHexString(), vis: 1, hov: 0, sel: 0, iconImg: null, look: null };
    nodes.push(rec); nodeById.set(n.id, rec); return rec;
  }
  function textSprite(text, px, color, scale) {
    const c = pillCanvas(text, px, color), t = canvasTex(c, renderer);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    const h = 0.0052 * scale * c.height; spr.scale.set(h * c.width / c.height, h, 1); spr.renderOrder = 9; return spr;
  }
  function linkLabel(text, pts, scale) {
    const spr = textSprite(text, 52, '#ffffff', scale), m = new THREE.Vector3();
    const { cum, len } = polyInfo(pts); polyAt(pts, cum, len, 0.5, m); m.y += 0.38 * scale; spr.position.copy(m); world.add(spr); return spr;
  }
  function buildTile(n, billboard) {
    const g = new THREE.Group(); g.position.copy(n.tilePos); g.scale.setScalar(ts); world.add(g); n.grp = g;
    n.faceCanvas = mk(256, 256); n.faceTex = canvasTex(n.faceCanvas, renderer); drawFace(n);
    n.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: n.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: !billboard }));
    n.glow.scale.setScalar(3.8); n.glow.position.z = billboard ? 0 : -0.25; g.add(n.glow);
    const lt = canvasTex(labelCanvas(n.spec.label || n.id, n.spec.sub || ''), renderer);
    n.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, depthTest: !billboard ? true : false }));
    n.label.scale.set(3.6, 0.9, 1); n.label.position.set(0, -1.3, 0.12); n.label.renderOrder = 8; g.add(n.label); n.label.userData.nodeId = n.id; pickables.push(n.label);
    if (billboard) {
      n.faceMat = new THREE.SpriteMaterial({ map: n.faceTex, transparent: true, depthTest: false, depthWrite: false });
      const s = new THREE.Sprite(n.faceMat); s.scale.set(TILE, TILE, 1); s.renderOrder = 8; s.userData.nodeId = n.id; g.add(s); pickables.push(s); n.glow.renderOrder = 7;
    } else {
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(rrShape(TILE, TILE, 0.28), { depth: 0.2, bevelEnabled: false, curveSegments: 8 }),
        new THREE.MeshStandardMaterial({ color: 0x0e0c40, emissive: n.color, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.2, transparent: true }));
      body.geometry.translate(0, 0, -0.1); g.add(body); n.body = body;
      n.faceMat = new THREE.MeshBasicMaterial({ map: n.faceTex, transparent: true, toneMapped: false, depthWrite: false });
      const f = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), n.faceMat); f.position.z = 0.102; g.add(f);
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.set(0, -0.3, 0.2); hit.userData.nodeId = n.id; g.add(hit); pickables.push(hit);
    }
    if (n.spec.icon) {
      loadIcon(n.spec.icon, n.spec.color || '#ffffff').then((img) => { if (!disposed) { n.iconImg = img; drawFace(n); dirty = true; } }).catch(() => {});
    }
  }
  function procLink(A, B, dashed, scale, retPts) {
    const d = B.clone().sub(A).normalize(), hw = TILE / 2 + 0.1;
    const edge = (v) => Math.min(Math.abs(v.x) < 1e-6 ? Infinity : hw / Math.abs(v.x), Math.abs(v.y) < 1e-6 ? Infinity : hw / Math.abs(v.y));
    const s = A.clone().addScaledVector(d, edge(d)), e = B.clone().addScaledVector(d, -edge(d));
    const shaftEnd = e.clone().addScaledVector(d, -0.28);
    const rs = low ? 5 : 8; const geos = [], halos = [];
    const segs = [];
    if (dashed) { const len = s.distanceTo(shaftEnd), dash = 0.4, gap = 0.28, n = Math.max(1, Math.floor(len / (dash + gap))); for (let i = 0; i < n; i++) { const t0 = (i * (dash + gap)) / len, t1 = Math.min(1, (i * (dash + gap) + dash) / len); segs.push([s.clone().lerp(shaftEnd, t0), s.clone().lerp(shaftEnd, t1)]); } }
    else segs.push([s, shaftEnd]);
    segs.forEach(([a, b]) => { const c = new THREE.LineCurve3(a, b); geos.push(new THREE.TubeGeometry(c, 1, 0.045, rs, false)); halos.push(new THREE.TubeGeometry(c, 1, 0.13, rs, false)); });
    const base = new THREE.Color(LINK_BASE);
    const core = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.85, depthWrite: false }));
    const halo = new THREE.Mesh(mergeGeometries(halos), new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    geos.concat(halos).forEach((g) => g.dispose());
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 12), new THREE.MeshBasicMaterial({ color: base, transparent: true }));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); arrow.position.copy(e).addScaledVector(d, -0.17);
    const group = new THREE.Group(); group.add(halo, core, arrow);
    return {
      group, pts: [s, e], base,
      apply(vis, act) {
        const c = base.clone().lerp(ORANGE, act); core.material.color.copy(c); arrow.material.color.copy(c); halo.material.color.copy(c);
        core.material.opacity = 0.85 * vis; arrow.material.opacity = vis; halo.material.opacity = 0.16 * vis * (1 + act * 1.5);
      },
    };
  }
  function fitHome(h, box) {
    const dir = h.pos.clone().sub(h.target).normalize(); const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    h.target.copy(c); h.pos.copy(c).addScaledVector(dir, fitDist(size, 1.2));
  }
  function fitDist(size, margin) {
    const vf = (camera.fov * Math.PI) / 180, tv = Math.tan(vf / 2), th = tv * camera.aspect;
    return Math.max(size.y / 2 / tv, size.x / 2 / th) * margin + size.z * 0.5;
  }

  /* particles */
  const pTex = getGlowTex(); const pCount = low ? 2 : 3;
  if (!reduced) {
    links.forEach((lk) => {
      if (!lk.l.flow) return; lk.parts = [];
      for (let i = 0; i < pCount; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pTex, color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
        sp.scale.setScalar(0.5 * ts); sp.renderOrder = 6; world.add(sp); lk.parts.push({ sp, ph: i / pCount }); particles.push(sp);
      }
    });
  }

  /* ------------------------------------------------ camera + controls */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8; controls.panSpeed = 0.7;
  camera.position.copy(home.pos); controls.target.copy(home.target);
  let homeDir = home.pos.clone().sub(home.target); let homeDist = homeDir.length(); homeDir.normalize();
  function applyLimits() {
    homeDir = home.pos.clone().sub(home.target); homeDist = homeDir.length(); homeDir.normalize();
    controls.minDistance = homeDist * 0.18; controls.maxDistance = homeDist * 1.7;
    const p0 = Math.acos(clamp(homeDir.y, -1, 1)); controls.minPolarAngle = Math.max(0.15, p0 - 0.6); controls.maxPolarAngle = Math.min(Math.PI - 0.15, p0 + 0.4);
    const a0 = Math.atan2(homeDir.x, homeDir.z);
    if (Math.abs(a0) + 1.1 < Math.PI) { controls.minAzimuthAngle = a0 - 1.1; controls.maxAzimuthAngle = a0 + 1.1; } else { controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; }
  }
  applyLimits(); controls.update();
  let atHome = true, tween = null, dirty = true, userT = 0;

  function flyTo(pos, tgt) {
    if (reduced) { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); dirty = true; return; }
    tween = { t: 0, dur: 0.95, p0: camera.position.clone(), p1: pos.clone(), t0: controls.target.clone(), t1: tgt.clone() };
  }
  function boxFor(ids) {
    const b = new THREE.Box3();
    ids.forEach((id) => {
      const n = nodeById.get(id); if (!n) return; const p = n.tilePos, a = nodeAnchor.get(id);
      b.expandByPoint(new THREE.Vector3(p.x - 1.3 * ts, p.y - 1.9 * ts, p.z)); b.expandByPoint(new THREE.Vector3(p.x + 1.3 * ts, p.y + 0.9 * ts, p.z)); b.expandByPoint(a);
    });
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const mn = new THREE.Vector3(8 * ts, 6 * ts, 0); b.setFromCenterAndSize(c, new THREE.Vector3(Math.max(s.x, mn.x), Math.max(s.y, mn.y), s.z)); return b;
  }
  function flyToIds(ids) {
    const b = boxFor(ids), c = b.getCenter(new THREE.Vector3()), d = fitDist(b.getSize(new THREE.Vector3()), 1.15);
    atHome = false; flyTo(c.clone().addScaledVector(homeDir, Math.min(d, homeDist * 1.2)), c);
  }
  function resetView() { atHome = true; flyTo(home.pos, home.target); }
  controls.addEventListener('start', () => { tween = null; atHome = false; userT = 0; });
  controls.addEventListener('change', () => { dirty = true; });

  /* ------------------------------------------------ UI */
  const head = el('div', 'arch3d__head'); head.appendChild(el('strong', '', spec.title || '')); if (spec.summary) head.appendChild(el('span', '', spec.summary)); root.appendChild(head);
  const bar = el('div', 'arch3d__bar'); root.appendChild(bar);
  const bWalk = el('button', 'arch3d__btn arch3d__btn--primary', 'Walk through'); bWalk.type = 'button';
  const bReset = el('button', 'arch3d__btn', 'Reset view'); bReset.type = 'button';
  const bFlow = el('button', 'arch3d__btn', 'Flow: on'); bFlow.type = 'button'; bFlow.setAttribute('aria-pressed', 'true');
  if (stepsSpec.length) bar.appendChild(bWalk); bar.appendChild(bReset); if (!reduced && particles.length) bar.appendChild(bFlow);
  const tip = el('div', 'arch3d__tip'); tip.hidden = true; root.appendChild(tip);
  const card = el('aside', 'arch3d__card'); card.hidden = true;
  const cX = el('button', 'arch3d__x', '×'); cX.type = 'button'; cX.setAttribute('aria-label', 'Close details');
  const cKind = el('span', 'arch3d__kind'), cT = el('h3'), cSub = el('p', 'arch3d__sub'), cD = el('p', 'arch3d__detail'), cC = el('p', 'arch3d__conn');
  card.append(cX, cKind, cT, cSub, cD, cC); root.appendChild(card);
  const cap = el('div', 'arch3d__caption'); cap.hidden = true; cap.setAttribute('role', 'region'); cap.setAttribute('aria-label', 'Walkthrough'); cap.setAttribute('aria-live', 'polite');
  const capTop = el('div', 'arch3d__cap-top'); const capCount = el('span', 'arch3d__count'), capTitle = el('strong', 'arch3d__cap-title'); capTop.append(capCount, capTitle);
  const capText = el('p', 'arch3d__cap-text'); const capCtl = el('div', 'arch3d__cap-ctl');
  const mkb = (t, a) => { const b = el('button', 'arch3d__btn', t); b.type = 'button'; b.setAttribute('aria-label', a); return b; };
  const bPrev = mkb('‹ Prev', 'Previous step'), bPP = mkb('Pause', 'Pause or resume auto-advance'), bNext = mkb('Next ›', 'Next step'), bStop = mkb('Exit', 'Exit walkthrough');
  capCtl.append(bPrev, bPP, bNext, bStop); const prog = el('div', 'arch3d__progress'); const progI = el('i'); prog.appendChild(progI);
  cap.append(capTop, capText, capCtl, prog); root.appendChild(cap);
  if (reduced) bPP.hidden = true;
  const sr = el('ul', 'arch3d__sr'); sr.setAttribute('aria-label', 'Architecture components');
  nodesSpec.forEach((n) => {
    const li = el('li'), b = el('button', '', `${n.label}${n.sub ? ': ' + n.sub : ''}`); b.type = 'button';
    b.addEventListener('focus', () => setHover(n.id, null)); b.addEventListener('blur', () => setHover(null));
    b.addEventListener('click', () => selectNode(n.id)); li.appendChild(b); sr.appendChild(li);
  });
  root.appendChild(sr);

  /* ------------------------------------------------ state */
  let sel = null, walking = false, playing = false, stepIdx = 0, stepElapsed = 0, hoverId = null, flowOn = true;
  const STEP_MS = opts.stepMs || 4500;
  const stepSets = stepsSpec.map((s) => ({ nodes: new Set(s.nodes || []), links: new Set((s.links || []).map(([a, b]) => `${a}_${b}`)) }));
  const inSet = (set, lk) => set.links.has(lk.key) || set.links.has(`${lk.l.to}_${lk.l.from}`);
  function currentState() {
    if (sel) {
      const ns = new Set([sel]), ls = new Set();
      linksSpec.forEach((l) => { if (l.from === sel || l.to === sel) { ns.add(l.from); ns.add(l.to); ls.add(`${l.from}_${l.to}`); } });
      return { nodes: ns, links: ls, dim: 0.3 };
    }
    if (walking) return { ...stepSets[stepIdx], dim: 0.16 };
    return null;
  }
  const neighbours = (id) => ({
    from: linksSpec.filter((l) => l.to === id).map((l) => nodeById.get(l.from).spec.label),
    to: linksSpec.filter((l) => l.from === id).map((l) => nodeById.get(l.to).spec.label),
  });
  function selectNode(id) {
    const n = nodeById.get(id); if (!n) return;
    sel = id; if (walking) { playing = false; uiWalk(); }
    cKind.textContent = n.spec.kind || ''; cKind.style.setProperty('--c', n.colorHex); cT.textContent = n.spec.label; cSub.textContent = n.spec.sub || ''; cD.textContent = n.spec.detail || '';
    const nb = neighbours(id); cC.textContent = [nb.from.length ? 'Receives from ' + nb.from.join(', ') : '', nb.to.length ? 'Sends to ' + nb.to.join(', ') : ''].filter(Boolean).join(' · ');
    card.hidden = false; flyToIds([id]); dirty = true;
  }
  function clearSel() { sel = null; card.hidden = true; dirty = true; }
  function setHover(id, pt) {
    hoverId = id; dirty = true;
    if (!id) { tip.hidden = true; return; }
    const n = nodeById.get(id); tip.replaceChildren(el('b', '', n.spec.label), el('span', '', n.spec.sub || '')); tip.hidden = false; tipPt = pt;
  }
  let tipPt = null;
  function placeTip() {
    if (tip.hidden || !hoverId) return; const r = root.getBoundingClientRect(); let x, y;
    if (tipPt) { x = tipPt.x - r.left + 16; y = tipPt.y - r.top + 18; }
    else { const v = nodeById.get(hoverId).tilePos.clone(); world.localToWorld(v); v.project(camera); x = (v.x * 0.5 + 0.5) * r.width + 30; y = (-v.y * 0.5 + 0.5) * r.height - 10; }
    x = clamp(x, 6, r.width - tip.offsetWidth - 6); y = clamp(y, 6, r.height - tip.offsetHeight - 6); tip.style.transform = `translate(${x}px,${y}px)`;
  }
  /* walkthrough */
  function uiWalk() {
    bWalk.textContent = walking ? 'Stop walk' : 'Walk through'; bWalk.setAttribute('aria-pressed', String(walking)); cap.hidden = !walking;
    bPP.textContent = playing ? 'Pause' : 'Play';
  }
  function goStep(i) {
    const n = stepsSpec.length; stepIdx = ((i % n) + n) % n; stepElapsed = 0; clearSel();
    const s = stepsSpec[stepIdx]; capCount.textContent = `${stepIdx + 1} / ${n}`; capTitle.textContent = s.title || ''; capText.textContent = s.text || '';
    progI.style.width = '0%'; flyToIds(s.nodes && s.nodes.length ? s.nodes : nodesSpec.map((x) => x.id)); uiWalk(); dirty = true;
  }
  function startWalk(i = 0) { if (!stepsSpec.length) return; walking = true; playing = !reduced; goStep(i); }
  function stopWalk() { walking = false; playing = false; uiWalk(); dirty = true; resetView(); }
  bWalk.addEventListener('click', () => (walking ? stopWalk() : startWalk(0)));
  bStop.addEventListener('click', stopWalk);
  bPrev.addEventListener('click', () => goStep(stepIdx - 1)); bNext.addEventListener('click', () => goStep(stepIdx + 1));
  bPP.addEventListener('click', () => { playing = !playing; uiWalk(); });
  bReset.addEventListener('click', () => { clearSel(); if (walking) { walking = false; playing = false; uiWalk(); } resetView(); });
  bFlow.addEventListener('click', () => { flowOn = !flowOn; bFlow.textContent = 'Flow: ' + (flowOn ? 'on' : 'off'); bFlow.setAttribute('aria-pressed', String(flowOn)); particles.forEach((p) => (p.visible = flowOn)); dirty = true; });
  cX.addEventListener('click', () => { clearSel(); });
  const onKey = (e) => {
    if (e.key === 'Escape') { clearSel(); if (walking) { walking = false; playing = false; uiWalk(); } resetView(); }
    else if (walking && e.key === 'ArrowRight') goStep(stepIdx + 1); else if (walking && e.key === 'ArrowLeft') goStep(stepIdx - 1);
  };
  container.addEventListener('keydown', onKey);

  /* pointer */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let ptr = null, down = null, ptrDirty = false;
  const pick = (cx, cy) => {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(pickables, false); return h.length ? h[0].object.userData.nodeId : null;
  };
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; ptr = { x: e.clientX, y: e.clientY }; ptrDirty = true; });
  canvas.addEventListener('pointerleave', () => { ptr = null; if (document.activeElement && sr.contains(document.activeElement)) return; setHover(null); canvas.style.cursor = ''; });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 6 || dt > 600) return; const id = pick(e.clientX, e.clientY); if (id) selectNode(id); else if (sel) clearSel();
  });

  /* resize / visibility */
  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || 420;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (atHome && !tween) { { const h2 = { pos: home.pos.clone(), target: home.target.clone() }; fitHome(h2, sceneBox); home = h2; } applyLimits(); camera.position.copy(home.pos); controls.target.copy(home.target); controls.update(); }
    dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  let visible = true, tabHidden = document.hidden, raf = 0, last = 0, clock = 0, firstFrame = false;
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; run(); }, { threshold: 0.01 }); io.observe(container);
  const onVis = () => { tabHidden = document.hidden; run(); }; document.addEventListener('visibilitychange', onVis);
  function run() {
    const should = visible && !tabHidden && !disposed;
    if (should && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } else if (!should && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  /* ------------------------------------------------ frame */
  const tmp = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; userT += dt;
    if (tween) {
      tween.t += dt / tween.dur; const k = ease(Math.min(1, tween.t));
      camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k); if (tween.t >= 1) tween = null; dirty = true;
    }
    if (controls.update()) dirty = true;
    if (ptrDirty) {
      ptrDirty = false; const id = ptr ? pick(ptr.x, ptr.y) : null; canvas.style.cursor = id ? 'pointer' : '';
      if (id !== hoverId) setHover(id, ptr); else if (id) tipPt = ptr;
    }
    if (walking && playing && !sel) { stepElapsed += dt; progI.style.width = Math.min(100, (stepElapsed / (STEP_MS / 1000)) * 100) + '%'; if (stepElapsed * 1000 >= STEP_MS) goStep(stepIdx + 1); }
    // highlight state
    const st = currentState(), k = reduced ? 1 : 1 - Math.exp(-dt * 9); let moving = false;
    const step = (cur, target) => { const v = cur + (target - cur) * k; if (Math.abs(target - v) > 0.004) moving = true; else return target; return v; };
    nodes.forEach((n) => {
      n.vis = step(n.vis, st ? (st.nodes.has(n.id) ? 1 : st.dim) : 1);
      n.hov = step(n.hov, hoverId === n.id ? 1 : 0); n.sel = step(n.sel, sel === n.id ? 1 : 0);
      const v = n.vis, h = n.hov;
      n.faceMat.opacity = v; n.glow.material.opacity = (0.26 + 0.45 * h + 0.3 * n.sel) * v; n.label.material.opacity = v;
      if (n.body) { n.body.material.opacity = v; n.body.material.emissiveIntensity = 0.25 + 0.6 * h + 0.4 * n.sel; }
      if (n.look) n.look.apply(v, h + n.sel * 0.6);
      n.grp.scale.setScalar(ts * (1 + 0.07 * h + 0.04 * n.sel));
    });
    links.forEach((lk) => {
      const inS = st ? inSet(st, lk) : true;
      lk.vis = step(lk.vis, st ? (inS ? 1 : st.dim * 0.7) : 1); lk.act = step(lk.act, st && inS ? 1 : 0);
      if (lk.proc) lk.proc.apply(lk.vis, lk.act); if (lk.look) lk.look.apply(lk.vis, 0, lk.act);
      if (lk.labelSpr) lk.labelSpr.material.opacity = lk.vis;
      if (lk.parts) lk.parts.forEach((p) => { p.sp.material.opacity = lk.vis; });
    });
    groups.forEach((g) => {
      g.vis = step(g.vis, st ? (g.members.some((m) => st.nodes.has(m)) ? 1 : 0.4) : 1);
      if (g.look) g.look.apply(g.vis, 0, 0);
      if (g.proc) { g.proc.fill.material.opacity = 0.1 * g.vis; g.proc.line.material.opacity = 0.55 * g.vis; g.proc.spr.material.opacity = g.vis; }
      if (g.label) g.label.material.opacity = g.vis;
    });
    if (moving) dirty = true;
    // particles
    if (!reduced && flowOn) {
      links.forEach((lk) => { if (!lk.parts) return; lk.parts.forEach((p) => { polyAt(lk.pts, lk.cum, lk.len, (clock * 0.2 + p.ph) % 1, tmp); p.sp.position.copy(tmp); }); });
    }
    // idle sway (procedural only)
    if (!reduced && !glb) { const tgt = !st && !tween && userT > 3 ? Math.sin(clock * 0.3) * 0.07 : 0; world.rotation.y += (tgt - world.rotation.y) * 0.04; }
    placeTip();
    if (!reduced || dirty) {
      renderer.render(scene, camera); dirty = false;
      if (!firstFrame) { firstFrame = true; if (poster) { const p = poster; poster = null; p.style.opacity = '0'; setTimeout(() => p.remove(), 700); } root.classList.add('is-ready'); }
    }
  }
  run();
  if (opts.autoplay && stepsSpec.length) startWalk(0);

  /* ------------------------------------------------ handle */
  const handle = {
    mode, quality,
    unmount() {
      if (disposed) return; disposed = true;
      if (raf) cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); container.removeEventListener('keydown', onKey);
      controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach((m) => { Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); }); m.dispose(); });
      });
      if (glowTex) { glowTex.dispose(); glowTex = null; }
      renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ }
      root.remove(); container.classList.remove('arch3d');
    },
    play() { if (!stepsSpec.length) return; if (!walking) startWalk(0); else { playing = !reduced; uiWalk(); } },
    pause() { playing = false; uiWalk(); },
    select(id) { selectNode(id); },
    step(i) { if (!stepsSpec.length) return; if (!walking) startWalk(i); else goStep(i); },
  };
  return handle;
}

export function unmountArch(handle) { if (handle && handle.unmount) handle.unmount(); }
