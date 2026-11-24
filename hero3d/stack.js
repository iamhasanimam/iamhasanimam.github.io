// stack.js - isometric layered "stack" showcase (glass slabs + icon tiles + travelling-dot links).
//   const h = await mountStack(el, spec, opts);  h.setTab(id); h.select(tileId); h.unmount();
// Spec: {title,subtitle,tabs:[{id,label,layers:[layerId]}],layers:[{id,label,tone,tiles:[{id,label,icon,says,detail}]}],
//        links:[{from,to}],run:{cmd,lines},declarations:[]}. Every field is optional/tolerated. See stack-README.md.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const TYPE_MS = 48;      // ms per typed character of run.cmd
export const LINE_MS = 560;     // ms between printed run.lines
const LOOP_PAUSE_MS = 3200;     // pause before the terminal loops
const TONES = { indigo: '#6f6bff', orange: '#ff9f1c', teal: '#2ec4b6', violet: '#b07cff', slate: '#8aa0c8' };
const ORANGE = new THREE.Color('#ff9f1c');
const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";
const SP = 3.4, TILE_GAP = 2.7, CARD = 1.35, EL = Math.atan(1 / Math.SQRT2);   // true isometric elevation (35.264 deg)

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mkc = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
function rr(ctx, x, y, w, hh, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x + w, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function rrShape(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function ensureCss() {
  try {
    if (document.querySelector('link[href$="stack.css"], link[data-stack3d]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.stack3d = '1'; l.href = new URL('./stack.css', import.meta.url).href; document.head.appendChild(l);
  } catch { /* host css */ }
}
function webglOk() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

const iconCache = new Map();
function loadIcon(slug, color) {
  if (!slug || !/^[a-z0-9._-]+$/i.test(slug)) return Promise.reject(new Error('slug'));
  const key = slug + color; if (iconCache.has(key)) return iconCache.get(key);
  const p = (async () => {
    const c = new AbortController(), to = setTimeout(() => c.abort(), 6000);
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/${slug}.svg`, { signal: c.signal });
      if (!r.ok) throw new Error(String(r.status)); let t = await r.text(); if (!/<svg/i.test(t)) throw new Error('svg');
      t = t.replace(/<svg/i, `<svg width="256" height="256" fill="${color}"`);
      const url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
      try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); } finally { URL.revokeObjectURL(url); }
    } finally { clearTimeout(to); }
  })();
  iconCache.set(key, p); p.catch(() => iconCache.delete(key)); return p;
}
let glowTex = null;
const getGlow = () => {
  if (glowTex) return glowTex;
  const c = mkc(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace; return glowTex;
};
function tex(c, r) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = r.capabilities.getMaxAnisotropy(); return t; }

function drawFace(t) {
  const c = t.canvas, x = c.getContext('2d'), S = c.width; x.clearRect(0, 0, S, S);
  const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, 'rgba(70,66,200,.55)'); g.addColorStop(1, 'rgba(20,16,90,.62)');
  rr(x, 8, 8, S - 16, S - 16, 46); x.fillStyle = g; x.fill();
  x.lineWidth = 6; x.strokeStyle = t.toneHex; x.shadowColor = t.toneHex; x.shadowBlur = 12; x.stroke(); x.shadowBlur = 0;
  rr(x, 20, 20, S - 40, S - 40, 36); x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.22)'; x.stroke();
  if (t.img) { const s = S * 0.54; x.drawImage(t.img, (S - s) / 2, (S - s) / 2, s, s); }
  else {
    const m = (t.spec.label || t.spec.id || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    x.fillStyle = '#fff'; x.font = `800 ${S * 0.38}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = t.toneHex; x.shadowBlur = 16; x.fillText(m, S / 2, S / 2 + 6); x.shadowBlur = 0;
  }
  t.faceTex.needsUpdate = true;
}
function labelCanvas(text) {
  const c = mkc(512, 128), x = c.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle';
  let s = 54; for (; s > 22; s -= 2) { x.font = `600 ${s}px ${FONT}`; if (x.measureText(text).width < 440) break; }
  const w = x.measureText(text).width + 44; rr(x, (512 - w) / 2, 26, w, 76, 38); x.fillStyle = 'rgba(14,12,80,.55)'; x.fill(); x.lineWidth = 2; x.strokeStyle = 'rgba(190,186,255,.35)'; x.stroke();
  x.fillStyle = '#fff'; x.fillText(text, 256, 66); return c;
}

export async function mountStack(container, spec = {}, opts = {}) {
  ensureCss(); container.classList.add('stack3d');
  const root = h('div', 'stack3d__root'); container.appendChild(root);
  const layers = (spec.layers || []).filter((l) => l && l.id).map((l) => ({ ...l, tiles: (l.tiles || []).filter((t) => t && t.id) }));
  const tabs = (spec.tabs && spec.tabs.length ? spec.tabs : [{ id: 'overview', label: 'Overview', layers: [] }]);
  const reduced = opts.reducedMotion ?? (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  const mobile = () => (container.clientWidth || 800) < 640;

  const fallback = () => {
    root.replaceChildren(); const f = h('div', 'stack3d__fallback'); f.appendChild(h('h3', '', spec.title || 'Stack')); if (spec.subtitle) f.appendChild(h('p', '', spec.subtitle));
    layers.forEach((l) => { f.appendChild(h('h4', '', l.label || l.id)); const ul = h('ul'); l.tiles.forEach((t) => { const li = h('li'); li.appendChild(h('strong', '', t.label || t.id)); li.appendChild(document.createTextNode(t.says ? ' - ' + t.says : '')); ul.appendChild(li); }); f.appendChild(ul); });
    root.appendChild(f); const n = () => {};
    return { mode: 'fallback', unmount() { root.remove(); container.classList.remove('stack3d'); }, setTab: n, select: n };
  };
  if (!layers.length || !webglOk()) return fallback();
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { return fallback(); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement; canvas.className = 'stack3d__canvas'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', (spec.title || 'Stack') + '. ' + (spec.subtitle || ''));
  canvas.style.touchAction = 'pan-y'; root.appendChild(canvas);

  let disposed = false;
  const scene = new THREE.Scene(), HH = 20;
  const camera = new THREE.OrthographicCamera(-HH, HH, HH / 2, -HH / 2, -200, 200);
  const pmrem = new THREE.PMREMGenerator(renderer); const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04); scene.environment = envRT.texture; scene.environmentIntensity = 0.55;
  scene.add(new THREE.AmbientLight(0xaab0ff, 0.7)); const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(-6, 14, 8); scene.add(dl);
  const stackG = new THREE.Group(); scene.add(stackG);

  /* ---- background lattice */
  const latN = 150, lat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x9a96ff, transparent: true, opacity: 0.35, depthWrite: false }), latN);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); for (let i = 0; i < latN; i++) { const p = new THREE.Vector3((Math.random() - 0.5) * 46, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 36); q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0)); sc.setScalar(0.5 + Math.random() * 1.2); m.compose(p, q, sc); lat.setMatrixAt(i, m); } }
  const latG = new THREE.Group(); latG.add(lat); scene.add(latG);

  /* ---- layers & tiles */
  const n = layers.length, midY = ((n - 1) * SP) / 2;
  const maxTiles = Math.max(1, ...layers.map((l) => l.tiles.length)); const rows = maxTiles > 4 ? 2 : 1, cols = Math.ceil(maxTiles / rows);
  const W = cols * TILE_GAP + 1.8, D = rows * TILE_GAP + 1.2, THICK = 0.5;
  const tileById = new Map(), pickables = [], layerRecs = [];
  layers.forEach((l, li) => {
    const toneHex = TONES[l.tone] || TONES.indigo, tone = new THREE.Color(toneHex);
    const g = new THREE.Group(); g.position.y = (n - 1 - li) * SP; stackG.add(g);
    const geo = new THREE.ExtrudeGeometry(rrShape(W, D, 0.9), { depth: THICK, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -THICK, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: tone.clone().lerp(new THREE.Color('#141058'), 0.7), emissive: tone, emissiveIntensity: 0.12, roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.6, envMapIntensity: 0.9 });
    const slab = new THREE.Mesh(geo, mat); g.add(slab);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: tone.clone().lerp(new THREE.Color('#fff'), 0.35), transparent: true, opacity: 0.95 })); g.add(edges);
    const gp = []; for (let x = -Math.floor(W / 2) + 1; x <= Math.floor(W / 2) - 1; x++) gp.push(x, 0.012, -D / 2 + 0.7, x, 0.012, D / 2 - 0.7); for (let z = -Math.floor(D / 2) + 1; z <= Math.floor(D / 2) - 1; z++) gp.push(-W / 2 + 0.7, 0.012, z, W / 2 - 0.7, 0.012, z);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.22 })); g.add(grid);
    const under = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlow(), color: tone, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); under.scale.set(W * 1.15, D * 1.5, 1); under.position.y = -THICK - 0.25; under.material.rotation = 0; g.add(under);
    // layer name pinned to the slab front-left corner
    const lc = labelCanvas((l.label || l.id).toUpperCase()), lt = tex(lc, renderer);
    const lsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false })); lsp.scale.set(3.4, 0.85, 1); lsp.position.set(-W / 2 + 1.7, 0.45, D / 2 + 0.15); g.add(lsp);
    const rec = { l, g, mats: [mat, edges.material, grid.material, under.material, lsp.material], base: [0.6, 0.95, 0.22, 0.28, 1], vis: 1, tiles: [], baseY: g.position.y, tone, toneHex };
    layerRecs.push(rec);
    l.tiles.forEach((tsp, ti) => {
      const col = ti % cols, row = Math.floor(ti / cols), cnt = Math.min(cols, l.tiles.length - row * cols);
      const x = (col - (cnt - 1) / 2) * TILE_GAP, z = (row - (rows - 1) / 2) * TILE_GAP;
      const tg = new THREE.Group(); tg.position.set(x, 1.25, z); g.add(tg); const face = new THREE.Group(); face.rotation.y = Math.PI / 4; tg.add(face);
      const t = { spec: tsp, layer: rec, g: tg, face, baseY: 1.25, canvas: mkc(256, 256), toneHex, tone, vis: 1, hov: 0, sel: 0, img: null, phase: ti * 1.3 + li };
      t.faceTex = tex(t.canvas, renderer); drawFace(t);
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(rrShape(CARD, CARD, 0.28), { depth: 0.14, bevelEnabled: false, curveSegments: 8 }), new THREE.MeshPhysicalMaterial({ color: 0x1b1780, emissive: tone, emissiveIntensity: 0.18, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.55 }));
      body.geometry.translate(0, 0, -0.07); face.add(body);
      t.faceMat = new THREE.MeshBasicMaterial({ map: t.faceTex, transparent: true, toneMapped: false, depthWrite: false });
      const fm = new THREE.Mesh(new THREE.PlaneGeometry(CARD, CARD), t.faceMat); fm.position.z = 0.075; face.add(fm);
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD * 1.5, CARD * 2.1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.set(0, -0.35, 0.2); hit.userData.tile = t; face.add(hit); pickables.push(hit);
      t.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlow(), color: tone, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })); t.glow.scale.setScalar(3.4); tg.add(t.glow);
      t.shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlow(), color: tone, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })); t.shadow.scale.set(2.2, 1.3, 1); t.shadow.position.y = -1.2; tg.add(t.shadow);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(labelCanvas(tsp.label || tsp.id), renderer), transparent: true, depthWrite: false })); lab.scale.set(2.5, 0.625, 1); lab.position.set(0, -1.0, 0.1); tg.add(lab); t.label = lab;
      rec.tiles.push(t); tileById.set(tsp.id, t);
      if (tsp.icon) loadIcon(tsp.icon, '#ffffff').then((img) => { if (!disposed) { t.img = img; drawFace(t); dirty = true; } }).catch(() => {});
    });
  });
  if (!layerRecs.length) return fallback();

  /* ---- links */
  const links = []; const dotCount = 3;
  (spec.links || []).forEach((l) => {
    const a = tileById.get(l.from), b = tileById.get(l.to); if (!a || !b) return;
    const rec = { a, b, geo: null, mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x8f8cff, transparent: true, opacity: 0.6, depthWrite: false })), curve: null, key: '', hot: 0, dots: [] };
    rec.halo = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x8f8cff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    stackG.add(rec.mesh, rec.halo);
    if (!reduced) for (let i = 0; i < dotCount; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlow(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.setScalar(0.55); stackG.add(sp); rec.dots.push({ sp, ph: i / dotCount }); }
    links.push(rec);
  });
  const wp = (t, out) => { out.set(t.g.position.x, t.layer.g.position.y + t.g.position.y - 0.1, t.g.position.z); return out; };
  function rebuildLink(lk) {
    const A = wp(lk.a, new THREE.Vector3()), B = wp(lk.b, new THREE.Vector3()); const key = [A.x, A.y, A.z, B.x, B.y, B.z].map((v) => v.toFixed(2)).join();
    if (key === lk.key) return; lk.key = key; const mid = A.clone().lerp(B, 0.5); mid.y += 1.1 + A.distanceTo(B) * 0.12;
    lk.curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    lk.mesh.geometry.dispose(); lk.halo.geometry.dispose();
    lk.mesh.geometry = new THREE.TubeGeometry(lk.curve, 28, 0.03, 5, false); lk.halo.geometry = new THREE.TubeGeometry(lk.curve, 28, 0.1, 5, false);
  }

  /* ---- camera */
  const camState = { tx: 0, ty: midY, tz: 0, zoomMul: 1, az: Math.PI / 4 };
  const camGoal = { ...camState };
  let baseZoom = 1, pointerX = 0, t0 = 0;
  const bbox = (() => { const pts = []; for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) for (const y of [-THICK - 0.3, (n - 1) * SP + 3.3]) pts.push(new THREE.Vector3(x, y, z)); return pts; })();
  function placeCamera(extraAz = 0) {
    const az = camState.az + extraAz, d = new THREE.Vector3(Math.sin(az) * Math.cos(EL), Math.sin(EL), Math.cos(az) * Math.cos(EL));
    camera.position.set(camState.tx, camState.ty, camState.tz).addScaledVector(d, 60); camera.lookAt(camState.tx, camState.ty, camState.tz);
  }
  function fit() {
    const w = container.clientWidth || 800, hh = container.clientHeight || 520, asp = w / hh;
    camera.left = -HH * asp / 1; camera.right = HH * asp; camera.top = HH; camera.bottom = -HH; camera.updateProjectionMatrix();
    const d = new THREE.Vector3(Math.sin(Math.PI / 4) * Math.cos(EL), Math.sin(EL), Math.cos(Math.PI / 4) * Math.cos(EL)), right = new THREE.Vector3(0, 1, 0).cross(d).normalize(), up = d.clone().cross(right).normalize();
    let mx = 0, my = 0; bbox.forEach((p) => { const q = p.clone().sub(new THREE.Vector3(0, midY, 0)); mx = Math.max(mx, Math.abs(q.dot(right))); my = Math.max(my, Math.abs(q.dot(up))); });
    const m = mobile() ? 0.78 : 0.7;   // leave room for header / tabs / terminal
    baseZoom = Math.min((HH * asp) / mx, HH / my) * m; dirty = true;
  }

  /* ---- UI */
  const head = h('div', 'stack3d__head'); head.append(h('strong', '', spec.title || ''), h('span', '', spec.subtitle || '')); root.appendChild(head);
  const tabBar = h('div', 'stack3d__tabs'); tabBar.setAttribute('role', 'tablist'); root.appendChild(tabBar);
  const live = h('div', 'stack3d__sr'); live.setAttribute('aria-live', 'polite'); root.appendChild(live);
  const tabBtns = new Map();
  tabs.forEach((tb) => { const b = h('button', 'stack3d__tab', tb.label || tb.id); b.type = 'button'; b.setAttribute('role', 'tab'); b.addEventListener('click', () => setTab(tb.id)); tabBar.appendChild(b); tabBtns.set(tb.id, b); });
  const tip = h('div', 'stack3d__tip'); tip.hidden = true; root.appendChild(tip);
  const card = h('aside', 'stack3d__card'); card.hidden = true;
  const cX = h('button', 'stack3d__x', '×'); cX.type = 'button'; cX.setAttribute('aria-label', 'Close details');
  const cLayer = h('span', 'stack3d__chip'), cT = h('h3'), cS = h('p', 'stack3d__says'), cD = h('p', 'stack3d__detail'); card.append(cX, cLayer, cT, cS, cD); root.appendChild(card);
  const sr = h('ul', 'stack3d__sr'); sr.setAttribute('aria-label', 'Stack components');
  layerRecs.forEach((r) => r.tiles.forEach((t) => { const li = h('li'), b = h('button', '', `${t.spec.label || t.spec.id} (${r.l.label || r.l.id})${t.spec.says ? ': ' + t.spec.says : ''}`); b.type = 'button'; b.addEventListener('focus', () => setHover(t, null)); b.addEventListener('blur', () => setHover(null)); b.addEventListener('click', () => select(t.spec.id)); li.appendChild(b); sr.appendChild(li); }));
  root.appendChild(sr);
  if (spec.declarations && spec.declarations.length) root.appendChild(h('div', 'stack3d__decl', spec.declarations.join(' · ')));

  /* terminal */
  let termTimer = 0, termOn = true;
  if (spec.run && (spec.run.cmd || (spec.run.lines || []).length)) {
    const term = h('div', 'stack3d__term'); term.setAttribute('aria-label', 'Terminal'); term.setAttribute('role', 'group');
    const bar = h('div', 'stack3d__term-bar'); bar.append(h('i'), h('i'), h('i')); const body = h('div', 'stack3d__term-body'); term.append(bar, body); root.appendChild(term);
    const cmd = spec.run.cmd || '', lines = spec.run.lines || [];
    const prompt = h('div', 'stack3d__line'); const ps = h('span', 'stack3d__ps', '$ '), typed = h('span'), caret = h('span', 'stack3d__caret'); prompt.append(ps, typed, caret);
    const show = () => { body.replaceChildren(prompt); };
    if (reduced) { show(); typed.textContent = cmd; caret.remove(); lines.forEach((ln) => body.appendChild(h('div', 'stack3d__line stack3d__out', ln))); }
    else {
      const sleep = (ms) => new Promise((r) => { termTimer = setTimeout(r, ms); });
      (async () => {
        while (!disposed) {
          show(); typed.textContent = ''; if (!caret.isConnected) prompt.appendChild(caret);
          for (let i = 1; i <= cmd.length && !disposed; i++) { while (!termOn && !disposed) await sleep(300); typed.textContent = cmd.slice(0, i); await sleep(TYPE_MS); }
          await sleep(LINE_MS);
          for (const ln of lines) { if (disposed) return; while (!termOn && !disposed) await sleep(300); const d = h('div', 'stack3d__line stack3d__out', ln); body.appendChild(d); body.scrollTop = body.scrollHeight; await sleep(LINE_MS); }
          await sleep(LOOP_PAUSE_MS);
        }
      })();
    }
  }

  /* ---- state */
  let tabId = tabs[0].id, sel = null, hover = null, dirty = true, tween = false, tourT = null;
  const spotSet = () => { const tb = tabs.find((x) => x.id === tabId) || tabs[0]; const ids = (tb.layers || []).filter((id) => layerRecs.some((r) => r.l.id === id)); return ids.length ? new Set(ids) : new Set(layerRecs.map((r) => r.l.id)); };
  function goal() {
    const sp = spotSet(), foc = layerRecs.filter((r) => sp.has(r.l.id)); const cy = foc.reduce((s, r) => s + r.baseY, 0) / foc.length;
    if (sel) { const t = tileById.get(sel), wpv = wp(t, new THREE.Vector3()); Object.assign(camGoal, { tx: wpv.x, ty: wpv.y, tz: wpv.z, zoomMul: 1.9 }); }
    else Object.assign(camGoal, { tx: 0, ty: cy, tz: 0, zoomMul: foc.length === n ? 1 : Math.min(1.75, 1 + 0.9 * (1 - foc.length / n)) });
    tween = true; dirty = true;
  }
  function setTab(id) {
    if (!tabBtns.has(id)) return; tabId = id; sel = null; card.hidden = true; root.classList.remove('has-card');
    tabBtns.forEach((b, k) => { b.setAttribute('aria-selected', String(k === id)); b.classList.toggle('is-on', k === id); b.tabIndex = k === id ? 0 : -1; });
    const tb = tabs.find((x) => x.id === id); live.textContent = 'Showing ' + (tb.label || id); goal();
  }
  function select(id) {
    const t = tileById.get(id); if (!t) return; sel = id; cLayer.textContent = t.layer.l.label || t.layer.l.id; cLayer.style.setProperty('--c', t.toneHex);
    cT.textContent = t.spec.label || id; cS.textContent = t.spec.says || ''; cD.textContent = t.spec.detail || ''; card.hidden = false; root.classList.add('has-card'); goal();
  }
  function deselect() { sel = null; card.hidden = true; root.classList.remove('has-card'); goal(); }
  function setHover(t, pt) {
    hover = t; dirty = true; if (!t) { tip.hidden = true; return; }
    tip.replaceChildren(h('b', '', t.spec.label || ''), h('span', '', t.spec.says || '')); tip.hidden = !t.spec.says; tipPt = pt;
  }
  let tipPt = null;
  function placeTip() {
    if (tip.hidden || !hover) return; const r = root.getBoundingClientRect(); let x, y;
    if (tipPt) { x = tipPt.x - r.left + 16; y = tipPt.y - r.top + 18; } else { const v = wp(hover, new THREE.Vector3()).applyMatrix4(stackG.matrixWorld).project(camera); x = (v.x * 0.5 + 0.5) * r.width + 40; y = (-v.y * 0.5 + 0.5) * r.height - 30; }
    tip.style.transform = `translate(${clamp(x, 6, r.width - tip.offsetWidth - 6)}px,${clamp(y, 6, r.height - tip.offsetHeight - 6)}px)`;
  }
  cX.addEventListener('click', deselect);
  const onKey = (e) => { if (e.key === 'Escape') { if (tabId !== tabs[0].id) { setTab(tabs[0].id); } deselect(); } };
  container.addEventListener('keydown', onKey);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let ptr = null, down = null, ptrDirty = false;
  const pick = (cx, cy) => { const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); stackG.updateMatrixWorld(true); const hs = ray.intersectObjects(pickables, false).filter((x) => x.object.userData.tile.vis > 0.5); return hs.length ? hs[0].object.userData.tile : null; };
  canvas.addEventListener('pointermove', (e) => { const r = root.getBoundingClientRect(); pointerX = ((e.clientX - r.left) / r.width - 0.5) * 2; if (e.pointerType !== 'touch') { ptr = { x: e.clientX, y: e.clientY }; ptrDirty = true; } });
  canvas.addEventListener('pointerleave', () => { ptr = null; pointerX = 0; if (!(document.activeElement && sr.contains(document.activeElement))) { setHover(null); canvas.style.cursor = ''; } });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => { if (!down) return; const mv = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null; if (mv > 8 || dt > 600) return; const t = pick(e.clientX, e.clientY); if (t) select(t.spec.id); else if (sel) deselect(); });

  /* auto tour */
  if (opts.autoTour && !reduced && tabs.length > 1) { let i = 0; tourT = setInterval(() => { if (!sel && visible && !tabHidden) { i = (i + 1) % tabs.length; setTab(tabs[i].id); } }, opts.tourMs || 6000); }

  let visible = true, tabHidden = document.hidden, raf = 0, last = 0, clock = 0;
  const ro = new ResizeObserver(() => { const w = container.clientWidth || 800, hh = container.clientHeight || 520; renderer.setSize(w, hh, false); fit(); }); ro.observe(container);
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; termOn = visible && !tabHidden; run(); }, { threshold: 0.01 }); io.observe(container);
  const onVis = () => { tabHidden = document.hidden; termOn = visible && !tabHidden; run(); }; document.addEventListener('visibilitychange', onVis);
  function run() { const go = visible && !tabHidden && !disposed; if (go && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } else if (!go && raf) { cancelAnimationFrame(raf); raf = 0; } }

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.6); let moving = false;
    const lerp = (a, b, kk = k) => { const v = a + (b - a) * kk; if (Math.abs(b - v) > 0.002) { moving = true; return v; } return b; };
    for (const key of ['tx', 'ty', 'tz', 'zoomMul']) camState[key] = lerp(camState[key], camGoal[key]);
    if (ptrDirty) { ptrDirty = false; const t = ptr ? pick(ptr.x, ptr.y) : null; canvas.style.cursor = t ? 'pointer' : ''; if (t !== hover) setHover(t, ptr); else if (t) tipPt = ptr; }
    const sp = spotSet(), selT = sel ? tileById.get(sel) : null;
    layerRecs.forEach((r) => {
      r.vis = lerp(r.vis, sp.has(r.l.id) ? 1 : 0.25); const v = r.vis;
      r.g.position.y = r.baseY - (1 - v) * 0.45; r.mats.forEach((m, i) => { m.opacity = r.base[i] * (0.25 + 0.75 * v * (i === 4 ? 1 : 1)); });
      r.tiles.forEach((t) => {
        t.vis = v; t.hov = lerp(t.hov, hover === t ? 1 : 0); t.sel = lerp(t.sel, selT === t ? 1 : 0);
        const bob = reduced ? 0 : Math.sin(clock * 1.2 + t.phase) * 0.05; t.g.position.y = t.baseY + t.hov * 0.35 + t.sel * 0.25 + bob;
        t.faceMat.opacity = 0.25 + 0.75 * v; t.label.material.opacity = 0.25 + 0.75 * v; t.glow.material.opacity = (0.22 + 0.5 * t.hov + 0.35 * t.sel) * v; t.shadow.material.opacity = 0.4 * v * (1 - 0.3 * t.hov);
        t.face.children[0].material.opacity = 0.25 + 0.4 * v; t.face.children[0].material.emissiveIntensity = 0.18 + 0.6 * t.hov + 0.5 * t.sel; t.face.scale.setScalar(1 + 0.06 * t.hov);
      });
    });
    const focusedTab = tabId !== tabs[0].id;
    links.forEach((lk) => {
      rebuildLink(lk); const v = Math.min(lk.a.vis, lk.b.vis); const hotT = selT ? (lk.a === selT || lk.b === selT ? 1 : 0) : (focusedTab && lk.a.vis > 0.9 && lk.b.vis > 0.9 ? 1 : 0); lk.hot = lerp(lk.hot, hotT);
      const c = tmp2.set(0.435, 0.42, 1).lerp(ORANGE, lk.hot); lk.mesh.material.color.copy(c); lk.halo.material.color.copy(c);
      lk.mesh.material.opacity = (0.35 + 0.4 * lk.hot) * (0.3 + 0.7 * v); lk.halo.material.opacity = 0.12 * (0.3 + 0.7 * v) * (1 + lk.hot);
      lk.dots.forEach((d) => { d.sp.position.copy(lk.curve.getPoint((clock * 0.18 + d.ph) % 1)); d.sp.material.color.copy(tmp2.set(1, 1, 1).lerp(ORANGE, lk.hot)); d.sp.material.opacity = 0.9 * (0.2 + 0.8 * v); });
    });
    // camera: true isometric, slow breathing + pointer parallax
    const sway = reduced ? 0 : Math.sin(clock * 0.25) * 0.035 + pointerX * 0.1, breath = reduced ? 1 : 1 + Math.sin(clock * 0.45) * 0.012;
    camState.az = Math.PI / 4; placeCamera(sway); camera.zoom = baseZoom * camState.zoomMul * (mobile() && sel ? 0.9 : 1) * breath; camera.updateProjectionMatrix();
    if (!reduced) { latG.rotation.y = clock * 0.012; latG.position.y = Math.sin(clock * 0.2) * 0.4; }
    placeTip(); if (moving) dirty = true;
    if (!reduced || dirty) { renderer.render(scene, camera); dirty = false; root.classList.add('is-ready'); }
  }
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 520, false); fit();
  setTab(opts.tab && tabBtns.has(opts.tab) ? opts.tab : tabs[0].id);
  if (reduced) { Object.assign(camState, camGoal); }
  run();

  return {
    mode: 'webgl', setTab, select, deselect,
    unmount() {
      if (disposed) return; disposed = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(termTimer); clearInterval(tourT); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); container.removeEventListener('keydown', onKey);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      if (glowTex) { glowTex.dispose(); glowTex = null; } envRT.dispose(); pmrem.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ }
      root.remove(); container.classList.remove('stack3d');
    },
  };
}
export function unmountStack(handle) { if (handle && handle.unmount) handle.unmount(); }
