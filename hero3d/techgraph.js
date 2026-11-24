// techgraph.js - hero "tech graph": 20 floating 3D icon tiles in a 7x3 grid. Hovering a tile grows organic wires
// through the gutters to the technologies it really works with, with flowing bubbles and verb labels.
//   const h = mountTechGraph(containerEl, { theme, relations, relationsUrl, onSelect(routeSlug), settle });
//   h.hover(slug|null)  h.setTheme('dark'|'light')  h.unmount()  h.ready (Promise)  h.settle(bool)
// Data: ../data/relations.json. Integration notes: techgraph-README.md.
import * as THREE from 'three';

const ICON_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/';
const GRID = [
  ['kong', 'nginx', 'kubernetes', 'docker', 'aws', 'vmware', 'linux'],
  ['redis', 'istio', 'keycloak', 'grafana', 'prometheus', 'ansible', 'jenkins'],
  [null, 'openbao', 'kafka', 'postgresql', 'python', 'elasticsearch', 'nodejs']
];
const COLS = 7, ROWS = 3;
const PAL = {
  dark: { tile: '#2d2f33', edge: '#e8eaed', edgeA: 0.14, accent: '#8ab4f8', text: '#e8eaed', muted: '#9aa0a6', bg: '#202124' },
  light: { tile: '#ffffff', edge: '#dadce0', edgeA: 1, accent: '#1a73e8', text: '#202124', muted: '#5f6368', bg: '#ffffff' }
};
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // doubled-grid dirs (x right, y DOWN): 0 R, 1 D, 2 L, 3 U
const LABEL_FONT = '500 11px Inter, system-ui, sans-serif';
const LABEL_H = 16;
const WIRE_HW = 1.35;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function parseCss(s) {
  if (!s) return null;
  s = s.trim();
  if (s[0] === '#') return s;
  const m = s.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
}
function roundedShape(w, r) {
  const s = new THREE.Shape(), a = -w / 2, b = w / 2;
  s.moveTo(a + r, a); s.lineTo(b - r, a); s.absarc(b - r, a + r, r, -Math.PI / 2, 0, false);
  s.lineTo(b, b - r); s.absarc(b - r, b - r, r, 0, Math.PI / 2, false);
  s.lineTo(a + r, b); s.absarc(a + r, b - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(a, a + r); s.absarc(a + r, a + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function mountTechGraph(container, opts = {}) {
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const root3 = document.documentElement;
  let theme = opts.theme || root3.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (theme !== 'light') theme = 'dark';
  let pal = null;
  let snap = !!opts.settle;
  const idleColor = opts.idleColor !== false;
  let hideLabels = false;
  let disposed = false, visible = true, raf = 0, last = 0;
  let W = 0, H = 0, pitch = 0, tileS = 0;

  container.classList.add('tg');
  if (container.clientHeight < 20) container.style.aspectRatio = '7 / 3';

  // ---------- DOM ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'tg-canvas';
  const labelsEl = document.createElement('div'); labelsEl.className = 'tg-labels'; labelsEl.setAttribute('aria-hidden', 'true');
  const kb = document.createElement('ul'); kb.className = 'tg-kb'; kb.setAttribute('aria-label', 'Technologies');
  container.append(canvas, labelsEl, kb);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, -600, 600);
  camera.position.z = 300;
  const root = new THREE.Group(); scene.add(root);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const measureCtx = document.createElement('canvas').getContext('2d');
  const textW = (t) => { measureCtx.font = LABEL_FONT; return Math.ceil(measureCtx.measureText(t).width) + 12; };

  // ---------- shared geometry ----------
  const bodyShape = roundedShape(1, 0.17);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  const outlinePts = bodyShape.getPoints(10).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const dotGeo = new THREE.CircleGeometry(1.7, 12);

  function blurTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.shadowColor = '#fff'; x.shadowBlur = 26;
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect ? x.roundRect(32, 32, 64, 64, 11) : x.rect(32, 32, 64, 64); x.fill();
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
  }
  const softTex = blurTex();

  const texCache = new Map();
  function monogramTex(name) {
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.font = '700 92px Inter, system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name.slice(0, 2), 96, 100);
    const t = new THREE.CanvasTexture(c); t.anisotropy = aniso; return t;
  }
  function loadIcon(tile) {
    const slug = tile.icon;
    if (texCache.has(slug)) return texCache.get(slug);
    const p = fetch(ICON_CDN + slug + '.svg').then((r) => { if (!r.ok) throw 0; return r.text(); }).then((svg) => new Promise((res, rej) => {
      const s = svg.replace('<svg', '<svg width="192" height="192" fill="#fff"');
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 192;
        c.getContext('2d').drawImage(img, 0, 0, 192, 192);
        const t = new THREE.CanvasTexture(c); t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t);
      };
      img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    })).catch(() => null);
    texCache.set(slug, p);
    return p;
  }

  // ---------- state ----------
  let rel = null;                 // relations nodes
  const tiles = [];               // {slug,name,icon,route,r,c,brand,group,body,...,s:{lift,c,o,d,ring}}
  const bySlug = new Map();
  const wires = [];               // active + retracting
  let active = null, target = null, pendingOutAt = null;
  let pendingHover;               // before init finishes
  const connGroup = new THREE.Group(); root.add(connGroup);
  const par = { x: 0, y: 0, cx: 0, cy: 0 };
  const kbButtons = new Map();
  const tileRects = [];

  // bubbles
  const MAXB = 220;
  const bPos = new Float32Array(MAXB * 3), bAlpha = new Float32Array(MAXB);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bAlpha, 1));
  bGeo.setDrawRange(0, 0);
  const bMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uPx: { value: dpr }, uColor: { value: new THREE.Color('#8ab4f8') }, uCore: { value: new THREE.Color('#ffffff') } },
    vertexShader: 'attribute float aAlpha; varying float vA; uniform float uPx; void main(){ vA=aAlpha; gl_PointSize=11.0*uPx; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying float vA; uniform vec3 uColor; uniform vec3 uCore; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float core=1.0-smoothstep(0.26,0.40,d); float halo=(1.0-smoothstep(0.0,1.0,d))*0.38; vec3 c=mix(uColor,uCore,core); gl_FragColor=vec4(c,clamp(core+halo,0.0,1.0)*vA);\n#include <colorspace_fragment>\n }'
  });
  const bubbles = new THREE.Points(bGeo, bMat); bubbles.frustumCulled = false; bubbles.renderOrder = 30; root.add(bubbles);

  const wireVert = 'attribute float aU; attribute float aV; varying float vU; varying float vV; void main(){ vU=aU; vV=aV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  const wireFrag = 'varying float vU; varying float vV; uniform vec3 uColor; uniform float uHead; uniform float uOpacity; void main(){ if(vU>uHead) discard; float a=1.0-smoothstep(0.55,1.0,abs(vV)); a*=1.0-smoothstep(uHead-12.0,uHead,vU)*0.85; gl_FragColor=vec4(uColor,a*uOpacity);\n#include <colorspace_fragment>\n }';

  // ---------- theme ----------
  function readPalette() {
    const base = PAL[theme], cs = getComputedStyle(container);
    const v = (n) => parseCss(cs.getPropertyValue(n));
    const p = Object.assign({}, base);
    p.accent = v('--primary') || base.accent;
    p.text = v('--text') || base.text;
    p.muted = v('--muted') || base.muted;
    if (theme === 'light') p.edge = v('--line') || base.edge;
    return p;
  }
  function brandFor(hex) {
    const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
    if (theme === 'dark') { if (hsl.l < 0.35) hsl.l = hsl.s < 0.15 ? 0.82 : 0.55; } else hsl.l = Math.min(hsl.l, 0.45); // keep true brand colours; only near-black brands are lifted so they stay visible on the dark tile
    return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  }
  const C = { tile: new THREE.Color(), bg: new THREE.Color(), text: new THREE.Color(), edge: new THREE.Color(), accent: new THREE.Color() };
  function applyTheme() {
    pal = readPalette();
    C.tile.set(pal.tile); C.bg.set(pal.bg); C.text.set(pal.text); C.edge.set(pal.edge); C.accent.set(pal.accent);
    bMat.uniforms.uColor.value.copy(C.accent);
    bMat.uniforms.uCore.value.copy(theme === 'dark' ? new THREE.Color('#ffffff').lerp(C.accent, 0.25) : C.accent);
    container.setAttribute('data-tg-theme', theme);
    tiles.forEach((t) => { t.brandC = brandFor(t.brandHex); });
    wires.forEach((w) => w.mat.uniforms.uColor.value.copy(C.accent));
    connMats.forEach((m) => m.color.copy(C.text));
    dotMat.color.copy(C.text);
  }
  const connMats = [], dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
  connMats.push(lineMat);

  // ---------- build tiles ----------
  function buildTiles() {
    GRID.forEach((row, r) => row.forEach((slug, c) => {
      if (!slug) return;
      const node = rel[slug] || { name: slug, brand: '#888888', icon: slug, route: slug };
      const t = { slug, name: node.name || slug, icon: node.icon || slug, route: node.route || slug, r, c, brandHex: node.brand || '#888888', phase: Math.random() * 6.28, armed: false, s: { lift: 0, c: 0, o: 0.55, d: 0, ring: 0 } };
      t.brandC = brandFor(t.brandHex);
      const face = new THREE.MeshBasicMaterial({ color: 0xffffff }), side = new THREE.MeshBasicMaterial({ color: 0xffffff });
      t.faceMat = face; t.sideMat = side;
      t.group = new THREE.Group();
      t.body = new THREE.Mesh(bodyGeo, [face, side]); t.body.userData.tile = t;
      t.outMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
      t.ringMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      t.outline = new THREE.LineLoop(outlineGeo, t.outMat);
      t.ringL = new THREE.LineLoop(outlineGeo, t.ringMat);
      t.iconMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: monogramTex(t.name), color: 0xffffff });
      t.iconMesh = new THREE.Mesh(planeGeo, t.iconMat);
      t.glowMat = new THREE.MeshBasicMaterial({ map: softTex, transparent: true, depthWrite: false, opacity: 0 });
      t.shadowMat = new THREE.MeshBasicMaterial({ map: softTex, transparent: true, depthWrite: false, opacity: 0, color: 0x000000 });
      t.glow = new THREE.Mesh(planeGeo, t.glowMat); t.shadow = new THREE.Mesh(planeGeo, t.shadowMat);
      t.glow.renderOrder = 2; t.shadow.renderOrder = 1; t.iconMesh.renderOrder = 8; t.outline.renderOrder = 6; t.ringL.renderOrder = 7;
      t.group.add(t.body, t.outline, t.ringL, t.iconMesh);
      root.add(t.shadow, t.glow, t.group);
      tiles.push(t); bySlug.set(slug, t);
      loadIcon(t).then((tex) => { if (disposed || !tex) return; t.iconMat.map.dispose(); t.iconMat.map = tex; t.iconMat.needsUpdate = true; });
      // keyboard
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = t.name; b.setAttribute('aria-label', t.name);
      b.addEventListener('focus', () => setActive(slug));
      b.addEventListener('blur', () => setActive(null));
      b.addEventListener('click', () => opts.onSelect && opts.onSelect(t.route, slug));
      li.append(b); kb.append(li); kbButtons.set(slug, b);
    }));
  }

  // ---------- layout ----------
  const gx = (xi) => (xi - 7) * pitch / 2;
  const gy = (yi) => (3 - yi) * pitch / 2;
  const tcx = (t) => (t.c - 3) * pitch, tcy = (t) => (1 - t.r) * pitch;
  function layout() {
    W = container.clientWidth || 600; hideLabels = W < 560; H = container.clientHeight || 260;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    pitch = Math.min(W / (COLS + 0.5), H / (ROWS + 0.5));
    tileS = pitch * 0.72;
    tileRects.length = 0;
    tiles.forEach((t) => {
      t.x = tcx(t); t.y = tcy(t);
      t.body.scale.set(tileS, tileS, 5);
      t.outline.scale.set(tileS, tileS, 1); t.outline.position.z = 5.1;
      t.ringL.scale.set(tileS * 1.07, tileS * 1.07, 1); t.ringL.position.z = 5.2;
      t.iconMesh.scale.set(tileS * 0.58, tileS * 0.58, 1); t.iconMesh.position.z = 5.4;
      t.glow.scale.set(tileS * 2.05, tileS * 2.05, 1); t.glow.position.set(t.x, t.y, 0.3);
      t.shadow.scale.set(tileS * 2.0, tileS * 2.0, 1);
      t.group.position.set(t.x, t.y, 0);
      tileRects.push({ t, x0: t.x - tileS / 2, x1: t.x + tileS / 2, y0: t.y - tileS / 2, y1: t.y + tileS / 2 });
      const b = kbButtons.get(t.slug); if (b) b.parentNode.style.cssText = '';
    });
    // faint circuit connectors + junction dots
    connGroup.children.slice().forEach((o) => { connGroup.remove(o); });
    const pts = [];
    const dots = [];
    tiles.forEach((t) => {
      const rt = bySlug.get(GRID[t.r][t.c + 1]); if (rt) { pts.push(t.x + tileS / 2, t.y, 0, rt.x - tileS / 2, rt.y, 0); dots.push([(t.x + rt.x) / 2, t.y]); }
      const dn = GRID[t.r + 1] && bySlug.get(GRID[t.r + 1][t.c]); if (dn) { pts.push(t.x, t.y - tileS / 2, 0, dn.x, dn.y + tileS / 2, 0); dots.push([t.x, (t.y + dn.y) / 2]); }
    });
    if (connGeo) connGeo.dispose();
    connGeo = new THREE.BufferGeometry(); connGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ls = new THREE.LineSegments(connGeo, lineMat); connGroup.add(ls);
    dots.forEach(([x, y]) => { const m = new THREE.Mesh(dotGeo, dotMat); m.position.set(x, y, 0.05); connGroup.add(m); });
    if (active) rebuildWires();
  }
  let connGeo = null;

  // ---------- routing ----------
  const nodeId = (xi, yi) => yi * 15 + xi;
  const validNode = (xi, yi) => {
    if (xi < 0 || xi > 14 || yi < 0 || yi > 6) return false;
    if (xi % 2 === 0 || yi % 2 === 0) return true;
    const c = (xi - 1) / 2, r = (yi - 1) / 2;
    return !GRID[r][c]; // blank cell is open
  };
  function ports(t) {
    const x = 2 * t.c + 1, y = 2 * t.r + 1, h = tileS / 2;
    return [
      { xi: x + 1, yi: y, out: 0, S: new THREE.Vector2(t.x + h, t.y) },
      { xi: x, yi: y + 1, out: 1, S: new THREE.Vector2(t.x, t.y - h) },
      { xi: x - 1, yi: y, out: 2, S: new THREE.Vector2(t.x - h, t.y) },
      { xi: x, yi: y - 1, out: 3, S: new THREE.Vector2(t.x, t.y + h) }
    ];
  }
  const TURN = 20;
  function dijkstra(sp, usage) {
    const N = 15 * 7 * 4, dist = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const open = new Set();
    const s0 = nodeId(sp.xi, sp.yi) * 4 + sp.out; dist[s0] = 0; open.add(s0);
    const half = pitch / 2;
    while (open.size) {
      let u = -1, du = 1e9; open.forEach((k) => { if (dist[k] < du) { du = dist[k]; u = k; } });
      open.delete(u); done[u] = 1;
      const nd = (u / 4) | 0, d = u % 4, xi = nd % 15, yi = (nd / 15) | 0;
      for (let nd2 = 0; nd2 < 4; nd2++) {
        if (nd2 === (d + 2) % 4) continue;
        const nx = xi + DIRS[nd2][0], ny = yi + DIRS[nd2][1];
        if (!validNode(nx, ny)) continue;
        const id2 = nodeId(nx, ny), k = id2 * 4 + nd2; if (done[k]) continue;
        const ek = Math.min(nd, id2) + '-' + Math.max(nd, id2);
        const cost = du + half + (nd2 !== d ? TURN : 0) + (usage.get(ek) || 0) * 70;
        if (cost < dist[k]) { dist[k] = cost; prev[k] = u; open.add(k); }
      }
    }
    return { dist, prev };
  }
  function nodePath(prev, endState) {
    const out = []; let k = endState;
    while (k >= 0) { const nd = (k / 4) | 0; out.push([nd % 15, (nd / 15) | 0]); k = prev[k]; }
    return out.reverse();
  }
  function simplify(P) {
    const out = [];
    for (const p of P) {
      if (out.length && out[out.length - 1].distanceTo(p) < 0.01) continue;
      out.push(p);
    }
    for (let i = out.length - 2; i > 0; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 0.01 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0) out.splice(i, 1);
    }
    return out;
  }
  function roundPoly(P, R) {
    const out = [P[0].clone()];
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1];
      const d1 = a.distanceTo(b), d2 = b.distanceTo(c), r = Math.min(R, d1 / 2, d2 / 2);
      const A = b.clone().sub(a).normalize().multiplyScalar(-r).add(b), B = c.clone().sub(b).normalize().multiplyScalar(r).add(b);
      for (let k = 0; k <= 8; k++) {
        const u = k / 8, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        out.push(new THREE.Vector2(A.x * w0 + b.x * w1 + B.x * w2, A.y * w0 + b.y * w1 + B.y * w2));
      }
    }
    out.push(P[P.length - 1].clone());
    // densify to ~3px
    const dense = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / 3));
      for (let k = 1; k <= n; k++) dense.push(a.clone().lerp(b, k / n));
    }
    return dense;
  }
  function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return cum;
  }
  function hitsTile(pts, skipA, skipB) {
    const m = 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (const r of tileRects) {
        if (p.x > r.x0 - m && p.x < r.x1 + m && p.y > r.y0 - m && p.y < r.y1 + m) {
          if ((r.t === skipA || r.t === skipB)) { if (p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1) return true; continue; }
          return true;
        }
      }
    }
    return false;
  }
  function labelRectOverlap(rc, placed) {
    for (const r of tileRects) if (rc.x < r.x1 + 1.5 && rc.x + rc.w > r.x0 - 1.5 && rc.y < r.y1 + 1.5 && rc.y + rc.h > r.y0 - 1.5) return true;
    for (const p of placed) if (rc.x < p.x + p.w + 3 && rc.x + rc.w > p.x - 3 && rc.y < p.y + p.h + 3 && rc.y + rc.h > p.y - 3) return true;
    return rc.x < -W / 2 + 2 || rc.x + rc.w > W / 2 - 2 || rc.y < -H / 2 + 2 || rc.y + rc.h > H / 2 - 2;
  }
  function findLabel(pts, cum, w, placed, others) {
    const L = cum[cum.length - 1]; let best = null, bs = 1e9;
    for (let i = 3; i < pts.length - 3; i += 2) {
      const a = pts[i - 2], b = pts[i + 2], tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      if (Math.abs(ty) / tl > 0.28) continue;
      const rc = { x: pts[i].x - w / 2, y: pts[i].y - LABEL_H / 2, w, h: LABEL_H };
      if (labelRectOverlap(rc, placed)) continue;
      if (others.some((op) => op.some((q) => q.x > rc.x - 1 && q.x < rc.x + rc.w + 1 && q.y > rc.y - 2 && q.y < rc.y + rc.h + 2))) continue;
      const sc = Math.abs(cum[i] - L / 2);
      if (sc < bs) { bs = sc; best = { i, rc }; }
    }
    return best;
  }

  function planWire(A, B, text, usage, placed) {
    const w = textW(text), pa = ports(A), pb = ports(B), cands = [];
    for (const sp of pa) {
      const { dist, prev } = dijkstra(sp, usage);
      for (const tp of pb) {
        const inward = (tp.out + 2) % 4;
        let bestK = -1, bestC = 1e9;
        for (let d = 0; d < 4; d++) {
          const k = nodeId(tp.xi, tp.yi) * 4 + d; if (dist[k] >= 1e9) continue;
          const c = dist[k] + (d === inward ? 0 : TURN);
          if (c < bestC) { bestC = c; bestK = k; }
        }
        if (bestK < 0) continue;
        const nodes = nodePath(prev, bestK);
        const P = [sp.S.clone(), ...nodes.map(([xi, yi]) => new THREE.Vector2(gx(xi), gy(yi))), tp.S.clone()];
        cands.push({ cost: bestC * rnd(1, 1.22), raw: simplify(P), nodes, kind: 'route' });
      }
    }
    // direct cubic arc between facing edges
    {
      const dx = B.x - A.x, dy = B.y - A.y, h = tileS / 2, horiz = Math.abs(dx) >= Math.abs(dy);
      const S = new THREE.Vector2(A.x + (horiz ? Math.sign(dx) * h : 0), A.y + (horiz ? 0 : Math.sign(dy) * h));
      const E = new THREE.Vector2(B.x - (horiz ? Math.sign(dx) * h : 0), B.y - (horiz ? 0 : Math.sign(dy) * h));
      const k = S.distanceTo(E) * 0.45;
      const c1 = horiz ? new THREE.Vector2(S.x + Math.sign(dx) * k, S.y) : new THREE.Vector2(S.x, S.y + Math.sign(dy) * k);
      const c2 = horiz ? new THREE.Vector2(E.x - Math.sign(dx) * k, E.y) : new THREE.Vector2(E.x, E.y - Math.sign(dy) * k);
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const u = i / 60, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
        pts.push(new THREE.Vector2(S.x * a + c1.x * b + c2.x * c + E.x * d, S.y * a + c1.y * b + c2.y * c + E.y * d));
      }
      if (!hitsTile(pts, A, B)) cands.push({ cost: cumulative(pts).pop() * 0.8, dense: pts, kind: 'arc' });
    }
    cands.sort((a, b) => a.cost - b.cost);
    let chosen = null, fallback = null;
    for (const c of cands.slice(0, 14)) {
      const pts = c.dense || roundPoly(c.raw, Math.min(7, pitch * 0.1));
      const cum = cumulative(pts);
      if (!fallback) fallback = { c, pts, cum };
      const lab = findLabel(pts, cum, w, placed, placed.paths);
      if (lab) { chosen = { c, pts, cum, lab }; break; }
    }
    if (!chosen) {
      const f = fallback; const i = Math.floor(f.pts.length / 2);
      chosen = { c: f.c, pts: f.pts, cum: f.cum, lab: { i, rc: { x: f.pts[i].x - w / 2, y: f.pts[i].y - LABEL_H / 2, w, h: LABEL_H } } };
    }
    if (chosen.c.nodes) {
      const n = chosen.c.nodes;
      for (let i = 1; i < n.length; i++) { const a = nodeId(...n[i - 1]), b = nodeId(...n[i]); const k = Math.min(a, b) + '-' + Math.max(a, b); usage.set(k, (usage.get(k) || 0) + 1); }
    }
    placed.push(chosen.lab.rc); placed.paths.push(chosen.pts);
    return chosen;
  }

  function buildRibbon(pts, cum) {
    const n = pts.length, L = cum[n - 1];
    const pos = new Float32Array(n * 2 * 3), aU = new Float32Array(n * 2), aV = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx, z = 7 + 5 * Math.sin(Math.PI * cum[i] / L);
      pos.set([pts[i].x + nx * WIRE_HW, pts[i].y + ny * WIRE_HW, z, pts[i].x - nx * WIRE_HW, pts[i].y - ny * WIRE_HW, z], i * 6);
      aU[i * 2] = aU[i * 2 + 1] = cum[i]; aV[i * 2] = 1; aV[i * 2 + 1] = -1;
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aU', new THREE.BufferAttribute(aU, 1)); g.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
    g.setIndex(idx);
    return g;
  }

  function addWire(src, dst, link, usage, placed, delay, instant) {
    const plan = planWire(src, dst, link.verb, usage, placed);
    const geo = buildRibbon(plan.pts, plan.cum), L = plan.cum[plan.cum.length - 1];
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: C.accent.clone() }, uHead: { value: 0 }, uOpacity: { value: 0.85 } },
      vertexShader: wireVert, fragmentShader: wireFrag
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 20; root.add(mesh);
    const el = document.createElement('div'); el.className = 'tg-label'; el.textContent = link.verb; labelsEl.append(el);
    const p = plan.pts[plan.lab.i];
    const nB = clamp(Math.round(L / 62), 2, 7), dir = link.dir || 'out';
    const speed = rnd(0.6, 1.2) * 92, phase = rnd(0, 1);
    const bs = [];
    for (let i = 0; i < nB; i++) bs.push({ off: ((i + phase + rnd(-0.12, 0.12)) / nB) * L, rev: dir === 'in' || (dir === 'both' && i % 2 === 1) });
    const w = {
      src, dst, mesh, mat, geo, el, L, pts: plan.pts, cum: plan.cum, anchor: new THREE.Vector3(p.x, p.y, 7 + 5 * Math.sin(Math.PI * plan.cum[plan.lab.i] / L)),
      labelFrac: plan.cum[plan.lab.i] / L, t0: performance.now(), delay, dur: rnd(350, 600), retractAt: null, head: 0, speed, bs, dir, instant: !!instant, link
    };
    wires.push(w);
    return w;
  }
  function showWires(slug, instant) {
    const node = rel && rel[slug], src = bySlug.get(slug);
    if (!node || !src) return;
    const links = node.links.filter((l) => bySlug.has(l.to)).sort(() => Math.random() - 0.5);
    const usage = new Map(), placed = []; placed.paths = [];
    let acc = rnd(0, 50);
    links.forEach((l) => { acc += rnd(60, 160); addWire(src, bySlug.get(l.to), l, usage, placed, reduced || instant ? 0 : acc, instant); });
  }
  function removeWire(w) {
    root.remove(w.mesh); w.geo.dispose(); w.mat.dispose(); w.el.remove();
    wires.splice(wires.indexOf(w), 1);
  }
  function retractAll(at) { wires.forEach((w) => { if (w.retractAt == null) w.retractAt = at; }); }
  function rebuildWires() {
    [...wires].forEach(removeWire);
    if (active) showWires(active, true);
  }

  // ---------- activation ----------
  function setActive(slug) {
    if (disposed) return;
    if (!rel) { pendingHover = slug; return; }
    if (slug && !bySlug.has(slug)) slug = resolve(slug);
    if (slug === target) return;
    target = slug;
    if (!slug) { pendingOutAt = performance.now() + 150; return; }
    pendingOutAt = null;
    if (active === slug) return;
    retractAll(performance.now());
    active = slug;
    showWires(slug, false);
  }
  function resolve(q) {
    if (!q) return null; q = String(q).toLowerCase();
    for (const t of tiles) if (t.slug === q || t.icon === q || t.route === q || t.name.toLowerCase() === q) return t.slug;
    return null;
  }

  // ---------- pointer ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let ptrType = 'mouse', touchWasActive = false;
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    par.x = ndc.x; par.y = ndc.y;
    ray.setFromCamera(ndc, camera); root.updateMatrixWorld(true);
    const hit = ray.intersectObjects(tiles.map((t) => t.body), false)[0];
    return hit ? hit.object.userData.tile : null;
  }
  const onMove = (ev) => {
    ptrType = ev.pointerType || 'mouse';
    const t = pick(ev);
    canvas.style.cursor = t ? 'pointer' : '';
    if (ptrType === 'touch') return;
    if (t) setActive(t.slug); else if (target && !heldExternally) setActive(null);
  };
  const onLeave = (ev) => { par.x = 0; par.y = 0; canvas.style.cursor = ''; if ((ev.pointerType || 'mouse') !== 'touch' && !heldExternally) setActive(null); };
  const onDown = (ev) => {
    if (ev.pointerType !== 'touch') return;
    const t = pick(ev);
    touchWasActive = !!(t && t.slug === active);
    setActive(t ? t.slug : null);
    if (!t) pendingOutAt = performance.now();
  };
  const onClick = (ev) => {
    const t = pick(ev);
    if (!t) return;
    if (ev.pointerType === 'touch' && !touchWasActive) return;
    opts.onSelect && opts.onSelect(t.route, t.slug);
  };
  let heldExternally = false;
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('click', onClick);

  // ---------- frame ----------
  const v3 = new THREE.Vector3();
  function frame(ts) {
    raf = 0; if (disposed) return;
    if (!visible || document.hidden) { last = 0; return; }
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    if (pendingOutAt != null && now >= pendingOutAt) { retractAll(pendingOutAt); active = null; pendingOutAt = null; }

    // parallax
    const pk = 1 - Math.exp(-dt / 0.12), maxA = 3 * Math.PI / 180;
    par.cx += (par.x - par.cx) * pk; par.cy += (par.y - par.cy) * pk;
    root.rotation.y = reduced ? 0 : par.cx * maxA; root.rotation.x = reduced ? 0 : -par.cy * maxA;

    // wires
    const arrived = new Set();
    for (let i = wires.length - 1; i >= 0; i--) {
      const w = wires[i];
      const g = snap || reduced || w.instant ? 1 : easeOut(clamp((now - w.t0 - w.delay) / w.dur, 0, 1));
      const rf = w.retractAt == null ? 0 : (snap || reduced ? (now >= w.retractAt ? 1 : 0) : easeIO(clamp((now - w.retractAt) / 320, 0, 1)));
      if (rf >= 1) { removeWire(w); continue; }
      w.head = g * (1 - rf); w.rf = rf;
      w.mat.uniforms.uHead.value = w.head >= 0.999 ? 1e5 : w.head * w.L;
      if (w.retractAt == null && g >= 0.8) arrived.add(w.dst);
    }
    tiles.forEach((t) => { t.armed = arrived.has(t); });

    // tiles
    const k = snap ? 1 : 1 - Math.exp(-dt / (reduced ? 0.03 : 0.075));
    const sec = now / 1000;
    tiles.forEach((t) => {
      const wv = (!active && !reduced) ? 0.5 + 0.5 * Math.sin(now / 650 - (t.c * 0.85 + t.r * 0.55)) : 0; // a soft wave of light travels across the grid to invite a click
      let tl = wv * 4, tc = idleColor ? 1 : 0, to = 1, td = 0, tr = 0; // icons fully opaque at rest
      if (active) {
        if (t.slug === active) { tl = 14; tc = 1; to = 1; tr = 1; }
        else if (t.armed) { tl = 5; tc = 1; to = idleColor ? 1 : 0.85; }
        else { to = 0.3; td = 1; if (idleColor) tc = 0.35; }
      }
      const s = t.s;
      s.lift += (tl - s.lift) * k; s.c += (tc - s.c) * k; s.o += (to - s.o) * k; s.d += (td - s.d) * k; s.ring += (tr - s.ring) * k;
      const bob = reduced ? 0 : Math.sin(sec * 0.9 + t.phase) * 1;
      t.group.position.set(t.x, t.y + bob, s.lift);
      t.faceMat.color.copy(C.tile).lerp(C.bg, s.d * 0.45);
      t.sideMat.color.copy(t.faceMat.color).multiplyScalar(theme === 'dark' ? 0.62 : 0.86);
      t.outMat.color.copy(C.edge); t.outMat.opacity = 0; // no resting border; only the hover ring shows
      t.ringMat.color.copy(t.brandC); t.ringMat.opacity = s.ring * 0.95;
      t.iconMat.color.copy(C.text).lerp(t.brandC, s.c); t.iconMat.opacity = s.o;
      t.glowMat.color.copy(t.brandC); t.glowMat.opacity = s.ring * (theme === 'dark' ? 0.34 : 0.28) + wv * (theme === 'dark' ? 0.2 : 0.14);
      t.shadowMat.opacity = (s.lift / 14) * (theme === 'dark' ? 0.5 : 0.22);
      t.shadow.position.set(t.x, t.y + bob - s.lift * 0.45, 0.2);
    });

    // bubbles
    let nb = 0;
    for (const w of wires) {
      if (w.head <= 0.01) continue;
      const headL = w.head * w.L;
      for (const b of w.bs) {
        if (nb >= MAXB) break;
        const s = reduced ? -1 : ((b.off + sec * w.speed) % w.L + w.L) % w.L;
        if (s < 0) continue;
        const pos = b.rev ? w.L - s : s;
        if (pos > headL) continue;
        // sample point
        let lo = 0, hi = w.cum.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.cum[m] > pos) hi = m; else lo = m; }
        const f = (pos - w.cum[lo]) / ((w.cum[hi] - w.cum[lo]) || 1), a = w.pts[lo], c = w.pts[hi];
        bPos[nb * 3] = a.x + (c.x - a.x) * f; bPos[nb * 3 + 1] = a.y + (c.y - a.y) * f;
        bPos[nb * 3 + 2] = 8 + 5 * Math.sin(Math.PI * pos / w.L);
        const edge = Math.min(s, w.L - s);
        bAlpha[nb] = clamp(edge / 14, 0, 1) * (1 - (w.rf || 0)) * 0.95;
        nb++;
      }
    }
    bGeo.setDrawRange(0, nb); bGeo.attributes.position.needsUpdate = true; bGeo.attributes.aAlpha.needsUpdate = true;

    // labels
    root.updateMatrixWorld(true);
    for (const w of wires) {
      v3.copy(w.anchor).applyMatrix4(root.matrixWorld).project(camera);
      w.el.style.transform = `translate3d(${((v3.x + 1) / 2 * W).toFixed(1)}px,${((1 - v3.y) / 2 * H).toFixed(1)}px,0) translate(-50%,-50%)`;
      const show = clamp((w.head - w.labelFrac) / 0.08, 0, 1) * (1 - (w.rf || 0));
      w.el.style.opacity = hideLabels ? '0' : (0.85 * show).toFixed(3);
    }
    renderer.render(scene, camera);
  }
  function start() { if (!raf && !disposed && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }

  // ---------- lifecycle ----------
  const ro = new ResizeObserver(() => { if (!disposed && rel) { layout(); } });
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) start(); });
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);
  const mo = new MutationObserver(() => {
    const t = root3.getAttribute('data-theme'); if (t && t !== theme) setTheme(t);
  });
  mo.observe(root3, { attributes: true, attributeFilter: ['data-theme'] });
  function setTheme(t) { theme = t === 'light' ? 'light' : 'dark'; applyTheme(); }

  const ready = (async () => {
    await Promise.resolve();
    try {
      if (opts.relations) rel = opts.relations.nodes || opts.relations;
      else {
        const url = opts.relationsUrl || new URL('../data/relations.json', import.meta.url);
        rel = (await (await fetch(url)).json()).nodes;
      }
    } catch (e) { rel = {}; }
    if (disposed) return;
    buildTiles(); applyTheme(); layout();
    ro.observe(container); io.observe(container);
    start();
    opts.onReady && opts.onReady(handle);
    if (pendingHover !== undefined) { setActive(pendingHover); pendingHover = undefined; }
  })();

  function unmount() {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); mo.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('click', onClick);
    [...wires].forEach(removeWire);
    tiles.forEach((t) => { [t.faceMat, t.sideMat, t.outMat, t.ringMat, t.glowMat, t.shadowMat].forEach((m) => m.dispose()); if (t.iconMat.map) t.iconMat.map.dispose(); t.iconMat.dispose(); });
    texCache.forEach((p) => p.then((tx) => tx && tx.dispose()));
    [bodyGeo, outlineGeo, planeGeo, dotGeo, bGeo, connGeo].forEach((g) => g && g.dispose());
    [bMat, dotMat, lineMat].forEach((m) => m.dispose()); softTex.dispose();
    renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
    canvas.remove(); labelsEl.remove(); kb.remove();
    container.classList.remove('tg'); container.removeAttribute('data-tg-theme');
  }

  const handle = {
    ready, unmount, setTheme,
    hover(slug) { const r = slug ? resolve(slug) : null; heldExternally = !!r; setActive(r); },
    settle(on = true) { snap = !!on; },
    get active() { return active; }
  };
  return handle;
}
