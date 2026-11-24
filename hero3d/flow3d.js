/* flow3d.js - shared engine: immersive 3D architecture diagrams.
 *
 *   const h = await mountFlow(el, spec, opts);
 *   h -> { mode, camera, controls, getDistance(), zoomIn(), zoomOut(), reset(), focus(id), enter(boxId), exit(), setTab(id|null),
 *          startWalk(), stopWalk(), setTheme(t), setHeight(px|css), expand(), collapse(), project(id), unmount() }
 *
 * WORLD: layers/groups are thin-line wireframe volumes (corner brackets on layers), components are small grey boxes with the brand
 * icon on the top face, wires are thin gradient lines with bubbles (and short ghost trails), and every box fires thin lightning
 * arcs along its outgoing wires. Neutral monochrome + one accent (--primary, else #8ab4f8 dark / #1a73e8 light).
 * DEPTH: scene fog fades far geometry, soft additive glow on active boxes, a faint floor grid. No post-processing.
 * ENTER A BOX: double-click / Enter (or single click on the page's own technology) dollies in, the box becomes a wireframe shell
 * revealing its `inner` parts in flow order (own arcs, wires, bubbles). Back/Escape/Backspace reverses the dolly.
 * CONTROLS: wheel/pinch zoom to cursor, drag orbit, right-drag pan, WASD pan, Q/E down/up, arrows orbit, +/- zoom, R reset,
 *   double-click focus, Expand (full-viewport overlay), idle sway, first-mount fly-in.
 * CLICK: a box click dispatches CustomEvent 'flow3d:open' {href,id} on the host (href = box.href or #/tech/<slug>).
 *
 * SPEC: {title, tabs:[{id,label,focus|layers}] (max 3), layers:[{layer,label}], groups:[{id,label,boxes}],
 *   boxes:[{id,label,tech?,icon,layer,col,row,tone,href?,slug?,says?,detail?,inner?:[{id,label}]}],
 *   wires:[{from,to,style,flow,weight}], steps:[{title,text,boxes,wires}]}
 * opts: {theme, reducedMotion, tab, enter, flyIn:false, stepMs}
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { computeLayout, BOX, LAYER_GAP, CARD, SLAB_T, shapeFor, explodeOffsets, replicaLabel, ghostOffsets } from './flow-layout.js';
import { arcPoints, innerLayout, rng } from './flow-fx.js';

const LIFT = (CARD.h - BOX.h) / 2; // upright cards: tile centre sits LIFT above the flat-tile anchor so the card stands on the slab
const FOCUS_DIM = 0.12, FOCUS_NEIGHBOUR = 0.35, MIN_TILE_PX = 56;
const FOV = 18, PAD_FIT = 0.015, DEG = Math.PI / 180;
const VIEWS = [{ id: 'front', label: 'Front', az: -12, el: 31 }, { id: 'iso', label: 'Isometric', az: -45, el: 32 }, { id: 'bird', label: "Bird's eye", az: 0, el: 80 }];
const BIRD = 2;
const AZ = VIEWS[0].az * DEG, EL = VIEWS[0].el * DEG;
const BUBBLE_SPEED = 1.1, TR = 1, DIM = 0.25, FADE_OTHERS = 0.12, ARC_MAX = 16, ARC_SEG = 9;
const SWAY_SPEED = 0.015, SWAY_MAX = (12 * Math.PI) / 180, FLY_MS = 1600, ENTER_MS = 700;
const WIRE_W = 0.9, WIRE_W_BOLD = 1.3, WIRE_W_HOT = 1.2; // very thin wires (Line2 linewidth, px)
const SUB = { w: 0.6, h: 0.36, d: 0.6 };
const HINT_KEY = 'flow3d-hint-seen', Y_AXIS = new THREE.Vector3(0, 1, 0);

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0; return x; };
const isActor = (s) => /^actor-(dev|ops|user)$/.test(s || '');
const iconUrl = (s) => (s && !isActor(s) && /^[a-z0-9._-]+$/i.test(s) ? `https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/${s}.svg` : null);
const store = { get() { try { return sessionStorage.getItem(HINT_KEY); } catch { return null; } }, set() { try { sessionStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ } } };
const detectTheme = () => {
  const d = document.documentElement.getAttribute('data-theme'); if (d === 'light' || d === 'dark') return d;
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
};
function ensureCss() {
  try { if (document.querySelector('link[href*="flow3d.css"], link[data-flow3d]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.flow3d = '1'; l.href = new URL('./flow3d.css', import.meta.url).href; document.head.appendChild(l); } catch { /* host css */ }
}
function webglOk() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c); return glowTex;
}

function palette(theme, cssPrimary, cssBg) {
  const dark = theme === 'dark', col = (c) => new THREE.Color(c);
  let accent = col(dark ? '#8ab4f8' : '#1a73e8'), bg = col(dark ? '#202124' : '#ffffff');
  if (cssPrimary) { try { accent = new THREE.Color(cssPrimary); } catch { /* keep */ } }
  if (cssBg && /^#|^rgb/i.test(cssBg)) { try { bg = new THREE.Color(cssBg); } catch { /* keep */ } }
  return dark
    ? { dark, accent, bg, volume: col('#e8eaed'), volumeOp: 0.28, side: '#3a3c40', top: '#45474c', edge: col('#e8eaed'), edgeOp: 0.5, wire: col('#e8eaed'), floorOp: 0.05, icon: 'rgba(255,255,255,.8)' }
    : { dark, accent, bg, volume: col('#5f6368'), volumeOp: 0.34, side: '#e8eaed', top: '#f4f5f6', edge: col('#dadce0'), edgeOp: 1, wire: col('#3c4043'), floorOp: 0.05, icon: 'rgba(60,64,67,.85)' };
}

function fallbackList(container, spec, boxes) {
  container.classList.add('flow3d');
  const root = h('div', 'flow3d__root'), f = h('div', 'flow3d__fallback'); f.appendChild(h('h3', '', spec.title || 'Diagram'));
  const ul = h('ul'); boxes.forEach((b) => { const li = h('li'); const label = b.short || b.label || b.id; if (b.href || b.slug) { const a = h('a', '', label); a.href = b.href || `#/tech/${b.slug}`; li.appendChild(a); } else li.appendChild(h('strong', '', label)); ul.appendChild(li); });
  f.appendChild(ul); root.appendChild(f); container.appendChild(root);
  const n = () => {};
  return { mode: 'fallback', camera: null, getDistance: () => 0, zoomIn: n, zoomOut: n, reset: n, focus: n, enter: n, exit: n, setTab: n, startWalk: n, stopWalk: n, setTheme: n, setHeight: n, expand: n, collapse: n, unmount() { root.remove(); container.classList.remove('flow3d'); } };
}

export async function mountFlow(container, spec = {}, opts = {}) {
  ensureCss();
  const boxesSpec = (spec.boxes || []).filter((b) => b && b.id);
  const ids = new Set(boxesSpec.map((b) => b.id));
  /* Apple system colours (dark / light variants): blue, purple, pink, green, cyan, indigo. No orange. */
  const NEON = ['#0a84ff', '#bf5af2', '#ff375f', '#30d158', '#64d2ff', '#5e5ce6'].map((h) => new THREE.Color(h)), MATERIAL = ['#007aff', '#af52de', '#ff2d55', '#34c759', '#32ade6', '#5856d6'].map((h) => new THREE.Color(h));
  let composer = null, bloom = null, cw = 1, chg = 1;
  const BLOOM = false; // nothing blurred, crystal clear
  let layerKeysMemo = null;
  const layerCol = (k) => { if (!layerKeysMemo) layerKeysMemo = [...new Set(boxesSpec.map((b) => (Number.isFinite(b.layer) ? b.layer : 0)))].sort((a, b) => a - b); return (P.dark ? NEON : MATERIAL)[Math.max(0, layerKeysMemo.indexOf(k)) % NEON.length]; };
  const _sc = new THREE.Color(), _tc = new THREE.Color(), _white = new THREE.Color('#ffffff'), _black = new THREE.Color('#15161a'), _nGrey = new THREE.Color('#5f6368');
  const paintBox = (b, k) => { const lc = layerCol(b.layer); b.lc = lc; _sc.copy(lc); _tc.copy(lc); if (P.dark) { _sc.multiplyScalar(0.92); } else { _sc.lerp(_white, 0.02); } b.sideMat.color.copy(_sc).multiplyScalar(k); b.topMat.color.copy(_tc).multiplyScalar(k); b.sideMat.emissive.copy(lc); b.topMat.emissive.copy(lc); b.sideMat.emissiveIntensity = 0.06 + 0.3 * (k - 1); b.topMat.emissiveIntensity = 0.06 + 0.3 * (k - 1); if (b.hullMat) b.hullMat.color.copy(P.dark ? lc : _sc.copy(lc).multiplyScalar(0.55)); };
  if (!boxesSpec.length || !webglOk()) return fallbackList(container, spec, boxesSpec);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { return fallbackList(container, spec, boxesSpec); }

  container.classList.add('flow3d');
  const reduced = opts.reducedMotion ?? (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const fixedTheme = opts.theme === 'light' || opts.theme === 'dark' ? opts.theme : null;
  let theme = fixedTheme || detectTheme(); container.dataset.theme = theme;
  const cssVar = (n, d) => { try { const v = getComputedStyle(container).getPropertyValue(n).trim(); return v || d; } catch { return d; } };
  let P = palette(theme, cssVar('--primary', ''), cssVar('--bg', ''));

  const root = h('div', 'flow3d__root'); container.appendChild(root);
  let lowQ = false; const dprMax = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dprMax); renderer.setClearColor(0, 0);
  const canvas = renderer.domElement; canvas.className = 'flow3d__canvas'; root.appendChild(canvas);
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${spec.title || 'Diagram'}: interactive 3D diagram. Wheel to zoom, drag to rotate, double-click a component to look inside.`);
  const tagsEl = h('div', 'flow3d__tags'); root.appendChild(tagsEl);

  let disposed = false, dirty = true;
  const disposables = []; const own = (o) => { disposables.push(o); return o; };

  /* ---------- layout (pure) */
  const asp0 = Math.max(0.5, (container.clientWidth || 900) / Math.max(200, container.clientHeight || 520));
  const orthoExt = (Lx) => {
    const ca = Math.cos(AZ), sa = Math.sin(AZ), ce = Math.cos(EL), se = Math.sin(EL); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of Lx.volumes) for (const x of [v.min.x, v.max.x]) for (const y of [v.min.y, v.max.y]) for (const z of [v.min.z, v.max.z]) { const sx = x * ca - z * sa, sy = y * ce - (x * sa + z * ca) * se; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
    return { w: x1 - x0, h: y1 - y0 };
  };
  const E1 = orthoExt(computeLayout({ ...spec, boxes: boxesSpec }, { xScale: 1 })), E2 = orthoExt(computeLayout({ ...spec, boxes: boxesSpec }, { xScale: 2 }));
  const xScale = 1; // strict grid: never stretch columns
  const L = computeLayout({ ...spec, boxes: boxesSpec }, { xScale });
  const cen = { x: (L.bounds.min.x + L.bounds.max.x) / 2, y: (L.bounds.min.y + L.bounds.max.y) / 2, z: (L.bounds.min.z + L.bounds.max.z) / 2 };
  const V3 = (p) => new THREE.Vector3(p.x - cen.x, p.y - cen.y, p.z - cen.z);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500), world = new THREE.Group(); scene.add(world);
  scene.fog = new THREE.Fog(P.bg.getHex(), 50, 120);
  const amb = new THREE.AmbientLight(0xffffff, 0.75), dl = new THREE.DirectionalLight(0xffffff, 1.25), hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.55); dl.position.set(-6, 14, 10); scene.add(amb, hemi, dl);
  const setLights = () => { amb.intensity = P.dark ? 1.3 : 2.6; dl.intensity = P.dark ? 0.9 : 1.1; }; setLights();

  /* ---------- volumes + corner brackets + floor */
  const bracketGeo = (min, max, l) => {
    const pts = []; for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const sx = x === min.x ? 1 : -1, sy = y === min.y ? 1 : -1, sz = z === min.z ? 1 : -1;
      pts.push(x, y, z, x + sx * l, y, z, x, y, z, x, y + sy * l, z, x, y, z, x, y, z + sz * l);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  };
  function roundedSlab(w, d, t, rad) {
    const hw = w / 2, hd = d / 2, q = Math.min(rad, hw, hd), sh = new THREE.Shape();
    sh.moveTo(-hw + q, -hd); sh.lineTo(hw - q, -hd); sh.absarc(hw - q, -hd + q, q, -Math.PI / 2, 0, false); sh.lineTo(hw, hd - q); sh.absarc(hw - q, hd - q, q, 0, Math.PI / 2, false); sh.lineTo(-hw + q, hd); sh.absarc(-hw + q, hd - q, q, Math.PI / 2, Math.PI, false); sh.lineTo(-hw, -hd + q); sh.absarc(-hw + q, -hd + q, q, Math.PI, Math.PI * 1.5, false);
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 12 }); g.rotateX(-Math.PI / 2); g.translate(0, -t / 2, 0); return g;
  }
  const volumes = L.volumes.map((v) => {
    const min = V3(v.min), max = V3(v.max), size = max.clone().sub(min), c = min.clone().add(max).multiplyScalar(0.5);
    const isLayer = v.kind === 'layer';
    let slabGeo = null; if (isLayer) { if (v.vertical) { slabGeo = own(roundedSlab(size.x, size.y, SLAB_T, 0.55)); slabGeo.rotateX(Math.PI / 2); slabGeo.translate(0, 0, min.z + SLAB_T / 2 - c.z); } else { slabGeo = own(roundedSlab(size.x, size.z, SLAB_T, 0.55)); slabGeo.translate(0, min.y + SLAB_T / 2 - c.y, 0); } }
    const geo = isLayer ? own(new THREE.EdgesGeometry(slabGeo, 30)) : own(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)));
    const lk = v.kind === 'layer' ? Number(String(v.id).split(':')[1]) : null, mc = { color: lk !== null ? layerCol(lk) : P.volume, transparent: true, opacity: P.volumeOp, depthWrite: false };
    const mat = own(v.outside ? new THREE.LineDashedMaterial({ ...mc, dashSize: 0.35, gapSize: 0.22 }) : new THREE.LineBasicMaterial(mc));
    const line = new THREE.LineSegments(geo, mat); if (v.outside) line.computeLineDistances(); line.position.copy(c); line.renderOrder = 1; world.add(line);
    let brMat = null;
    let slabMat = null, sm = null; if (isLayer) { slabMat = own(new THREE.MeshBasicMaterial({ color: layerCol(lk), transparent: true, opacity: 0.14, depthWrite: false })); sm = new THREE.Mesh(slabGeo, slabMat); sm.position.copy(c); sm.renderOrder = 0; world.add(sm); }
    let postMat = null, pl = null; if (isLayer) { postMat = own(new THREE.LineBasicMaterial({ color: layerCol(lk), transparent: true, opacity: 0.12, depthWrite: false })); const pp = []; for (const x of [min.x, max.x]) for (const z of [min.z, max.z]) pp.push(x, min.y, z, x, max.y, z); pp.push(min.x, max.y, min.z, max.x, max.y, min.z, max.x, max.y, min.z, max.x, max.y, max.z, max.x, max.y, max.z, min.x, max.y, max.z, min.x, max.y, max.z, min.x, max.y, min.z); const pg = own(new THREE.BufferGeometry()); pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pl = new THREE.LineSegments(pg, postMat); pl.renderOrder = 1; world.add(pl); }
    const el = h('button', 'flow3d__vol flow3d__vol--' + v.kind, v.label || ''); el.type = 'button'; el.tabIndex = -1; if (!v.label) el.hidden = true;
    el.addEventListener('click', () => focus(v.id)); tagsEl.appendChild(el);
    const corners = []; for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z));
    return { ...v, z0: c.z, sm, pl, line, mat, brMat, slabMat, postMat, box3: new THREE.Box3(min, max), el, corners, anchor: new THREE.Vector3(min.x, isLayer && !v.outside ? min.y + SLAB_T : max.y, isLayer && !v.outside ? max.z : min.z), vis: 1, tvis: 1, w: 0 };
  });
  const volById = new Map(volumes.map((v) => [v.id, v]));
  const floor = (() => {
    const b = { x0: L.bounds.min.x - cen.x - 4, x1: L.bounds.max.x - cen.x + 4, z0: L.bounds.min.z - cen.z - 4, z1: L.bounds.max.z - cen.z + 4 }, y = L.bounds.min.y - cen.y - 0.02, pts = [], C = 2;
    for (let x = Math.ceil(b.x0 / C) * C; x <= b.x1; x += C) pts.push(x, y, b.z0, x, y, b.z1);
    for (let z = Math.ceil(b.z0 / C) * C; z <= b.z1; z += C) pts.push(b.x0, y, z, b.x1, y, z);
    const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = own(new THREE.LineBasicMaterial({ color: P.volume, transparent: true, opacity: P.floorOp, depthWrite: false })); const o = new THREE.LineSegments(g, m); o.renderOrder = 0; world.add(o); return m;
  })();

  /* ---------- node factory (boxes and inner parts share one record shape) */
  const BRAND = { kong: '#1155cb', nginx: '#009639', kubernetes: '#326ce5', docker: '#2496ed', amazonaws: '#ff9900', vmware: '#607078', linux: '#1d1d1f', redis: '#dc382d', istio: '#466bb0', keycloak: '#4d6fa8', grafana: '#f46800', prometheus: '#e6522c', ansible: '#ee0000', jenkins: '#d24939', vault: '#1d1d1f', apachekafka: '#231f20', postgresql: '#336791', python: '#3776ab', elasticsearch: '#00bfb3', nodedotjs: '#5fa04e', minio: '#c72e49', k6: '#7d64ff', haproxy: '#2b7fb8', git: '#f05032', googlechrome: '#4285f4', opentelemetry: '#425cc7', springboot: '#6db33f', windows: '#0078d4', containerd: '#575757', sonarqube: '#4e9bcd', argo: '#ef7b4d', amazonec2: '#ff9900', amazons3: '#3f8624', amazoncloudwatch: '#e7157b', amazonroute53: '#8c4fff', mongodb: '#47a248', react: '#087ea4', apachesuperset: '#20a7c9' };
  /* built-in vector glyphs on the white plate: person silhouette; ops adds a gear, dev adds </> (Apple blue) */
  function drawActor(x, kind, blue) {
    x.fillStyle = blue; x.strokeStyle = blue;
    x.beginPath(); x.arc(58, 44, 17, 0, Math.PI * 2); x.fill();
    x.save(); x.beginPath(); x.rect(0, 0, 128, 118); x.clip(); x.beginPath(); x.ellipse(58, 118, 36, 40, 0, Math.PI, 0); x.fill(); x.restore();
    if (kind === 'actor-user') return;
    const cx = 97, cy = 97; x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx, cy, 25, 0, Math.PI * 2); x.fill();
    x.fillStyle = blue; x.beginPath(); x.arc(cx, cy, 22, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.strokeStyle = '#ffffff';
    if (kind === 'actor-ops') {
      for (let i = 0; i < 8; i++) { x.save(); x.translate(cx, cy); x.rotate((i * Math.PI) / 4); x.fillRect(-3, -15, 6, 7); x.restore(); }
      x.beginPath(); x.arc(cx, cy, 10, 0, Math.PI * 2); x.fill(); x.fillStyle = blue; x.beginPath(); x.arc(cx, cy, 4.5, 0, Math.PI * 2); x.fill();
    } else { x.font = '700 21px ui-monospace, Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('</>', cx, cy + 1); }
  }
  const mkIcon = (b, label, circ) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), tex = own(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const st = { img: null, canvas: c }, url = iconUrl(b.icon);
    const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gx = gc.getContext('2d');
    st.draw = () => {
      x.clearRect(0, 0, 128, 128);
      const R = 29, plate = x.createLinearGradient(0, 0, 128, 128); plate.addColorStop(0, '#ffffff'); plate.addColorStop(1, P.dark ? '#dfe2e8' : '#eceef3');
      x.fillStyle = plate; x.beginPath(); if (circ) x.arc(64, 64, 64, 0, Math.PI * 2); else { x.moveTo(R, 0); x.arcTo(128, 0, 128, 128, R); x.arcTo(128, 128, 0, 128, R); x.arcTo(0, 128, 0, 0, R); x.arcTo(0, 0, 128, 0, R); x.closePath(); } x.fill();
      if (isActor(b.icon)) { drawActor(x, b.icon, P.dark ? '#0a84ff' : '#007aff'); tex.needsUpdate = true; dirty = true; return; }
      const brand = BRAND[b.icon] || '#3a3a3c';
      if (st.img) { gx.clearRect(0, 0, 128, 128); gx.globalCompositeOperation = 'source-over'; gx.drawImage(st.img, 22, 22, 84, 84); gx.globalCompositeOperation = 'source-in'; gx.fillStyle = brand; gx.fillRect(0, 0, 128, 128); gx.globalCompositeOperation = 'source-over'; x.drawImage(gc, 0, 0); }
      else { x.fillStyle = brand; x.font = '700 64px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?', 64, 68); }
      tex.needsUpdate = true; dirty = true;
    };
    st.draw();
    if (url) { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { if (disposed) return; st.img = img; st.draw(); }; img.src = url; }
    return { tex, st };
  };
  const U = BOX.w / 1.9; // geometry below was designed for a 1.9 cube; the cube is now BOX.w
  const SHAPE_DIM = { cube: { hgt: 1.9 * U, rad: 0.95 * U, hd: 0.95 * U }, cuboid: { hgt: 1.5 * U, rad: 1.3 * U, hd: 0.65 * U }, sphere: { hgt: 1.9 * U, rad: 0.95 * U, hd: 0.95 * U }, cone: { hgt: 2.2 * U, rad: 1.1 * U, hd: 1.1 * U } };
  const shapeGeos = {}, shapeGeo = (k) => shapeGeos[k] || (shapeGeos[k] = own(k === 'cube' ? new RoundedBoxGeometry(1.9 * U, 1.9 * U, 1.9 * U, 5, 0.3 * U) : k === 'cuboid' ? new RoundedBoxGeometry(2.6 * U, 1.5 * U, 1.3 * U, 5, 0.22 * U) : k === 'sphere' ? new THREE.SphereGeometry(0.95 * U, 40, 28) : new THREE.ConeGeometry(1.1 * U, 2.2 * U, 48, 1)));
  const PLATES = { cube: { w: 1.4, front: [0, 0, 0.96, 0], top: [0, 0.97, 0] }, cuboid: { w: 1.1, front: [0, 0, 0.66, 0], top: [0, 0.76, 0] }, sphere: { w: 1.0, front: [0, 0, 0.93, 0], top: [0, 0.96, 0] }, cone: { w: 0.9, front: [0, -0.22, 0.69, -0.4636], top: [0, 1.12, 0] } };
  const plateGeos = {}, plateFor = (k) => { const p = PLATES[k]; return { geo: plateGeos[k] || (plateGeos[k] = own(new THREE.PlaneGeometry(p.w * U, p.w * U))), front: { pos: new THREE.Vector3(p.front[0] * U, p.front[1] * U, p.front[2] * U), rotX: p.front[3] }, top: { pos: new THREE.Vector3(p.top[0] * U, p.top[1] * U, p.top[2] * U), rotX: -Math.PI / 2 } }; };
  const boxEdge = own(new THREE.BufferGeometry());
  const shadowGeo = own(new THREE.PlaneGeometry(BOX.w * 1.6, 1.3 * U));
  const subGeo = own(new THREE.BoxGeometry(SUB.w, SUB.h, SUB.d)), subEdge = own(new THREE.EdgesGeometry(subGeo));
  const techCount = new Map(); boxesSpec.forEach((b) => techCount.set(b.tech, (techCount.get(b.tech) || 0) + 1));
  const pickables = [], boxes = [], subs = [], boxById = new Map(), nodeById = new Map();
  let hover = null, lf = null; // lf: focused layer key (chip bar) or null = All
  function mkNode(o) {
    if (!o.sub) { o.shape = shapeFor(o.spec); Object.assign(o, SHAPE_DIM[o.shape]); o.lift = o.hgt / 2 - BOX.h / 2; o.base = o.pos.clone(); }
    const g = new THREE.Group(); g.position.copy(o.pos); if (!o.sub) g.position.y += o.lift; world.add(g);
    const sideMat = own(new THREE.MeshStandardMaterial({ color: P.side, roughness: 0.2, metalness: 0.12, emissive: 0x000000, emissiveIntensity: 0.22, transparent: true })), topMat = own(new THREE.MeshStandardMaterial({ color: P.top, roughness: 0.28, metalness: 0.06, emissive: 0x000000, emissiveIntensity: 0.2, transparent: true }));
    const mesh = new THREE.Mesh(o.sub ? subGeo : shapeGeo(o.shape), o.sub ? [sideMat, sideMat, topMat, sideMat, sideMat, sideMat] : sideMat); g.add(mesh);
    if (!o.sub) { const shMat = own(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: P.dark ? 0.5 : 0.2, depthWrite: false })); const shd = new THREE.Mesh(shadowGeo, shMat); shd.rotation.x = -Math.PI / 2; shd.position.y = -o.hgt / 2 + 0.03; shd.scale.set(o.rad / (0.95 * U), 1, o.hd / (0.95 * U)); shd.renderOrder = 0; g.add(shd); o.shMat = shMat; o.shd = shd; }
    const edgeMat = own(new THREE.LineBasicMaterial({ color: P.edge, transparent: true, opacity: P.edgeOp })); g.add(new THREE.LineSegments(o.sub ? subEdge : boxEdge, edgeMat));
    let hullMat = null; if (!o.sub) { hullMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false })); const hull = new THREE.Mesh(shapeGeo(o.shape), hullMat); hull.scale.set(1.06, 1.16, 1.06); hull.renderOrder = 0; g.add(hull); }
    const glowMat = own(new THREE.SpriteMaterial({ map: glowTexture(), color: P.accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const glow = new THREE.Sprite(glowMat); glow.renderOrder = 2; g.add(glow);
    let imat = null;
    if (!o.sub) { const ic = mkIcon(o.spec, o.short, o.shape === 'sphere' || o.shape === 'cone'); imat = own(new THREE.MeshBasicMaterial({ map: ic.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); const pl = plateFor(o.shape), icon = new THREE.Mesh(pl.geo, imat); icon.position.copy(pl.front.pos); icon.rotation.x = pl.front.rotX; g.add(icon); o.iconSt = ic.st; o.icon = icon; o.plate = pl; }
    o.ghosts = [];
    if (!o.sub) ghostOffsets(o.spec.replicas).forEach((gh) => { const gs = own(new THREE.MeshStandardMaterial({ color: P.side, roughness: 0.2, metalness: 0.12, transparent: true })), gt = own(new THREE.MeshStandardMaterial({ color: P.top, roughness: 0.28, metalness: 0.06, transparent: true })), gm = new THREE.Mesh(shapeGeo(o.shape), gs); gm.position.set(0, gh.dy, gh.dz); gm.renderOrder = 0; g.add(gm); o.ghosts.push({ ...gh, mesh: gm, gs, gt }); });
    const lb = h('button', 'flow3d__lbl' + (o.sub ? ' flow3d__lbl--sub' : ''), o.text); lb.type = 'button'; lb.tabIndex = o.sub ? -1 : 0; tagsEl.appendChild(lb);
    Object.assign(o, { g, mesh, sideMat, topMat, edgeMat, hullMat, glow, glowMat, imat, lbl: lb, lw: 0, vis: o.sub ? 0 : 1, tvis: o.sub ? 0 : 1, act: 0, tact: 0, hide: 0, phase: (hash(o.id) % 1000) / 1000, fire: -99, outs: [], nextAt: 0.4 + (hash(o.id + 'n') % 1800) / 1000 });
    mesh.userData.node = o; pickables.push(mesh); nodeById.set(o.id, o);
    lb.addEventListener('pointerenter', () => setHover(o)); lb.addEventListener('pointerleave', () => setHover(null)); if (!o.sub) { lb.addEventListener('focus', () => setHover(o)); lb.addEventListener('blur', () => setHover(null)); }
    return o;
  }
  boxesSpec.forEach((b) => {
    const lay = L.boxes.find((q) => q.id === b.id), short = b.short || b.label || b.id, text = replicaLabel((techCount.get(b.tech) === 1 ? b.tech : b.label || b.tech || b.short) || b.id, b.replicas);
    const rec = mkNode({ id: b.id, spec: b, label: b.label || b.short || b.id, short, text, href: b.href || (b.slug ? `#/tech/${b.slug}` : null), pos: V3(lay.pos), bright: /^(blue|indigo|grey|gray|slate)$/i.test(String(b.tone || 'blue')) ? 1 : 1.05, subs: [], layer: lay.layer });
    boxes.push(rec); boxById.set(b.id, rec);
    rec.lbl.addEventListener('click', () => boxClick(rec)); rec.lbl.addEventListener('dblclick', () => { clearTimeout(clickTimer); enter(rec.id); });
    rec.lbl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); clearTimeout(clickTimer); enter(rec.id); } });
    const parts = (Array.isArray(b.inner) ? b.inner : []).map((p) => (typeof p === 'string' ? { id: p, label: p } : p)).filter((p) => p && (p.id || p.label)).slice(0, 7);
    if (parts.length) {
      const lay2 = innerLayout(parts, { size: SUB.w, minGap: 1.0 }), span = Math.max(...lay2.map((p) => p.pos.x)) - Math.min(...lay2.map((p) => p.pos.x));
      const sh = { w: span + 2.2, h: 2.2, d: 3.0 }, shGeo = own(new THREE.EdgesGeometry(new THREE.BoxGeometry(sh.w, sh.h, sh.d))), shMat = own(new THREE.LineBasicMaterial({ color: P.volume, transparent: true, opacity: 0, depthWrite: false }));
      const shell = new THREE.LineSegments(shGeo, shMat); shell.position.copy(rec.pos); shell.visible = false; shell.renderOrder = 1; world.add(shell);
      rec.shell = { obj: shell, mat: shMat, dims: sh, op: 0 }; rec.shellCorners = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) rec.shellCorners.push(rec.pos.clone().add(new THREE.Vector3(sx * sh.w / 2, sy * sh.h / 2, sz * sh.d / 2)));
      lay2.forEach((p, i) => { const s = mkNode({ id: `${b.id}/${p.id}`, sub: true, owner: rec, label: p.label, short: p.label, text: p.label, pos: rec.pos.clone().add(new THREE.Vector3(p.pos.x, 0, p.pos.z)), bright: 1 }); s.g.visible = false; rec.subs.push(s); subs.push(s); });
    }
  });
  const nodes = boxes.concat(subs);

  /* ---------- wires (outer + inner) */
  const wires = [], res = new THREE.Vector2(1, 1);
  const wiresSpec = (spec.wires || []).filter((w) => ids.has(w.from) && ids.has(w.to) && w.from !== w.to);
  const has = new Set(wiresSpec.map((w) => w.from + '>' + w.to));
  /* orthogonal (Manhattan) schematic routing with rounded joints */
  const CORNER_R = 0.25;
  const stackVols = volumes.filter((v) => v.kind === 'layer' && !v.outside), stackHalfW = stackVols.length ? Math.max(...stackVols.map((v) => v.box3.max.x)) : 0;
  const layerVol = (k) => volumes.find((v) => v.id === 'layer:' + k);
  const outsideKeys = new Set(volumes.filter((v) => v.outside).map((v) => Number(String(v.id).split(':')[1])));
  const lanes = new Map(), lane = (key, id) => { if (!lanes.has(key)) lanes.set(key, []); const l = lanes.get(key); if (!l.includes(id)) l.push(id); return l; };
  wiresSpec.forEach((w) => { const a = boxById.get(w.from), b = boxById.get(w.to), id = w.from + '>' + w.to; if (Math.abs(a.pos.y - b.pos.y) > 0.01 && !outsideKeys.has(a.layer) && !outsideKeys.has(b.layer)) { const up = b.pos.y > a.pos.y; lane(`${a.id}:${up ? 'u' : 'd'}`, id); lane(`${b.id}:${up ? 'd' : 'u'}`, id); lane(`c:${Math.min(a.layer, b.layer)}:${Math.max(a.layer, b.layer)}`, id); } });
  const laneOff = (key, id, step, cap) => { const l = lanes.get(key) || [id], n = l.length, st = n > 1 ? Math.min(step, cap / (n - 1)) : 0; return (l.indexOf(id) - (n - 1) / 2) * st; };
  function polyCurve(P) {
    const R = CORNER_R, pts = [P[0].clone()];
    for (let i = 1; i < P.length - 1; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], d1 = p1.clone().sub(p0), d2 = p2.clone().sub(p1), r = Math.min(R, d1.length() / 2, d2.length() / 2);
      if (r < 1e-4 || d1.clone().normalize().dot(d2.clone().normalize()) > 0.999) { pts.push(p1.clone()); continue; }
      const A = p1.clone().addScaledVector(d1.normalize(), -r), B = p1.clone().addScaledVector(d2.normalize(), r);
      for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; pts.push(A.clone().multiplyScalar(u * u).addScaledVector(p1, 2 * u * t).addScaledVector(B, t * t)); }
    }
    pts.push(P[P.length - 1].clone());
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1];
    return { getLength: () => total, getSpacedPoints(n) { const out = []; let j = 1; for (let i = 0; i <= n; i++) { const d = (i / n) * total; while (j < cum.length - 1 && cum[j] < d) j++; const t = (d - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1]); out.push(pts[j - 1].clone().lerp(pts[j], clamp(t, 0, 1))); } return out; } };
  }
  function routeCurve(a, b) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z), id = a.id + '>' + b.id, clean = (P) => P.filter((p, i) => !i || p.distanceTo(P[i - 1]) > 1e-4);
    const base = (n) => n.pos.y - BOX.h / 2, mid = (n) => base(n) + n.hgt / 2, top = (n) => base(n) + n.hgt;
    const aOut = outsideKeys.has(a.layer), bOut = outsideKeys.has(b.layer), dy = b.pos.y - a.pos.y;
    const frontZ = (k) => { const lv = layerVol(k); return lv ? lv.box3.max.z - 0.5 : 0; };
    if (a.layer === b.layer && outsideKeys.has(a.layer)) { // inside one zone
      if (Math.abs(a.pos.x - b.pos.x) < 0.01 && Math.abs(a.pos.y - b.pos.y) < 0.01) { const sz = Math.sign(b.pos.z - a.pos.z) || 1; return polyCurve([V(a.pos.x, mid(a), a.pos.z + sz * a.hd), V(b.pos.x, mid(b), b.pos.z - sz * b.hd)]); }
      if (Math.abs(a.pos.x - b.pos.x) < 0.01) { const sg = Math.sign(b.pos.y - a.pos.y) || 1; return polyCurve([V(a.pos.x, sg > 0 ? top(a) : base(a), a.pos.z), V(b.pos.x, sg > 0 ? base(b) : top(b), b.pos.z)]); }
      const s2 = Math.sign(b.pos.x - a.pos.x) || 1, xm2 = (a.pos.x + b.pos.x) / 2;
      return polyCurve(clean([V(a.pos.x + s2 * a.rad, mid(a), a.pos.z), V(xm2, mid(a), a.pos.z), V(xm2, mid(b), b.pos.z), V(b.pos.x - s2 * b.rad, mid(b), b.pos.z)]));
    }
    if (aOut || bOut) { // between zones: horizontal at the tiles' mid-height, vertical in the gutter next to the source zone
      const sg = Math.sign(b.pos.x - a.pos.x) || 1, va = layerVol(a.layer), xm = (sg > 0 ? va.box3.max.x : va.box3.min.x) + sg * 2.0;
      return polyCurve(clean([V(a.pos.x + sg * a.rad, mid(a), a.pos.z), V(xm, mid(a), a.pos.z), V(xm, mid(a), b.pos.z), V(xm, mid(b), b.pos.z), V(b.pos.x - sg * b.rad, mid(b), b.pos.z)]));
    }
    if (false) {
      const o = aOut ? a : b, t = aOut ? b : a, sgn = o.pos.x < 0 ? -1 : 1, xo = sgn * (stackHalfW + 1.6), zf = frontZ(t.layer);
      const P = clean([V(o.pos.x - sgn * o.rad, mid(o), o.pos.z), V(xo, mid(o), o.pos.z), V(xo, mid(o), zf), V(xo, mid(t), zf), V(t.pos.x, mid(t), zf), V(t.pos.x, mid(t), t.pos.z + t.hd)]);
      return polyCurve(aOut ? P : P.slice().reverse());
    }
    if (Math.abs(dy) > 0.01) {
      const up = dy > 0;
      if (Math.abs(layerIndexGap(a, b)) > 1) { // skip wire: front corridor, round the outside of the stack
        const sgn = (a.pos.x + b.pos.x) >= 0 ? 1 : -1, xo = sgn * (stackHalfW + 1.2 + (hash(id) % 4) * 0.34), za = frontZ(a.layer), zb = frontZ(b.layer);
        return polyCurve(clean([V(a.pos.x, mid(a), a.pos.z + a.hd), V(a.pos.x, mid(a), za), V(xo, mid(a), za), V(xo, mid(b), zb), V(b.pos.x, mid(b), zb), V(b.pos.x, mid(b), b.pos.z + b.hd)]));
      }
      const lo = (n) => (n.shape === 'cone' ? 0 : 1), ax = a.pos.x + lo(a) * laneOff(`${a.id}:${up ? 'u' : 'd'}`, id, 0.4, 1.4), bx = b.pos.x + lo(b) * laneOff(`${b.id}:${up ? 'd' : 'u'}`, id, 0.4, 1.4);
      const la = layerVol(a.layer), lb = layerVol(b.layer), lowV = up ? la : lb, hiV = up ? lb : la;
      const yc = (lowV.box3.max.y + hiV.box3.min.y) / 2 + laneOff(`c:${Math.min(a.layer, b.layer)}:${Math.max(a.layer, b.layer)}`, id, 0.3, 1.6);
      return polyCurve(clean([V(ax, up ? top(a) : base(a), a.pos.z), V(ax, yc, a.pos.z), V(bx, yc, b.pos.z), V(bx, up ? base(b) : top(b), b.pos.z)]));
    }
    const sx = Math.sign(b.pos.x - a.pos.x) || 1;
    if (Math.abs(a.pos.z - b.pos.z) < 0.01) {
      const between = boxes.some((q) => q !== a && q !== b && q.layer === a.layer && Math.abs(q.pos.z - a.pos.z) < 0.01 && q.pos.x > Math.min(a.pos.x, b.pos.x) + 0.1 && q.pos.x < Math.max(a.pos.x, b.pos.x) - 0.1);
      if (!between) return polyCurve([V(a.pos.x + sx * a.rad, mid(a), a.pos.z), V(b.pos.x - sx * b.rad, mid(b), b.pos.z)]);
    }
    if (Math.abs(a.pos.x - b.pos.x) < 0.01) { const sz = Math.sign(b.pos.z - a.pos.z) || 1; return polyCurve([V(a.pos.x, mid(a), a.pos.z + sz * a.hd), V(b.pos.x, mid(b), b.pos.z - sz * b.hd)]); }
    const zf = frontZ(a.layer) + (hash(id) % 3) * 0.2; // front corridor
    return polyCurve(clean([V(a.pos.x, mid(a), a.pos.z + a.hd), V(a.pos.x, mid(a), zf), V(b.pos.x, mid(b), zf), V(b.pos.x, mid(b), b.pos.z + b.hd)]));
  }
  const layerIndexGap = (a, b) => { const ks = stackVols.map((v) => Number(String(v.id).split(':')[1])).sort((p, q) => p - q); return ks.indexOf(a.layer) - ks.indexOf(b.layer); };
  const innerCurve = (a, b) => { const sx = Math.sign(b.pos.x - a.pos.x) || 1, S = a.pos.clone().add(new THREE.Vector3(sx * SUB.w / 2, 0, 0)), E = b.pos.clone().add(new THREE.Vector3(-sx * SUB.w / 2, 0, 0)), t = S.distanceTo(E) * 0.35; return new THREE.CubicBezierCurve3(S, S.clone().add(new THREE.Vector3(sx * t, 0.25, 0)), E.clone().add(new THREE.Vector3(-sx * t, 0.25, 0)), E); };
  const arrowGeo = own(new THREE.ConeGeometry(0.03, 0.1, 8));
  const nodeCol = (n) => (n && n.layer !== undefined && n.layer !== null ? layerCol(n.layer) : P.accent);
  const gradColors = (n, a, b, lt = 0) => { const arr = [], ca = nodeCol(a), cb = nodeCol(b), c = new THREE.Color(); for (let i = 0; i < n; i++) { c.copy(ca).lerp(cb, i / Math.max(1, n - 1)); if (lt) c.lerp(_white, lt); arr.push(c.r, c.g, c.b); } return arr; };
  function addWire(a, b, curve, spec2, inner) {
    const pts = curve.getSpacedPoints(64), len = curve.getLength(), dashed = spec2.style === 'dashed', bold = spec2.weight === 'bold';
    const geo = own(new LineGeometry()); geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z])); geo.setColors(gradColors(pts.length, a, b));
    const mat = own(new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: bold ? WIRE_W_BOLD : WIRE_W, transparent: true, opacity: 1, dashed, dashSize: 0.14, gapSize: 0.1, resolution: res, depthWrite: false, fog: true }));
    const hlMat = own(new LineMaterial({ color: P.accent.getHex(), linewidth: WIRE_W_HOT, transparent: true, opacity: 0, dashed, dashSize: 0.14, gapSize: 0.1, resolution: res, depthWrite: false, fog: true }));
    const line = new Line2(geo, mat), hl = new Line2(geo, hlMat); if (dashed) { line.computeLineDistances(); hl.computeLineDistances(); } line.renderOrder = 3; hl.renderOrder = 3; world.add(line, hl);
    const geoP = own(new LineGeometry()); geoP.setPositions(pts.flatMap((p) => [p.x, p.y, p.z])); geoP.setColors(gradColors(pts.length, a, b, 0.55));
    const pMat = own(new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: 1.0, transparent: true, opacity: 1, dashed: true, dashSize: 0.55, gapSize: 1.6, resolution: res, depthWrite: false, fog: true })), pulse = new Line2(geoP, pMat); pulse.computeLineDistances(); pulse.renderOrder = 4; world.add(pulse);
    const arMat = own(new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.5, depthWrite: false })), arrow = new THREE.Mesh(arrowGeo, arMat), end = pts[pts.length - 1], pre = pts[pts.length - 3];
    arrow.position.copy(end).addScaledVector(end.clone().sub(pre).normalize(), -0.06); arrow.quaternion.setFromUnitVectors(Y_AXIS, end.clone().sub(pre).normalize()); if (inner) arrow.scale.setScalar(0.7); arrow.renderOrder = 4; world.add(arrow);
    const flow = spec2.flow !== false, n = 0, r = rng(hash(a.id + b.id)); // charge pulses replace the bubbles
    pMat.dashOffset = r() * 2.15; const w = { dashed, geoP, pulse, pMat, speed: 1.4 + r() * 0.8, a, b, pts, len, geo, line, mat, hl, hlMat, arMat, arrow, inner: !!inner, vis: inner ? 0 : 1, tvis: inner ? 0 : 1, act: 0, tact: 0, flow, n, off: r(), speeds: Array.from({ length: n }, () => 0.8 + r() * 0.4) };
    line.visible = hl.visible = arrow.visible = !inner; pulse.visible = !inner && flow; wires.push(w); a.outs.push(w); return w;
  }
  /* AERIAL WIRES (user: 'make the wires fly in the air, curves from one component to another'): every wire is a smooth 3D arc
     that leaves the TOP of one cube, rises into the air and lands on the TOP of the other. Each wire gets its own arch height
     (lift) and its own small lateral offset at both ends, so two wires never share a path or touch. Set AERIAL=false to get the old routed wires. */
  const AERIAL = true;
  const aerialIdx = new Map(); wiresSpec.forEach((w, i) => aerialIdx.set(w.from + '>' + w.to, i));
  const outCount = new Map(), inCount = new Map(); wiresSpec.forEach((w) => { outCount.set(w.from, (outCount.get(w.from) || 0) + 1); inCount.set(w.to, (inCount.get(w.to) || 0) + 1); });
  const outSeen = new Map(), inSeen = new Map();
  function aerialCurve(a, b, id) {
    const i = aerialIdx.get(id) || 0, topY = (CARD.h || BOX.w) / 2 + 0.05;
    const oa = (outSeen.get(a.id) || 0), ob = (inSeen.get(b.id) || 0); outSeen.set(a.id, oa + 1); inSeen.set(b.id, ob + 1);
    const na = outCount.get(a.id) || 1, nb = inCount.get(b.id) || 1, spread = 0.38;
    const ax = (oa - (na - 1) / 2) * spread, bx = (ob - (nb - 1) / 2) * spread;
    const P0 = a.pos.clone().add(new THREE.Vector3(ax, topY, 0)), P3 = b.pos.clone().add(new THREE.Vector3(bx, topY, 0));
    const d = P3.clone().sub(P0), dist = Math.hypot(d.x, d.z) + Math.abs(d.y) * 0.6;
    const lift = 1.4 + Math.min(dist * 0.22, 9) + (i % 11) * 0.55 + (hash(id) % 5) * 0.12; // unique height per wire: they never touch
    const C1 = P0.clone().add(new THREE.Vector3(d.x * 0.22, lift, d.z * 0.22)), C2 = P3.clone().add(new THREE.Vector3(-d.x * 0.22, lift, -d.z * 0.22));
    return new THREE.CubicBezierCurve3(P0, C1, C2, P3);
  }
  wiresSpec.forEach((w) => { const a = boxById.get(w.from), b = boxById.get(w.to), id = w.from + '>' + w.to; addWire(a, b, AERIAL ? aerialCurve(a, b, id) : routeCurve(a, b), w, false); });
  boxes.forEach((bx) => { for (let i = 0; i + 1 < bx.subs.length; i++) { const a = bx.subs[i], b = bx.subs[i + 1]; const w = addWire(a, b, innerCurve(a, b), { flow: true }, true); w.owner = bx; } });
  subs.forEach((s) => { s.owner.subs.forEach(() => {}); });

  const nB = wires.reduce((s, w) => s + w.n, 0), NI = TR + 1;
  const bubbleMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })), bubbleGeo = own(new THREE.SphereGeometry(0.035, 10, 8));
  const bubbles = new THREE.InstancedMesh(bubbleGeo, bubbleMat, Math.max(1, nB * NI)); bubbles.count = nB * NI; bubbles.frustumCulled = false; bubbles.renderOrder = 5; world.add(bubbles);
  const paintBubbles = () => { const c = new THREE.Color(); for (let i = 0; i < nB; i++) for (let g = 0; g < NI; g++) { c.set('#ffffff').lerp(P.accent, g === 0 ? 0.05 : 0.3 + 0.15 * g); bubbles.setColorAt(i * NI + g, c); } if (nB) bubbles.instanceColor.needsUpdate = true; };
  paintBubbles();
  const tmp = new THREE.Object3D(), _p = new THREE.Vector3();
  const ptAt = (w, u, out) => { const f = clamp(u, 0, 1) * (w.pts.length - 1), i = Math.min(w.pts.length - 2, Math.floor(f)); return out.copy(w.pts[i]).lerp(w.pts[i + 1], f - i); };
  function animateFlow(t) {
    let bi = 0;
    wires.forEach((w) => {
      if (!w.flow) return; const show = w.vis > 0.3;
      for (let k = 0; k < w.n; k++, bi++) {
        const u = ((k / w.n + w.off + (t * BUBBLE_SPEED * w.speeds[k]) / w.len) % 1 + 1) % 1;
        for (let g = 0; g < NI; g++) {
          const ug = u - (g * 0.11) / w.len, ok = show && ug >= 0 && (g === 0 || !lowQ);
          if (ok) { ptAt(w, ug, _p); tmp.position.copy(_p); tmp.scale.setScalar(1 - g * 0.16); } else { tmp.position.set(0, -999, 0); tmp.scale.setScalar(0); }
          tmp.updateMatrix(); bubbles.setMatrixAt(bi * NI + g, tmp.matrix);
        }
      }
    });
    bubbles.instanceMatrix.needsUpdate = true;
  }

  /* ---------- ambient life (crisp, no blur): ~60 drifting sparkle points + a one-time light sweep around each floor outline, bottom to top */
  const stackFloors = volumes.filter((v) => v.kind === 'layer' && !v.outside).sort((p, q) => p.min.y - q.min.y);
  const SPK = 60, spk = { n: SPK }, sparkRng = rng(424242), sbox = stackFloors.length ? { x0: Math.min(...stackFloors.map((v) => v.min.x)), x1: Math.max(...stackFloors.map((v) => v.max.x)), z0: Math.min(...stackFloors.map((v) => v.min.z)), z1: Math.max(...stackFloors.map((v) => v.max.z)), y0: stackFloors[0].min.y, y1: stackFloors[stackFloors.length - 1].max.y } : { x0: -5, x1: 5, z0: -5, z1: 5, y0: 0, y1: 10 };
  spk.p = Array.from({ length: SPK }, () => ({ x: sbox.x0 + sparkRng() * (sbox.x1 - sbox.x0), z: sbox.z0 + sparkRng() * (sbox.z1 - sbox.z0), off: sparkRng(), speed: 0.025 + sparkRng() * 0.03, accent: sparkRng() < 0.5, dx: (sparkRng() - 0.5) * 0.4 }));
  spk.geo = own(new THREE.BufferGeometry()); spk.pos = new Float32Array(SPK * 3); spk.col = new Float32Array(SPK * 3);
  spk.geo.setAttribute('position', new THREE.BufferAttribute(spk.pos, 3).setUsage(THREE.DynamicDrawUsage)); spk.geo.setAttribute('color', new THREE.BufferAttribute(spk.col, 3).setUsage(THREE.DynamicDrawUsage));
  spk.mat = own(new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, transparent: false, depthWrite: false, fog: false })); spk.obj = new THREE.Points(spk.geo, spk.mat); spk.obj.frustumCulled = false; spk.obj.renderOrder = 6; spk.obj.visible = !reduced; world.add(spk.obj);
  const _sc1 = new THREE.Color(), _sc2 = new THREE.Color();
  function updateSparkles(t) {
    const n = lowQ ? SPK / 2 : SPK, H = sbox.y1 - sbox.y0; spk.geo.setDrawRange(0, n);
    for (let i = 0; i < n; i++) { const p = spk.p[i], f = ((t * p.speed + p.off) % 1 + 1) % 1, fade = Math.sin(Math.PI * f);
      spk.pos[i * 3] = p.x + Math.sin(t * 0.3 + p.off * 9) * 0.6 + p.dx * f * 4; spk.pos[i * 3 + 1] = sbox.y0 + f * H; spk.pos[i * 3 + 2] = p.z;
      _sc1.copy(p.accent ? P.accent : _white); _sc2.copy(P.bg).lerp(_sc1, fade); spk.col[i * 3] = _sc2.r; spk.col[i * 3 + 1] = _sc2.g; spk.col[i * 3 + 2] = _sc2.b; }
    spk.geo.attributes.position.needsUpdate = true; spk.geo.attributes.color.needsUpdate = true;
  }
  const SWEEP_MS = 900, sweepGeo = own(new THREE.BufferGeometry()), sweepPos = new Float32Array(Math.max(1, stackFloors.length) * 10 * 2 * 3);
  sweepGeo.setAttribute('position', new THREE.BufferAttribute(sweepPos, 3).setUsage(THREE.DynamicDrawUsage)); sweepGeo.setDrawRange(0, 0);
  const sweepMat = own(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, fog: false })), sweepObj = new THREE.LineSegments(sweepGeo, sweepMat); sweepObj.frustumCulled = false; sweepObj.renderOrder = 6; sweepObj.visible = !reduced; world.add(sweepObj);
  const perim = (v, u, out) => { const x0 = v.box3.min.x, x1 = v.box3.max.x, z0 = v.box3.min.z, z1 = v.box3.max.z, W = x1 - x0, D = z1 - z0, per = 2 * (W + D), d = ((u % 1) + 1) % 1 * per, y = v.box3.min.y + SLAB_T + 0.03;
    if (d < W) return out.set(x0 + d, y, z1); if (d < W + D) return out.set(x1, y, z1 - (d - W)); if (d < 2 * W + D) return out.set(x1 - (d - W - D), y, z0); return out.set(x0, y, z0 + (d - 2 * W - D)); };
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  function updateSweep(t) {
    let n = 0; stackFloors.forEach((v, i) => { const u = (t * 1000 - 400 - i * SWEEP_MS) / SWEEP_MS; if (u <= 0 || u >= 1) return;
      for (let k = 0; k < 10; k++) { perim(v, u - k * 0.012, _pa); perim(v, u - (k + 1) * 0.012, _pb); sweepPos.set([_pa.x, _pa.y, _pa.z, _pb.x, _pb.y, _pb.z], n * 6); n++; } });
    sweepGeo.setDrawRange(0, n * 2); sweepGeo.attributes.position.needsUpdate = true;
  }
  /* ---------- lightning arcs (one shared LineSegments, vertex colours, additive) */
  const arcGeo = own(new THREE.BufferGeometry()), arcPos = new Float32Array(ARC_MAX * ARC_SEG * 6), arcCol = new Float32Array(ARC_MAX * ARC_SEG * 6);
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3).setUsage(THREE.DynamicDrawUsage)); arcGeo.setAttribute('color', new THREE.BufferAttribute(arcCol, 3).setUsage(THREE.DynamicDrawUsage)); arcGeo.setDrawRange(0, 0);
  const arcMat = own(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })), arcMesh = new THREE.LineSegments(arcGeo, arcMat); arcMesh.frustumCulled = false; arcMesh.renderOrder = 7; world.add(arcMesh);
  const arcs = [], arand = rng(1234567);
  function updateArcs(t, enteredMode) {
    // retire
    for (let i = arcs.length - 1; i >= 0; i--) if (t - arcs[i].t0 > arcs[i].life) { arcs[i].src.arcN = Math.max(0, (arcs[i].src.arcN || 0) - 1); arcs.splice(i, 1); }
    if (!lowQ) {
      const idleCap = enteredMode ? 4 : 2; let idleN = arcs.filter((a) => !a.strong).length;
      for (const n of nodes) {
        if (n.vis < 0.3 || !n.outs.length || arcs.length >= ARC_MAX - 1) continue;
        const strong = n.act > 0.5;
        if (strong) { n.outs.forEach((w) => { if (w.vis > 0.3 && !arcs.some((a) => a.w === w)) arcs.push({ w, src: n, t0: t, life: 0.12 + arand() * 0.14, frac: 0.2 + arand() * 0.15, seed: Math.floor(arand() * 1e6), strong: true }); }); n.fire = t; }
        else if (t >= n.nextAt && idleN < idleCap) { const w = n.outs[Math.floor(arand() * n.outs.length)]; if (w.vis > 0.3) { arcs.push({ w, src: n, t0: t, life: 0.12 + arand() * 0.14, frac: 0.2 + arand() * 0.15, seed: Math.floor(arand() * 1e6), strong: false }); idleN++; n.fire = t; } n.nextAt = t + (enteredMode ? 0.3 + arand() * 0.8 : 0.4 + arand() * 1.8); }
      }
    }
    let v = 0; const col = new THREE.Color(), bucket = Math.floor(t * 14);
    arcs.forEach((a) => {
      const age = clamp((t - a.t0) / a.life, 0, 1), u1 = a.frac * (0.25 + 0.75 * age), u0 = Math.max(0, u1 - a.frac * 0.6); if (u1 - u0 < 0.01) return;
      const A = ptAt(a.w, u0, new THREE.Vector3()), B = ptAt(a.w, u1, new THREE.Vector3()), pts = arcPoints(A, B, a.seed + bucket, { segments: 7, jitter: 0.1 }), k = (1 - age) * (a.strong ? 1 : 0.75) * clamp(a.w.vis, 0, 1);
      col.copy(P.accent).multiplyScalar(k * (P.dark ? 1 : 0.9));
      for (let i = 0; i + 1 < pts.length && v + 2 <= arcPos.length / 3; i++) { for (const p of [pts[i], pts[i + 1]]) { arcPos[v * 3] = p.x; arcPos[v * 3 + 1] = p.y; arcPos[v * 3 + 2] = p.z; arcCol[v * 3] = col.r; arcCol[v * 3 + 1] = col.g; arcCol[v * 3 + 2] = col.b; v++; } }
    });
    arcGeo.setDrawRange(0, v); arcGeo.attributes.position.needsUpdate = true; arcGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- camera fit */
  const tcam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500), _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const dirFor = (v) => { const a = v.az * DEG, e = v.el * DEG; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize(); };
  let viewIdx = 0, defaultDir = dirFor(VIEWS[0]);
  function fitPoints(points, dir, pad = PAD_FIT) {
    const asp = camera.aspect, lim = 1 - pad, tgt = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()); let d = 20;
    tcam.aspect = asp; tcam.fov = FOV; tcam.updateProjectionMatrix();
    for (let it = 0; it < 14; it++) {
      tcam.position.copy(tgt).addScaledVector(dir, d); tcam.up.set(0, 1, 0); tcam.lookAt(tgt); tcam.updateMatrixWorld(); tcam.matrixWorldInverse.copy(tcam.matrixWorld).invert();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) { _v.copy(p).project(tcam); x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); }
      const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      _r.setFromMatrixColumn(tcam.matrixWorld, 0); _u.setFromMatrixColumn(tcam.matrixWorld, 1);
      const hh = Math.tan((FOV * Math.PI) / 360) * d;
      tgt.addScaledVector(_r, cx * hh * asp).addScaledVector(_u, cy * hh);
      d = clamp(d * (ext / lim), 1, 500);
    }
    return { pos: tgt.clone().addScaledVector(dir, d), target: tgt, dist: d };
  }
  const allCorners = volumes.flatMap((v) => v.corners);
  let home = null, userMoved = false, tween = null;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced; controls.dampingFactor = 0.09; controls.zoomToCursor = true; controls.enableZoom = true; controls.zoomSpeed = 1.1; controls.screenSpacePanning = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }; /* left-drag ROTATES (user), right-drag pans */ controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI * 0.95; controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; controls.minDistance = 1.2;
  /* bird's eye: floors are temporarily exploded along z so every floor is visible from above */
  const stackUp = volumes.filter((v) => v.kind === 'layer' && !v.outside).sort((p, q) => p.min.y - q.min.y), exOff = explodeOffsets(stackUp.map((v) => v.id), stackUp.length ? stackUp[0].max.z - stackUp[0].min.z : 0);
  const offFor = (v) => exOff.get(v.id) ?? (v.parent ? exOff.get(v.parent) : 0) ?? 0;
  volumes.forEach((v) => { v.corners0 = v.corners.map((c) => c.clone()); v.box0 = v.box3.clone(); v.anchor0 = v.anchor.clone(); });
  let exK = 0, exTarget = 0;
  // vertical zone columns lie down in bird's eye: their height axis becomes depth (row 0 at the back); stack floors are pushed apart along z
  const cyOf = (v) => (v.box0.min.y + v.box0.max.y) / 2, rotZone = (v, c0, k) => { const f = -k * Math.PI / 2, dy = c0.y - cyOf(v), dz = c0.z - v.z0; return new THREE.Vector3(c0.x, cyOf(v) + dy * Math.cos(f) - dz * Math.sin(f), v.z0 + dy * Math.sin(f) + dz * Math.cos(f)); };
  const cornersTarget = () => volumes.flatMap((v) => v.corners0.map((c) => (!exTarget ? c : v.vertical ? rotZone(v, c, 1) : c.clone().add(new THREE.Vector3(0, 0, offFor(v))))));
  function rebuildWires() {
    wires.forEach((w) => { if (w.inner) return; const c = routeCurve(w.a, w.b), pts = c.getSpacedPoints(64), flat = pts.flatMap((p) => [p.x, p.y, p.z]); w.pts = pts; w.len = c.getLength(); w.geo.setPositions(flat); w.geo.setColors(gradColors(pts.length, w.a, w.b)); w.geoP.setPositions(flat); w.geoP.setColors(gradColors(pts.length, w.a, w.b, 0.55)); if (w.dashed) { w.line.computeLineDistances(); w.hl.computeLineDistances(); } w.pulse.computeLineDistances(); const end = pts[pts.length - 1], dir = end.clone().sub(pts[pts.length - 3]).normalize(); w.arrow.position.copy(end).addScaledVector(dir, -0.06); w.arrow.quaternion.setFromUnitVectors(Y_AXIS, dir); });
  }
  function applyExplode() {
    const k = exK;
    volumes.forEach((v) => { if (v.vertical) { const f = -k * Math.PI / 2; v.line.rotation.x = f; if (v.sm) v.sm.rotation.x = f; if (v.pl) v.pl.visible = k < 0.02; v.corners.forEach((c, i) => c.copy(rotZone(v, v.corners0[i], k))); v.anchor.copy(rotZone(v, v.anchor0, k)); v.box3.setFromPoints(v.corners); return; } const off = offFor(v) * k; v.line.position.z = v.z0 + off; if (v.sm) v.sm.position.z = v.z0 + off; if (v.pl) v.pl.position.z = off; v.box3.min.z = v.box0.min.z + off; v.box3.max.z = v.box0.max.z + off; v.corners.forEach((c, i) => { c.z = v.corners0[i].z + off; }); v.anchor.z = v.anchor0.z + off; });
    boxes.forEach((b) => { const zv = volById.get('layer:' + b.layer); if (zv && zv.vertical) { const cy = cyOf(zv), ty = cy - (zv.box0.max.z - zv.z0) + SLAB_T + BOX.h / 2; b.pos.z = b.base.z - (b.base.y - cy) * k; b.pos.y = b.base.y + (ty - b.base.y) * k; b.g.position.z = b.pos.z; } else { b.pos.z = b.base.z + (exOff.get('layer:' + b.layer) || 0) * k; b.g.position.z = b.pos.z; } const pl = b.plate; if (pl && b.icon) { b.icon.position.lerpVectors(pl.front.pos, pl.top.pos, k); b.icon.rotation.x = pl.front.rotX + (pl.top.rotX - pl.front.rotX) * k; } });
    rebuildWires(); dirty = true;
  }
  const MIN_CUBE_PX = 64;
  // keep a clear margin right of the stack so a right-hand zone is never shown as a cropped half box
  const rightMargin = () => { const st = volumes.filter((v) => v.kind === 'layer' && !v.outside); if (!st.length) return []; const x = Math.max(...st.map((v) => v.max.x)) + BOX.w * 1.4 * 0.9; return st.flatMap((v) => [new THREE.Vector3(x, v.min.y, v.min.z), new THREE.Vector3(x, v.min.y, v.max.z), new THREE.Vector3(x, v.max.y, v.max.z)]); };
  function computeHome() {
    const bird = VIEWS[viewIdx].id === 'bird', pad = bird ? 0.05 : PAD_FIT, all = cornersTarget(), fAll = fitPoints(all, defaultDir, pad), kpx = 2 * Math.tan((FOV * Math.PI) / 360) / Math.max(1, chg);
    // default fit: every zone if the cubes stay >= 64px, otherwise the request path (end users > edge > stack) so cubes stay readable; the rest is reachable by chips and panning
    const fitPts = !bird && BOX.w / (kpx * fAll.dist) < MIN_CUBE_PX ? volumes.filter((v) => !(v.outside && v.side === 'right')).flatMap((v) => v.corners0).concat(rightMargin()) : all;
    home = fitPoints(fitPts, defaultDir, pad); home.allDist = fAll.dist; controls.maxDistance = fAll.dist * 1.8; scene.fog.near = home.dist * 4; scene.fog.far = home.dist * 8; }
  function resize() {
    const w = Math.max(60, container.clientWidth), hgt = Math.max(60, container.clientHeight);
    cw = w; chg = hgt; if (composer) composer.setSize(w, hgt); renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix(); res.set(w, hgt); wires.forEach((q) => { q.mat.resolution.set(w, hgt); q.pMat.resolution.set(w, hgt); q.hlMat.resolution.set(w, hgt); });
    const had = !!home; computeHome();
    if (!had || (!userMoved && !tween && !entered)) { camera.position.copy(home.pos); controls.target.copy(home.target); controls.update(); }
    dirty = true;
  }
  function tweenTo(pos, target, ms = 650) {
    if (reduced || ms <= 0) { camera.position.copy(pos); controls.target.copy(target); controls.update(); dirty = true; return; }
    tween = { t0: performance.now(), ms, fp: camera.position.clone(), ft: controls.target.clone(), tp: pos.clone(), tt: target.clone() };
  }
  const dirNow = () => camera.position.clone().sub(controls.target).normalize();
  const around = (b, r) => { const pts = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(b.pos.clone().add(new THREE.Vector3(r.x * sx, r.y * sy + (b.sub ? 0 : b.lift), r.z * sz))); return pts; };
  function focus(id) {
    const bx = nodeById.get(id), vol = volById.get(id); userMoved = true; lastActivity = performance.now();
    if (bx) { const f = fitPoints(around(bx, bx.sub ? new THREE.Vector3(1.4, 0.9, 1.4) : new THREE.Vector3(2.0, 1.1, 2.0)), dirNow(), 0.05); tweenTo(f.pos, f.target); }
    else if (vol) { const f = fitPoints(vol.corners, dirNow(), PAD_FIT); tweenTo(f.pos, f.target); }
  }
  function reset() { if (entered) { exit(); return; } userMoved = false; swayAcc = 0; if (home) tweenTo(home.pos, home.target); }
  function zoomBy(f) {
    userMoved = true; lastActivity = performance.now(); const off = camera.position.clone().sub(controls.target), d = clamp(off.length() * f, controls.minDistance, controls.maxDistance);
    tweenTo(controls.target.clone().addScaledVector(off.normalize(), d), controls.target.clone(), 260);
  }
  const zoomIn = () => zoomBy(0.72), zoomOut = () => zoomBy(1 / 0.72);
  let lastActivity = performance.now(), swayAcc = 0, swayDir = 1;
  controls.addEventListener('start', () => { tween = null; userMoved = true; lastActivity = performance.now(); hideHint(); });
  controls.addEventListener('change', () => { dirty = true; });

  /* ---------- UI */
  root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-label', spec.title || 'Diagram');
  if (spec.title) root.appendChild(h('div', 'flow3d__title', spec.title));
  const tabsData = (spec.tabs || []).slice(0, 3).map((t) => ({ id: t.id, label: t.label || t.id, focus: new Set((t.focus || []).filter((i) => ids.has(i)).concat(t.layers ? boxesSpec.filter((b) => t.layers.includes(b.layer ?? 0)).map((b) => b.id) : [])) })).filter((t) => t.focus.size);
  const bar = h('div', 'flow3d__tabs'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Views'); const tabBtns = new Map();
  let tabId = null, walking = false, stepIdx = 0, walkTimer = 0, clickTimer = 0, entered = null, enterK = 0;
  tabsData.forEach((t) => { const b = h('button', 'flow3d__tab', t.label); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => { exit(); stopWalk(); setTab(tabId === t.id ? null : t.id); }); bar.appendChild(b); tabBtns.set(t.id, b); });
  const steps = (spec.steps || []).filter((s) => s && (s.boxes || s.wires));
  const bWalk = h('button', 'flow3d__tab flow3d__walk', 'Walk through'); bWalk.type = 'button'; bWalk.setAttribute('aria-pressed', 'false'); if (steps.length) bar.appendChild(bWalk);
  if (bar.children.length) root.appendChild(bar);
  const ctl = h('div', 'flow3d__ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Zoom');
  const mk = (t, a, f) => { const b = h('button', 'flow3d__cbtn', t); b.type = 'button'; b.setAttribute('aria-label', a); b.title = a; b.addEventListener('click', f); ctl.appendChild(b); return b; };
  mk('+', 'Zoom in', zoomIn); mk('−', 'Zoom out', zoomOut); mk('Reset', 'Reset view', () => { stopWalk(); setTab(null); reset(); }).classList.add('flow3d__cbtn--wide');
  const setView = (i) => { viewIdx = i; defaultDir = dirFor(VIEWS[i]); vbtn.textContent = VIEWS[i].label; bBird.setAttribute('aria-pressed', String(i === BIRD)); exTarget = i === BIRD ? 1 : 0; computeHome(); userMoved = false; tweenTo(home.pos, home.target, 600); dirty = true; };
  const vbtn = mk('Front', 'Cycle view: Front, Isometric, Bird\'s eye', () => { setView((viewIdx + 1) % VIEWS.length); computeHome(); userMoved = false; tweenTo(home.pos, home.target); }); vbtn.classList.add('flow3d__cbtn--wide');
  const bBird = mk('\u25A6', "Bird's eye view", () => setView(viewIdx === BIRD ? 0 : BIRD)); bBird.setAttribute('aria-pressed', 'false'); bBird.classList.add('flow3d__bird'); ctl.insertBefore(bBird, vbtn);
  const bExpand = mk('Expand', 'Expand to full screen', () => (full ? collapse() : expand())); bExpand.className = 'flow3d__full'; bExpand.textContent = 'Open full screen \u2197'; root.appendChild(bExpand);
  root.appendChild(ctl);
  const crumb = h('div', 'flow3d__crumb'); crumb.hidden = true; const crumbTxt = h('span', 'flow3d__crumbtxt'), bBack = h('button', 'flow3d__tab flow3d__back', 'Back'); bBack.type = 'button'; bBack.addEventListener('click', () => exit()); crumb.append(crumbTxt, bBack); root.appendChild(crumb);
  const cap = h('div', 'flow3d__cap'); cap.hidden = true; cap.setAttribute('aria-live', 'polite'); root.appendChild(cap);
  const hint = h('div', 'flow3d__hint', 'Drag to orbit, scroll to zoom, double-click a box'); hint.hidden = true; root.appendChild(hint);
  let hintTimer = 0; function hideHint() { if (hint.hidden) return; hint.classList.add('is-off'); setTimeout(() => { hint.hidden = true; }, 600); clearTimeout(hintTimer); store.set(); }
  if (!store.get() && !reduced) { hint.hidden = false; hintTimer = setTimeout(hideHint, 4600); }
  const sr = h('ul', 'flow3d__sr'); boxes.forEach((b) => { const li = h('li'), btn = h('button', '', b.label); btn.type = 'button'; btn.addEventListener('click', () => openBox(b)); li.appendChild(btn); sr.appendChild(li); }); root.appendChild(sr);
  const openBox = (b) => container.dispatchEvent(new CustomEvent('flow3d:open', { bubbles: true, detail: { href: b.href, id: b.id } }));
  function boxClick(b) {
    clearTimeout(clickTimer);
    if (b.sub) { focus(b.id); return; }
    if (entered) { if (b === entered) return; return; }
    const own2 = b.href && (() => { try { return b.href === location.hash; } catch { return false; } })();
    clickTimer = setTimeout(() => (own2 ? enter(b.id) : openBox(b)), 240);
  }

  /* spotlight */
  function applySpot(boxSet, wireSet, active) {
    if (lf !== null) { lf = null; container.dispatchEvent(new CustomEvent('flow3d:layer', { detail: { key: null } })); }
    boxes.forEach((b) => { b.tvis = !boxSet || boxSet.has(b.id) ? 1 : DIM; b.tact = active && boxSet && boxSet.has(b.id) ? 1 : 0; });
    wires.forEach((w) => { if (w.inner) return; w.tvis = !boxSet || (wireSet ? wireSet.has(w.a.id + '>' + w.b.id) : boxSet.has(w.a.id) && boxSet.has(w.b.id)) ? 1 : DIM; w.tact = active && boxSet && (!wireSet || wireSet.has(w.a.id + '>' + w.b.id)) && boxSet.has(w.a.id) && boxSet.has(w.b.id) ? 1 : 0; });
    volumes.forEach((v) => { v.tvis = !boxSet || v.boxes.some((i) => boxSet.has(i)) ? 1 : 0.35; });
    dirty = true;
  }
  const spotPts = (set) => { const pts = []; set.forEach((i) => pts.push(...around(boxById.get(i), new THREE.Vector3(1.6, 1, 1.6)))); return pts; };
  /* ---------- layer focus (chip bar): top-down fit of one layer, others dimmed to 12%, neighbour wires 35% */
  const layerList = volumes.filter((v) => v.kind === 'layer').map((v) => ({ key: Number(String(v.id).split(':')[1]), label: String(v.label || '').replace(/\s*\(outside the stack\)/i, ''), outside: !!v.outside, y: v.min.y, cx: (v.box3.min.x + v.box3.max.x) / 2 }))
    .sort((a, b) => (Math.abs(a.cx - b.cx) > 0.01 ? a.cx - b.cx : b.y - a.y)); // zones left to right, floors top to bottom
  const stackKeys = layerList.filter((l) => !l.outside), edgeKey = stackKeys.length ? stackKeys[0].key : null, k8sKey = (stackKeys.find((l) => /kubernetes/i.test(l.label)) || {}).key;
  const anySpine = boxesSpec.some((b) => b.spine);
  const isSpine = (b) => (anySpine ? !!b.spec.spine : b.layer === edgeKey || (b.layer === k8sKey && /kubernetes|istio|kafka/i.test(b.spec.tech || b.label)));
  function setLayerFocus(key) {
    if (key === null || key === undefined || !volById.has('layer:' + key)) { if (lf === null) return; stopWalk(); applySpot(null, null, false); userMoved = false; if (home) tweenTo(home.pos, home.target, 700); container.dispatchEvent(new CustomEvent('flow3d:layer', { detail: { key: null } })); return; }
    exit(); stopWalk(); tabId = null; tabBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    boxes.forEach((b) => { b.tvis = b.layer === key ? 1 : FOCUS_DIM; b.tact = 0; });
    wires.forEach((w) => { if (w.inner) return; const ia = w.a.layer === key, ib = w.b.layer === key; w.tvis = ia && ib ? 1 : ia || ib ? FOCUS_NEIGHBOUR : FOCUS_DIM; w.tact = 0; });
    volumes.forEach((v) => { v.tvis = v.id === 'layer:' + key || v.parent === 'layer:' + key ? 1 : FOCUS_DIM; });
    lf = key; userMoved = true; lastActivity = performance.now(); dirty = true;
    const vol = volById.get('layer:' + key), dir = defaultDir.clone(), f = fitPoints(vol.corners, dir, 0.1), k = 2 * Math.tan((FOV * Math.PI) / 360) / Math.max(1, chg);
    const d = Math.min(f.dist, (BOX.w / k) / MIN_TILE_PX); // never smaller than MIN_TILE_PX per tile
    tweenTo(f.target.clone().addScaledVector(dir, d), f.target, 700);
    container.dispatchEvent(new CustomEvent('flow3d:layer', { detail: { key } }));
  }
  /* ---------- left detail pane: technology + the stack as a pyramid */
  const pane = h('div', 'flow3d__pane'); pane.setAttribute('role', 'complementary'); pane.setAttribute('aria-label', 'Component details'); root.appendChild(pane);
  let paneFor = null, paneTimer = 0, paneOver = false, pyrOnly = false;
  pane.addEventListener('pointerenter', () => { paneOver = true; clearTimeout(paneTimer); }); pane.addEventListener('pointerleave', () => { paneOver = false; hidePane(260); });
  const words = (t, n) => { const w = String(t || '').split(/\s+/).filter(Boolean); return w.length > n ? w.slice(0, n).join(' ') + '...' : w.join(' '); };
  function renderPane(b) {
    pane.replaceChildren();
    const lv = b ? layerList.find((l) => l.key === b.layer) : null;
    if (b) {
      const hd = h('div', 'flow3d__ph'), cv = document.createElement('canvas'); cv.width = cv.height = 80; cv.className = 'flow3d__plogo'; cv.setAttribute('aria-hidden', 'true');
      try { const src = b.iconSt && b.iconSt.canvas; if (src) cv.getContext('2d').drawImage(src, 0, 0, 80, 80); } catch { /* ignore */ }
      hd.append(cv, h('div', 'flow3d__pname', replicaLabel(b.spec.tech || b.label, b.spec.replicas))); pane.append(hd);
      if (b.spec.says) pane.append(h('p', 'flow3d__psays', b.spec.says));
      if (b.spec.detail) pane.append(h('p', 'flow3d__pdet', words(b.spec.detail, 25)));
      pane.append(h('div', 'flow3d__pmeta', 'Layer: ' + (lv ? lv.label : '')));
      const nb = []; wiresSpec.forEach((w) => { if (w.from === b.id || w.to === b.id) { const o = boxById.get(w.from === b.id ? w.to : w.from); if (o) nb.push({ o, out: w.from === b.id, verb: w.label || '' }); } });
      if (nb.length) { pane.append(h('div', 'flow3d__ph2', 'Connects to')); const ul = h('ul', 'flow3d__pcon'); nb.slice(0, 6).forEach((n) => { const li = h('li'); li.append(h('span', 'flow3d__parrow', n.out ? '\u2192' : '\u2190'), document.createTextNode(' ' + n.o.label), ...(n.verb ? [h('span', 'flow3d__pverb', ' ' + n.verb)] : [])); ul.append(li); }); pane.append(ul); }
    }
    pane.append(h('div', 'flow3d__ph2', 'The stack'));
    const st = layerList.filter((l) => !l.outside), pyr = h('div', 'flow3d__pyr');
    st.forEach((l, i) => {
      const bar = h('button', 'flow3d__pbar' + (b && b.layer === l.key ? ' is-on' : ''), ''); bar.type = 'button'; bar.style.width = (46 + (54 * i) / Math.max(1, st.length - 1)) + '%';
      if (b && b.layer === l.key) bar.style.setProperty('--bar', '#' + layerCol(l.key).getHexString());
      bar.append(h('span', 'flow3d__pbl', l.label)); const dots = h('span', 'flow3d__pdots'); boxes.filter((x) => x.layer === l.key).forEach((x) => dots.append(h('i', 'flow3d__pdot' + (b && x === b ? ' is-on' : '')))); bar.append(dots);
      bar.addEventListener('click', () => setLayerFocus(l.key)); pyr.append(bar);
    });
    pane.append(pyr);
  }
  function showPane(b) { clearTimeout(paneTimer); pane.classList.toggle('flow3d__pane--r', !!b && b.pos.x < -1); if (paneFor !== b) { paneFor = b; renderPane(b); } pane.classList.add('is-open'); }
  function hidePane(delay) { clearTimeout(paneTimer); paneTimer = setTimeout(() => { if (paneOver || hover || pyrOnly) return; pane.classList.remove('is-open'); paneFor = null; }, delay === undefined ? 220 : delay); }
  function setTab(id) {
    const t = tabsData.find((x) => x.id === id); tabId = t ? t.id : null; tabBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === tabId)));
    applySpot(t ? t.focus : null, null, false);
    if (t) { const f = fitPoints(spotPts(t.focus), defaultDir, 0.1); userMoved = true; tweenTo(f.pos, f.target); } else if (!walking && !entered) reset();
  }
  /* walk through: the camera never dollies into a tile; steps are shown by highlighting (others dim to 25%, charge flow speeds up, glow ring).
     It starts from bird's eye and restores the previous view when stopped. 'Follow' (off) eases the camera toward the step, at most 1.6x the overview zoom. */
  let paused = false, follow = false, walkPrev = 0;
  const wbar = h('div', 'flow3d__wbar'); wbar.hidden = true; wbar.setAttribute('aria-live', 'polite');
  const wcap = h('span', 'flow3d__wcap'), wb = (t, a, f) => { const bt = h('button', 'flow3d__tab', t); bt.type = 'button'; bt.setAttribute('aria-label', a); bt.addEventListener('click', f); return bt; };
  const stepBoxes = (s) => { const bs = new Set((s.boxes || []).filter((x) => ids.has(x))); (s.wires || []).forEach(([f, t]) => { if (ids.has(f)) bs.add(f); if (ids.has(t)) bs.add(t); }); return bs; };
  function followStep() {
    if (!walking || !follow) return; const bs = stepBoxes(steps[stepIdx]); if (!bs.size) return;
    const f = fitPoints(spotPts(bs), defaultDir, 0.1), d = Math.max(f.dist, home.dist / 1.6); userMoved = true; tweenTo(f.target.clone().addScaledVector(defaultDir, d), f.target, 700);
  }
  function showStep(i) {
    stepIdx = i; const s = steps[i], bs = stepBoxes(s), ws = new Set((s.wires || []).map(([f, t]) => f + '>' + t));
    applySpot(bs.size ? bs : null, ws.size ? ws : null, true);
    wcap.textContent = `${i + 1}/${steps.length}  ${s.title ? s.title + ': ' : ''}${String(s.text || '').replace(/\s+/g, ' ')}`; followStep();
  }
  const stepMs = () => opts.stepMs || 4500;
  function restartTimer() { clearTimeout(walkTimer); if (!reduced && walking) walkTimer = setTimeout(() => { if (!walking) return; if (paused) { restartTimer(); return; } if (stepIdx + 1 >= steps.length) { stopWalk(); return; } showStep(stepIdx + 1); restartTimer(); }, stepMs()); }
  const wPrev = wb('Prev', 'Previous step', () => { if (stepIdx > 0) { showStep(stepIdx - 1); restartTimer(); } });
  const wPause = wb('Pause', 'Pause or resume', () => { paused = !paused; wPause.textContent = paused ? 'Play' : 'Pause'; wPause.setAttribute('aria-pressed', String(paused)); });
  const wNext = wb('Next', 'Next step', () => { if (stepIdx + 1 < steps.length) { showStep(stepIdx + 1); restartTimer(); } else stopWalk(); });
  const wFollow = wb('Follow', 'Follow the active step with the camera', () => { follow = !follow; wFollow.setAttribute('aria-pressed', String(follow)); if (follow) followStep(); else if (walking) tweenTo(home.pos, home.target, 600); });
  const wStop = wb('Stop', 'Stop walk through', () => stopWalk()); wFollow.setAttribute('aria-pressed', 'false'); wPause.setAttribute('aria-pressed', 'false');
  wbar.append(wcap, wPrev, wPause, wNext, wFollow, wStop); root.appendChild(wbar);
  function startWalk() {
    if (!steps.length) return; exit(); stopWalk(); walkPrev = viewIdx; if (viewIdx !== BIRD) setView(BIRD);
    walking = true; paused = false; wPause.textContent = 'Pause'; bWalk.setAttribute('aria-pressed', 'true'); bWalk.textContent = 'Stop'; cap.hidden = true;
    tabId = null; tabBtns.forEach((b) => b.setAttribute('aria-pressed', 'false')); wbar.hidden = false; showStep(0); restartTimer();
  }
  function stopWalk() { if (!walking) return; walking = false; clearTimeout(walkTimer); bWalk.setAttribute('aria-pressed', 'false'); bWalk.textContent = 'Walk through'; wbar.hidden = true; cap.hidden = true; applySpot(null, null, false); setView(walkPrev); }
  bWalk.addEventListener('click', () => { if (!walking) startWalk(); else stopWalk(); });

  /* ---------- enter a box (zoom inside) */
  let back = null;
  function enter(id) {
    const b = boxById.get(id); if (!b) return; stopWalk(); clearTimeout(clickTimer); userMoved = true; lastActivity = performance.now();
    if (!entered) back = { pos: camera.position.clone(), target: controls.target.clone() };
    entered = b; applySpot(null, null, false); tabBtns.forEach((x) => x.setAttribute('aria-pressed', 'false')); tabId = null;
    const lv = volumes.find((v) => v.kind === 'layer' && v.boxes.includes(b.id));
    crumbTxt.textContent = [spec.title || 'Platform', lv && lv.label ? lv.label : null, b.label].filter(Boolean).join('  › '); crumb.hidden = false;
    if (b.subs.length) { b.shell.obj.visible = true; b.subs.forEach((s) => { s.g.visible = true; }); const f = fitPoints(b.shellCorners, dirNow(), 0.1); tweenTo(f.pos, f.target, ENTER_MS); cap.hidden = true; }
    else { const f = fitPoints(around(b, new THREE.Vector3(2.2, 1.2, 2.2)), dirNow(), 0.05); tweenTo(f.pos, f.target, ENTER_MS); const s = b.spec; cap.classList.add('is-info'); cap.hidden = false; cap.textContent = [b.label, s.says, s.detail].filter(Boolean).join(' — '); }
    dirty = true;
  }
  function exit() {
    if (!entered) return; entered = null; crumb.hidden = true; if (!walking) cap.hidden = true;
    if (back) { userMoved = false; tweenTo(back.pos, back.target, ENTER_MS); back = null; }
    dirty = true;
  }

  /* ---------- full viewport overlay */
  let full = false, ph = null, prevOverflow = '', prevFocus = null;
  function expand() {
    if (full) return; full = true; prevFocus = document.activeElement; ph = document.createElement('div'); ph.style.height = container.offsetHeight + 'px'; ph.style.width = '100%'; container.before(ph);
    prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; container.classList.add('is-full'); bExpand.textContent = 'Close full screen \u2715'; bExpand.setAttribute('aria-label', 'Close full screen'); root.focus({ preventScroll: true });
  }
  function collapse() {
    if (!full) return; full = false; container.classList.remove('is-full'); document.body.style.overflow = prevOverflow; if (ph) { ph.remove(); ph = null; } bExpand.textContent = 'Open full screen \u2197'; bExpand.setAttribute('aria-label', 'Expand to full screen');
    try { (prevFocus && prevFocus.focus ? prevFocus : bExpand).focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  function setHeight(v) { container.style.setProperty('--flow-h', typeof v === 'number' ? v + 'px' : String(v)); }

  /* ---------- picking */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  const setNdc = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  const pickBox = (e) => { setNdc(e); const hit = ray.intersectObjects(pickables.filter((m) => m.userData.node.vis > 0.5 && m.userData.node.g.visible), false)[0]; return hit ? hit.object.userData.node : null; };
  function pickVolume(e) { setNdc(e); let best = null, bs = Infinity; const p = new THREE.Vector3(); volumes.forEach((v) => { if (v.vis > 0.5 && ray.ray.intersectBox(v.box3, p)) { const s = v.box3.getSize(new THREE.Vector3()).lengthSq(); if (s < bs) { bs = s; best = v; } } }); return best; }
  function setHover(b) { if (hover !== b) { hover = b; if (b) showPane(b); else if (pyrOnly) { paneFor = null; renderPane(null); } else hidePane(); canvas.style.cursor = b ? 'pointer' : ''; nodes.forEach((q) => q.lbl.classList.toggle('is-hover', q === b)); dirty = true; } }
  canvas.addEventListener('pointermove', (e) => { lastActivity = performance.now(); if (e.buttons) { setHover(null); return; } setHover(pickBox(e)); });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; lastActivity = performance.now(); hideHint(); try { root.focus({ preventScroll: true }); } catch { /* ignore */ } });
  canvas.addEventListener('wheel', () => { lastActivity = performance.now(); hideHint(); }, { passive: true });
  canvas.addEventListener('pointerup', (e) => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; } down = null; const b = pickBox(e); if (b) boxClick(b); });
  canvas.addEventListener('dblclick', (e) => { clearTimeout(clickTimer); const b = pickBox(e); if (b) { if (b.sub) focus(b.id); else enter(b.id); return; } const v = pickVolume(e); if (v) { focus(v.id); return; } if (!full) expand(); });

  /* ---------- keyboard: fly controls */
  const keys = new Set(), inside = () => full || container.contains(document.activeElement);
  const onKeyDown = (e) => {
    if (!inside() || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (entered) exit(); else if (full) collapse(); else if (walking) stopWalk(); else setTab(null); e.preventDefault(); return; }
    if (e.key === 'Backspace' && entered) { exit(); e.preventDefault(); return; }
    if (e.target && e.target.tagName === 'BUTTON' && e.target !== root && (k === ' ' || e.key === 'Enter')) return;
    if (e.key === '+' || e.key === '=') { zoomIn(); e.preventDefault(); } else if (e.key === '-' || e.key === '_') { zoomOut(); e.preventDefault(); } else if (k === 'r') { stopWalk(); setTab(null); reset(); } else if (k === 'p') { pyrOnly = !pyrOnly; if (pyrOnly) { paneFor = null; renderPane(null); pane.classList.add('is-open'); } else hidePane(0); }
    else if ('wasdqe'.includes(k) && k.length === 1 || e.key.startsWith('Arrow')) { keys.add(k); userMoved = true; tween = null; lastActivity = performance.now(); hideHint(); e.preventDefault(); }
  };
  const onKeyUp = (e) => { keys.delete(e.key.toLowerCase()); };
  document.addEventListener('keydown', onKeyDown); document.addEventListener('keyup', onKeyUp); root.addEventListener('blur', () => keys.clear());
  const _off = new THREE.Vector3(), _sph = new THREE.Spherical();
  function applyKeys(dt) {
    if (!keys.size) return; const dist = camera.position.distanceTo(controls.target), sp = dist * 0.7 * dt;
    _r.setFromMatrixColumn(camera.matrixWorld, 0); _r.y = 0; _r.normalize(); _u.setFromMatrixColumn(camera.matrixWorld, 2); _u.y = 0; _u.normalize().negate();
    const mv = new THREE.Vector3();
    if (keys.has('w')) mv.addScaledVector(_u, sp); if (keys.has('s')) mv.addScaledVector(_u, -sp); if (keys.has('d')) mv.addScaledVector(_r, sp); if (keys.has('a')) mv.addScaledVector(_r, -sp);
    if (keys.has('e')) mv.y += sp; if (keys.has('q')) mv.y -= sp;
    camera.position.add(mv); controls.target.add(mv);
    const ox = (keys.has('arrowleft') ? -1 : 0) + (keys.has('arrowright') ? 1 : 0), oy = (keys.has('arrowup') ? -1 : 0) + (keys.has('arrowdown') ? 1 : 0);
    if (ox || oy) { _off.copy(camera.position).sub(controls.target); _sph.setFromVector3(_off); _sph.theta += ox * 0.9 * dt; _sph.phi = clamp(_sph.phi + oy * 0.7 * dt, 0.15, Math.PI * 0.62); _off.setFromSpherical(_sph); camera.position.copy(controls.target).add(_off); }
    camera.lookAt(controls.target); dirty = true;
  }

  /* ---------- theme */
  function setTheme(t) {
    if (t !== 'light' && t !== 'dark') t = detectTheme(); theme = t; container.dataset.theme = t; P = palette(t, cssVar('--primary', ''), cssVar('--bg', ''));
    volumes.forEach((v) => { if (v.kind !== 'layer') { v.mat.color.copy(P.volume); if (v.brMat) v.brMat.color.copy(P.volume); } else { const lk2 = Number(String(v.id).split(':')[1]); v.mat.color.copy(layerCol(lk2)); if (v.brMat) v.brMat.color.copy(layerCol(lk2)); } }); floor.color.copy(P.volume); floor.opacity = P.floorOp; scene.fog.color.copy(P.bg);
    nodes.forEach((b) => { b.glowMat.color.copy(P.accent); if (b.iconSt) b.iconSt.draw(); if (b.shell) b.shell.mat.color.copy(P.volume); });
    wires.forEach((w) => { w.geo.setColors(gradColors(w.pts.length, w.a, w.b)); w.geoP.setColors(gradColors(w.pts.length, w.a, w.b, 0.55)); w.hlMat.color.copy(P.accent); w.arMat.color.copy(P.accent); });
    paintBubbles(); setLights(); dirty = true;
  }
  let mo = null, mq = null, mqFn = null;
  if (!fixedTheme) { mo = new MutationObserver(() => setTheme(detectTheme())); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); try { mq = matchMedia('(prefers-color-scheme: light)'); mqFn = () => setTheme(detectTheme()); mq.addEventListener('change', mqFn); } catch { mq = null; } }

  /* ---------- overlay labels */
  const _s = new THREE.Vector3(), _o = { x: 0, y: 0, ok: true }, LH = 16;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + LH && b.y < a.y + LH;
  const measure = (el, rec) => { if (!rec.lw) rec.lw = el.offsetWidth || 0; return rec.lw || 60; };
  function placeLabels() {
    camera.updateMatrixWorld(); // labels always use the CURRENT camera (also mid-fly), never last frame's matrices
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    const proj = (v) => { _s.copy(v).project(camera); _o.ok = _s.z < 1 && _s.z > -1; _o.x = ((_s.x + 1) / 2) * w; _o.y = ((1 - _s.y) / 2) * hgt; };
    const placed = [];
    const put = (el, r, dir, op) => { let tries = 0; while (tries++ < 3 && placed.some((p) => overlap(r, p))) r.y += dir * (LH + 2); placed.push(r); el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`; el.style.opacity = String(op); el.style.visibility = ''; el.style.pointerEvents = op < 0.3 ? 'none' : ''; };
    for (const kind of ['layer', 'group']) volumes.forEach((v) => {
      if (!v.label || v.kind !== kind) return; if (kind === 'group' && !(lf !== null && v.parent === 'layer:' + lf)) { v.el.style.visibility = 'hidden'; return; } proj(v.anchor); if (!_o.ok || v.vis < 0.05) { v.el.style.visibility = 'hidden'; return; }
      const wd = measure(v.el, v), r = kind === 'layer' && !v.outside ? { x: _o.x + 8, y: _o.y + 3, w: wd } : { x: _o.x + (kind === 'layer' ? 0 : 6), y: _o.y - 4 - LH, w: wd };
      put(v.el, r, kind === 'layer' && !v.outside ? 1 : -1, v.vis < 0.9 ? Math.max(0.15, v.vis) : 1);
    });
    const prio = (b) => (b === hover ? 0 : b === entered ? 1 : b.spec && b.spec.replicas >= 2 ? 2 : b.sub ? 4 : 3);
    const order = nodes.filter((b) => b.g.visible).map((b) => { const top = b === entered && b.shell ? b.shell.dims.h / 2 + 0.15 : (b.sub ? SUB.h : BOX.h) / 2 + 0.12; proj(b.pos.clone().add(b.sub ? new THREE.Vector3(0, -SUB.h / 2, SUB.d / 2) : new THREE.Vector3(0, -BOX.h / 2, b.hd + 0.45))); return { b, x: _o.x, y: _o.y, ok: _o.ok }; }).sort((p, q) => prio(p.b) - prio(q.b) || q.y - p.y);
    nodes.forEach((b) => { if (!b.g.visible) b.lbl.style.visibility = 'hidden'; });
    order.forEach(({ b, x, y, ok }) => {
      if (!ok || b.vis < 0.05) { b.lbl.style.visibility = 'hidden'; return; }
      const wd = measure(b.lbl, b), op = b === entered ? 1 : 0.2 + 0.8 * clamp((b.vis - DIM) / (1 - DIM), 0, 1) * (entered && !b.sub ? 0.4 : 1);
      // labels stay glued to their tile: only candidates within 1.5 label heights of the anchor; otherwise hidden until the tile is hovered
      const cands = [[x - wd / 2, y + 1], [x - wd / 2, y + 1 + LH], [x - wd / 2, y - 2 * LH - 6]], free = cands.find(([cx, cy]) => !placed.some((p) => overlap({ x: cx, y: cy, w: wd }, p)));
      const spot = !!tabId || walking, inFocus = lf !== null && b.layer === lf, want = b === hover || b === entered || b.sub || (lf !== null ? inFocus : (spot ? b.tvis >= 1 : true));
      if (!want) { b.lbl.style.visibility = 'hidden'; b.lbl.style.pointerEvents = 'none'; return; }
      if (!free && !inFocus && b !== hover && b !== entered) { b.lbl.style.visibility = 'hidden'; b.lbl.style.pointerEvents = 'none'; return; }
      const c = free || cands[0], r = { x: c[0], y: c[1], w: wd }; placed.push(r);
      b.lbl.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`; b.lbl.style.opacity = String(b.sub ? clamp(b.vis, 0, 1) : op); b.lbl.style.visibility = ''; b.lbl.style.pointerEvents = (b.sub ? clamp(b.vis, 0, 1) : op) < 0.3 ? 'none' : '';
    });
  }

  /* ---------- loop */
  let raf = 0, visible = true, last = performance.now(), slow = 0, frames = 0; const t0 = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame); if (disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (exK !== exTarget) { exK += (exTarget - exK) * Math.min(1, dt * 7); if (Math.abs(exTarget - exK) < 0.003) exK = exTarget; applyExplode(); }
    if (tween) { const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = ease(k); camera.position.lerpVectors(tween.fp, tween.tp, e); controls.target.lerpVectors(tween.ft, tween.tt, e); if (k >= 1) tween = null; dirty = true; }
    applyKeys(dt);
    if (controls.update()) dirty = true;
    if (!visible) return;
    const animate = !reduced, t = (now - t0) / 1000;
    if (animate && !tween && !entered && now - lastActivity > 3000 && !keys.size) { // idle sway
      const a = SWAY_SPEED * dt * swayDir; swayAcc += a; if (Math.abs(swayAcc) > SWAY_MAX) swayDir = -swayDir;
      _off.copy(camera.position).sub(controls.target).applyAxisAngle(Y_AXIS, a); camera.position.copy(controls.target).add(_off); camera.lookAt(controls.target); dirty = true;
    }
    if (!animate && !dirty) return;
    if (animate && ++frames > 40 && !lowQ) { slow = slow * 0.95 + dt * 1000 * 0.05; if (slow > 45) { lowQ = true; renderer.setPixelRatio(1); resize(); } }
    let moving = false; const ease1 = (c, tg) => { const d = tg - c; if (Math.abs(d) < 0.01) return tg; moving = true; return c + d * 0.18; };
    const nv = (v) => clamp((v - DIM) / (1 - DIM), 0, 1);
    enterK = ease1(enterK, entered ? 1 : 0);
    boxes.forEach((b) => { b.vis = ease1(b.vis, entered ? FADE_OTHERS : b.tvis); b.act = ease1(b.act, Math.max(b.tact, hover === b ? 1 : 0)); b.hide = ease1(b.hide, entered === b && b.subs.length ? 1 : 0); });
    subs.forEach((s) => { const on = entered === s.owner; s.vis = ease1(s.vis, on ? 1 : 0); s.act = ease1(s.act, Math.max(s.tact, hover === s ? 1 : 0, on && animate ? 0.0 : 0)); if (s.vis < 0.02 && !on) s.g.visible = false; else s.g.visible = true; });
    wires.forEach((w) => {
      const tg = w.inner ? (entered === w.owner ? 1 : 0) : entered ? FADE_OTHERS : w.tvis; w.vis = ease1(w.vis, tg);
      const vis2 = !w.inner || w.vis > 0.02; w.line.visible = w.hl.visible = w.arrow.visible = vis2; w.pulse.visible = vis2 && w.flow;
      w.act = ease1(w.act, Math.max(w.tact, hover && (hover === w.a || hover === w.b) ? 1 : 0)); const f = w.inner || lf !== null ? w.vis : 0.3 + 0.7 * nv(w.vis);
      w.mat.opacity = f * 0.4; w.hlMat.opacity = w.act * 0.9 * f; w.arMat.opacity = 0.5 * f; w.pMat.opacity = f * (0.8 + 0.2 * w.act); w.pMat.linewidth = 1.0 + 0.5 * w.act; if (animate) w.pMat.dashOffset -= w.speed * (1 + 0.8 * w.act) * dt;
    });
    volumes.forEach((v) => {
      v.vis = ease1(v.vis, entered ? FADE_OTHERS : v.tvis);
      if (v.kind === 'layer') {
        let hot = 0; for (const id of v.boxes) { const nb = nodeById.get(id); if (nb && nb.act > hot) hot = nb.act; }
        v.hot = ease1(v.hot || 0, hot); const lk3 = Number(String(v.id).split(':')[1]);
        v.mat.color.copy(P.dark ? _white : _nGrey).lerp(layerCol(lk3), v.hot); v.mat.opacity = ((v.outside ? 0.5 : 0.28) + 0.7 * v.hot) * v.vis; if (v.postMat) { v.postMat.color.copy(layerCol(lk3)); v.postMat.opacity = (0.12 + 0.25 * v.hot) * v.vis; } if (v.slabMat) { v.slabMat.color.copy(layerCol(lk3)); v.slabMat.opacity = (0.14 + 0.1 * v.hot) * v.vis; }
        if (v.brMat) { v.brMat.color.copy(v.mat.color); v.brMat.opacity = (0.28 + 0.7 * v.hot) * v.vis; }
      } else { v.mat.opacity = P.volumeOp * v.vis; if (v.brMat) v.brMat.opacity = 0.95 * v.vis; }
    });
    boxes.forEach((b) => { if (b.shell) { const tgt = entered === b ? 1 : 0; b.shell.op = ease1(b.shell.op, tgt); b.shell.mat.opacity = P.volumeOp * 2 * b.shell.op; if (b.shell.op < 0.02 && !entered) { b.shell.obj.visible = false; } } });
    animateFlow(animate ? t : 0); if (animate) { updateSparkles(t); updateSweep(t); } if (animate) updateArcs(t, !!entered);
    nodes.forEach((b) => {
      const pulse = animate ? 0.5 + 0.5 * Math.sin(t * 1.6 + b.phase * 6.28) : 0.5, since = animate ? t - b.fire : 99, burst = since >= 0 && since < 0.7 ? 1 - since / 0.7 : 0, v = nv(b.sub ? clamp(b.vis, DIM, 1) : b.vis), a = b.act;
      const gs = b.sub ? 0.6 : 1, hid = 1 - b.hide;
      b.glowMat.opacity = (a * (0.22 + 0.2 * pulse + 0.4 * burst) + (entered && b.sub ? 0.05 * pulse : 0) + 0.06 * burst) * v * hid; b.glow.scale.setScalar(BOX.w * gs * (2.4 + 0.5 * pulse + 0.8 * burst));
      const o = (b.sub || lf !== null ? clamp(b.vis, 0, 1) : 0.3 + 0.7 * v) * hid; b.sideMat.opacity = b.topMat.opacity = o; if (b.hullMat) b.hullMat.opacity = 0; b.edgeMat.opacity = P.edgeOp * o; b.edgeMat.color.copy(P.edge).lerp(P.accent, a); if (b.imat) b.imat.opacity = (lf !== null ? clamp(b.vis, 0, 1) : v) * hid;
      b.ghosts.forEach((gh) => { gh.gs.color.copy(b.sideMat.color); gh.gt.color.copy(b.topMat.color); gh.gs.opacity = gh.gt.opacity = o * gh.opacity; gh.mesh.visible = !(b.hide > 0.98); });
      if (b.sub) { b.sideMat.color.set(P.side); b.topMat.color.set(P.top); } else { paintBox(b, (b.bright || 1) * (1 + 0.35 * a)); }
      if (!b.sub && !entered) { b.g.position.y = b.pos.y + b.lift + a * 0.25 + (animate && hover !== b ? 0.07 * Math.sin((t * 6.2832) / (3.5 + (hash(b.id) % 1500) / 1000) + b.phase * 6.2832) : 0); if (b.shd) b.shd.position.y = -b.hgt / 2 + 0.03 - a * 0.25; }
      b.g.children.forEach((c) => { if (c.isMesh || c.isLineSegments) c.visible = !(b.hide > 0.98); });
    });
    placeLabels();
    if (BLOOM && P.dark && !lowQ && !reduced) {
      if (!composer) { composer = new EffectComposer(renderer); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(cw, chg); composer.addPass(new RenderPass(scene, camera)); bloom = new UnrealBloomPass(new THREE.Vector2(cw, chg), 0.28, 0.55, 0.32); composer.addPass(bloom); composer.addPass(new OutputPass()); }
      scene.background = P.bg; composer.render();
    } else { scene.background = null; renderer.render(scene, camera); }
    dirty = moving || animate;
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  let io = null; try { io = new IntersectionObserver((en) => { visible = en[en.length - 1].isIntersecting; if (visible) dirty = true; }); io.observe(container); } catch { io = null; }
  resize();
  if (!reduced && opts.flyIn !== false) { const off = home.pos.clone().sub(home.target).applyAxisAngle(Y_AXIS, 0.28).multiplyScalar(1.8).add(home.target); camera.position.copy(off); controls.update(); tweenTo(home.pos, home.target, FLY_MS); }
  { let hv = opts.hover; if (hv === undefined) { try { hv = new URLSearchParams(location.search).get('hover'); } catch { hv = null; } } if (hv) setTimeout(() => { const n = nodeById.get(hv); if (n && !disposed) setHover(n); }, 900); } // ?hover=<boxId> for tests
  { let q = null; try { q = new URLSearchParams(location.search); } catch { q = null; } // test hooks: ?view=front|iso|bird, ?walk=<step>
    const vw = opts.view !== undefined ? opts.view : q && q.get('view'), vi = VIEWS.findIndex((v) => v.id === vw), wk = opts.walk !== undefined ? opts.walk : q && q.get('walk');
    if (vi > 0) setTimeout(() => { if (!disposed) setView(vi); }, 300);
    if (wk) setTimeout(() => { if (disposed) return; startWalk(); const n = Number(wk); if (n > 1) showStep(Math.min(steps.length, n) - 1); paused = true; clearTimeout(walkTimer); }, 600);
  }
  if (opts.tab) setTab(opts.tab);
  if (opts.enter) setTimeout(() => { if (!disposed) enter(opts.enter); }, 50);
  raf = requestAnimationFrame(frame);

  return {
    mode: 'webgl', camera, controls, renderer, layout: L, getDistance: () => camera.position.distanceTo(controls.target), get homeDistance() { return home.dist; }, get entered() { return entered ? entered.id : null; },
    zoomIn, zoomOut, reset, focus, setLayerFocus, layerList: () => layerList.map((l) => ({ ...l })), get layerFocus() { return lf; }, enter, exit, setTab, startWalk, stopWalk, setTheme, setHeight, expand, collapse,
    /* client-space centre of a box's top face (for tests and host overlays) */
    project(id) { const b = nodeById.get(id); if (!b) return null; const r = canvas.getBoundingClientRect(), p = b.pos.clone().add(new THREE.Vector3(0, BOX.h / 2, 0)).project(camera); return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }; },
    unmount() {
      if (disposed) return; disposed = true; collapse(); cancelAnimationFrame(raf); clearTimeout(walkTimer); clearTimeout(clickTimer); clearTimeout(hintTimer); clearTimeout(paneTimer); ro.disconnect(); if (io) io.disconnect(); if (mo) mo.disconnect(); if (mq && mqFn) mq.removeEventListener('change', mqFn);
      document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp);
      controls.dispose(); disposables.forEach((d) => { try { d.dispose(); } catch { /* ignore */ } }); bubbles.dispose();
      if (composer) { try { composer.dispose(); } catch { /* ignore */ } } renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ } root.remove(); container.classList.remove('flow3d');
    },
  };
}

export function unmountFlow(handle) { if (handle && handle.unmount) handle.unmount(); }
