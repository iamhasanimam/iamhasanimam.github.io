// world.js - persistent immersive Three.js backdrop ("the world") for the single-page app.
// One InstancedMesh of glass cubes/plates (<= 2000 instances), rails + glowing data packets,
// scroll fly-through, pointer parallax/ripples, route-driven morphs. See world-README.md.
import * as THREE from 'three';

const TIERS = {
  high:   { n: 2000, packets: 40, glow: true,  dpr: 1.5, fps: 60 },
  medium: { n: 1000, packets: 24, glow: false, dpr: 1.25, fps: 60 },
  low:    { n: 500,  packets: 12, glow: false, dpr: 1,   fps: 30 },
};
const TIER_ORDER = ['high', 'medium', 'low'];
const MAX_N = 2000;
const PATTERN_MAX = 300;
const RAILS = 12, RAIL_K = 5;
const XSPAN = 45;

const ROUTES = {
  overview:     { fov: 52, ts: 1,   pat: null },
  career:       { fov: 50, ts: 0.9, pat: 'career' },
  work:         { fov: 50, ts: 0.8, pat: 'work' },
  writing:      { fov: 50, ts: 0.8, pat: 'writing' },
  technologies: { fov: 50, ts: 0.8, pat: 'grid' },
  tech:         { fov: 34, ts: 0.35, pat: null },
  connect:      { fov: 50, ts: 0.7, pat: 'ring' },
};

const PALETTES = {
  dark: {
    line: '#e8eaed', accents: ['#4285f4', '#ea4335', '#fbbc04', '#34a853'],
    edge: 0.24, face: 0.8, additive: true, rail: 0.12, packet: 1.0, tint: 0.55,
  },
  light: {
    line: '#9aa0a6', accents: ['#5b8def', '#e8665c', '#e8b023', '#4cae6a'],
    edge: 0.34, face: 0.9, additive: false, rail: 0.2, packet: 0.9, tint: 0.7,
  },
};

const VERT = `
attribute vec3 aTint;
attribute float aGlow;
uniform float uFog;
uniform float uXFade;
varying vec3 vP;
varying vec3 vTint;
varying float vGlow;
varying float vFade;
varying vec3 vScale;
void main(){
  vP = position; vTint = aTint; vGlow = aGlow;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  float depth = -mv.z;
  float fog = exp(-uFog * max(depth - 3.0, 0.0));
  float near = smoothstep(1.5, 7.0, depth);
  float side = 1.0 - smoothstep(uXFade * 0.7, uXFade, abs(wp.x));
  vFade = fog * near * side;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform vec3 uLine;
uniform float uEdge;
uniform float uFace;
uniform float uOpacity;
uniform float uTint;
uniform float uEdgeW;
uniform vec2 uRes;
varying vec3 vP;
varying vec3 vTint;
varying float vGlow;
varying float vFade;
varying vec3 vScale;
void main(){
  vec3 d = (0.5 - abs(vP)) * vScale;
  float w = uEdgeW;
  float n1 = 1.0 - smoothstep(0.0, w, d.x);
  float n2 = 1.0 - smoothstep(0.0, w, d.y);
  float n3 = 1.0 - smoothstep(0.0, w, d.z);
  float edge = max(max(n1 * n2, n2 * n3), n1 * n3);
  float face = (0.03 + 0.05 * (vP.y + 0.5)) * uFace;
  vec2 c = gl_FragCoord.xy / uRes - 0.5; c.x *= uRes.x / uRes.y;
  float vig = 0.5 + 0.5 * smoothstep(0.15, 0.85, length(c));
  float tintAmt = uTint * (0.35 + step(0.001, dot(vTint, vTint)) * 0.0);
  vec3 col = mix(uLine, vTint, uTint);
  float a = (face + edge * uEdge) * vFade * vig;
  a += vGlow * (edge * 0.55 + 0.07) * vFade;
  col = mix(col, vTint, clamp(vGlow, 0.0, 1.0) * 0.6);
  a = min(a * uOpacity, 0.5);
  gl_FragColor = vec4(col, a);
}`;

const PVERT = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vC;
varying float vA;
void main(){
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.5), 2.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;

const PFRAG = `
uniform float uHalo;
uniform float uStrength;
varying vec3 vC;
varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.08, 0.26, r);
  float halo = pow(1.0 - r, 2.6) * 0.55 * uHalo;
  float a = (core + halo) * vA * uStrength;
  gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.5), min(a, 1.0));
}`;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => x * x * (3 - 2 * x);

let current = null;

export function unmountWorld() {
  if (current) { current.unmount(); current = null; }
}

function noopHandle() {
  const f = () => {};
  return { unmount: f, setRoute: f, setScroll: f, pulse: f, setTheme: f, setQuality: f, pause: f, resume: f, active: false };
}

function parseColor(str) {
  try {
    if (!str) return null;
    const c = new THREE.Color();
    c.set(str.trim());
    return c;
  } catch (e) { return null; }
}

function detectTheme(forced) {
  if (forced === 'dark' || forced === 'light') return forced;
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  try {
    const bg = parseColor(getComputedStyle(root).getPropertyValue('--bg'));
    if (bg) return (bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114) < 0.5 ? 'dark' : 'light';
  } catch (e) { /* ignore */ }
  return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export async function mountWorld(opts = {}) {
  unmountWorld();
  const host = opts.container || document.body;

  let renderer;
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return noopHandle();
    const canvas = document.createElement('canvas');
    canvas.className = 'world-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: opts.container ? 'absolute' : 'fixed', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: String(opts.zIndex ?? -1), display: 'block',
    });
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    host.appendChild(canvas);
  } catch (e) {
    return noopHandle();
  }
  const canvas = renderer.domElement;

  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || opts.reducedMotion === true;
  let qualityMode = opts.quality || 'auto';
  let tierName = TIERS[qualityMode] ? qualityMode : 'high';
  let tier = TIERS[tierName];
  let themeName = detectTheme(opts.theme);
  let themeForced = opts.theme === 'dark' || opts.theme === 'light';
  let pal = PALETTES[themeName];
  let accentColors = [];
  let lineColor = new THREE.Color();
  const baseOpacity = clamp(opts.opacity ?? 1, 0.1, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  const rng = mulberry32(opts.seed ?? 20260511);

  // ---------- instance data ----------
  const bx = new Float32Array(MAX_N), by = new Float32Array(MAX_N), bz = new Float32Array(MAX_N);
  const lspd = new Float32Array(MAX_N), phase = new Float32Array(MAX_N), bob = new Float32Array(MAX_N);
  const rot0 = new Float32Array(MAX_N), spin = new Float32Array(MAX_N);
  const bs = new Float32Array(MAX_N * 3);
  const cur = new Float32Array(MAX_N * 3);
  const pp = new Float32Array(MAX_N * 3), ps = new Float32Array(MAX_N * 3);
  const pIn = new Uint8Array(MAX_N);
  const mArr = new Float32Array(MAX_N), mRate = new Float32Array(MAX_N);
  const glowArr = new Float32Array(MAX_N);
  const tintArr = new Float32Array(MAX_N * 3);
  const accentIdx = new Int8Array(MAX_N);

  (function genLattice() {
    const cells = [];
    const layers = 9, dz = 7, dx = 6.2;
    for (let l = 0; l < layers; l++) {
      for (let z = 20; z > -150; z -= dz) {
        for (let x = -XSPAN; x < XSPAN; x += dx) cells.push([x, (l - 4) * 3.5, z, l]);
      }
    }
    for (let i = cells.length - 1; i > 0; i--) { // shuffle so any prefix is uniformly spread
      const j = Math.floor(rng() * (i + 1)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    for (let i = 0; i < MAX_N; i++) {
      const c = cells[i];
      bx[i] = c[0] + (rng() - 0.5) * dx * 0.8;
      by[i] = c[1] + (rng() - 0.5) * 1.4;
      bz[i] = c[2] + (rng() - 0.5) * dz * 0.8;
      lspd[i] = (c[3] % 2 ? 1 : -1) * (0.12 + 0.05 * c[3] + rng() * 0.12);
      phase[i] = rng() * 6.283; bob[i] = 0.15 + rng() * 0.4;
      rot0[i] = Math.PI / 4 + (rng() - 0.5) * 0.5; spin[i] = (rng() - 0.5) * 0.12;
      const k = rng();
      let sx, sy, sz;
      if (k < 0.68) { sx = sy = sz = 0.5 + rng() * 1.0; if (rng() < 0.3) sy *= 1.6; }
      else if (k < 0.92) { sx = 1.6 + rng() * 2.4; sy = 0.06 + rng() * 0.06; sz = 1.4 + rng() * 2.4; }
      else { sx = 0.07; sy = 1.6 + rng() * 2.6; sz = 1.2 + rng() * 1.8; } // vertical thin pane
      bs[i * 3] = sx; bs[i * 3 + 1] = sy; bs[i * 3 + 2] = sz;
      accentIdx[i] = rng() < 0.2 ? Math.floor(rng() * 4) : -1;
      mRate[i] = 1.1 + rng() * 1.6;
    }
  })();

  function applyThemeColors() {
    pal = PALETTES[themeName];
    const root = document.documentElement;
    let primary = null;
    try { primary = parseColor(getComputedStyle(root).getPropertyValue('--primary')); } catch (e) { /* ignore */ }
    accentColors = pal.accents.map((h) => new THREE.Color(h));
    // keep the Google-blue accent aligned with the host's --primary only when it is a blue-ish hue
    if (primary) {
      const hsl = {}; primary.getHSL(hsl);
      if (hsl.h > 0.5 && hsl.h < 0.7) accentColors[0] = primary;
    }
    lineColor = new THREE.Color(pal.line);
    for (let i = 0; i < MAX_N; i++) {
      const c = accentIdx[i] >= 0 ? accentColors[accentIdx[i]] : lineColor;
      tintArr[i * 3] = c.r; tintArr[i * 3 + 1] = c.g; tintArr[i * 3 + 2] = c.b;
    }
  }
  applyThemeColors();

  // ---------- mesh ----------
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const tintAttr = new THREE.InstancedBufferAttribute(tintArr, 3);
  const glowAttr = new THREE.InstancedBufferAttribute(glowArr, 1);
  glowAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTint', tintAttr);
  geo.setAttribute('aGlow', glowAttr);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    blending: pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uLine: { value: lineColor }, uEdge: { value: pal.edge }, uFace: { value: pal.face },
      uOpacity: { value: baseOpacity * 0.85 }, uTint: { value: pal.tint }, uEdgeW: { value: 0.035 },
      uFog: { value: 0.034 }, uXFade: { value: XSPAN }, uRes: { value: new THREE.Vector2(1, 1) },
    },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = tier.n;
  scene.add(mesh);
  const mArrE = mesh.instanceMatrix.array;

  // ---------- rails + packets ----------
  const railIdx = [];
  (function buildRails() {
    const pool = 500;
    const used = new Set();
    for (let r = 0; r < RAILS; r++) {
      const chain = [];
      let a = Math.floor(rng() * pool);
      while (used.has(a)) a = Math.floor(rng() * pool);
      chain.push(a); used.add(a);
      for (let k = 1; k < RAIL_K; k++) {
        const p = chain[k - 1]; let best = -1, bd = 1e9;
        for (let j = 0; j < pool; j++) {
          if (used.has(j)) continue;
          const dxx = bx[j] - bx[p], dyy = by[j] - by[p], dzz = bz[j] - bz[p];
          const dd = dxx * dxx + dyy * dyy * 2 + dzz * dzz * 0.6; // prefer forward/neighbour hops
          if (dd < bd && bz[j] < bz[p] + 4) { bd = dd; best = j; }
        }
        if (best < 0) best = (p + 1) % pool;
        chain.push(best); used.add(best);
      }
      railIdx.push(chain);
    }
  })();
  const railPos = new Float32Array(RAILS * (RAIL_K - 1) * 6);
  const railGeo = new THREE.BufferGeometry();
  const railAttr = new THREE.BufferAttribute(railPos, 3);
  railAttr.setUsage(THREE.DynamicDrawUsage);
  railGeo.setAttribute('position', railAttr);
  const railMat = new THREE.LineBasicMaterial({ color: pal.line, transparent: true, opacity: pal.rail, depthTest: false, depthWrite: false, blending: pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const rails = new THREE.LineSegments(railGeo, railMat);
  rails.frustumCulled = false;
  scene.add(rails);

  const MAXP = TIERS.high.packets;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  const pSize = new Float32Array(MAXP), pAlpha = new Float32Array(MAXP);
  const pRail = new Int16Array(MAXP), pT = new Float32Array(MAXP), pSpd = new Float32Array(MAXP), pAcc = new Int8Array(MAXP);
  for (let i = 0; i < MAXP; i++) {
    pRail[i] = i % RAILS; pT[i] = rng() * (RAIL_K - 1); pSpd[i] = 0.12 + rng() * 0.2; pAcc[i] = i % 4;
    pSize[i] = 0.55 + rng() * 0.35; pAlpha[i] = 1;
  }
  const pGeo = new THREE.BufferGeometry();
  const pPosAttr = new THREE.BufferAttribute(pPos, 3); pPosAttr.setUsage(THREE.DynamicDrawUsage);
  const pColAttr = new THREE.BufferAttribute(pCol, 3);
  pGeo.setAttribute('position', pPosAttr);
  pGeo.setAttribute('aColor', pColAttr);
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
  pGeo.setDrawRange(0, tier.packets);
  const pMat = new THREE.ShaderMaterial({
    vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, depthTest: false,
    blending: pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 500 }, uHalo: { value: 1 }, uStrength: { value: pal.packet } },
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  function refreshPacketColors() {
    for (let i = 0; i < MAXP; i++) {
      const c = accentColors[pAcc[i]];
      pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b;
    }
    pColAttr.needsUpdate = true;
  }
  refreshPacketColors();

  function applyThemeMaterials() {
    const bl = pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.blending = bl; railMat.blending = bl; pMat.blending = bl;
    mat.needsUpdate = railMat.needsUpdate = pMat.needsUpdate = true;
    mat.uniforms.uLine.value = lineColor;
    mat.uniforms.uEdge.value = pal.edge; mat.uniforms.uFace.value = pal.face; mat.uniforms.uTint.value = pal.tint;
    railMat.color.set(pal.line); railMat.opacity = pal.rail;
    pMat.uniforms.uStrength.value = pal.packet;
    tintAttr.needsUpdate = true;
    refreshPacketColors();
  }

  // ---------- route patterns ----------
  let routeName = 'overview';
  let routeCfg = ROUTES.overview;
  const camState = { fov: 52, ts: 1 };

  function buildPattern(kind) {
    const n = Math.min(tier.n, PATTERN_MAX);
    pIn.fill(0);
    if (!kind) return;
    const r = mulberry32(777);
    for (let i = 0; i < n; i++) {
      pIn[i] = 1;
      const b = i * 3;
      let x = 0, y = 0, z = -16, sx = 0.5, sy = 0.5, sz = 0.5;
      if (kind === 'career') {
        const t = i / n;
        x = (t - 0.5) * 26; y = Math.sin(t * Math.PI * 3.2) * 3.6 + (r() - 0.5) * 1.6;
        z = -16 + Math.cos(t * Math.PI * 3.2) * 3 + (r() - 0.5) * 1.4;
        if (i % 5 === 0) { sx = 1.4; sy = 0.07; sz = 1.1; } else { sx = sy = sz = 0.28 + r() * 0.45; }
      } else if (kind === 'work') {
        const k = i % 3;
        if (i < 3) { x = (k - 1) * 9; y = 0; z = -18; sx = 6.5; sy = 8.5; sz = 0.12; }
        else {
          x = (k - 1) * 9 + (r() - 0.5) * 5.4; y = (r() - 0.5) * 7; z = -16.2 + r() * 1.2;
          sx = sy = sz = 0.25 + r() * 0.5;
        }
      } else if (kind === 'writing') {
        const row = i % 7;
        y = (row - 3) * 1.9; x = (Math.floor(i / 7) / (n / 7) - 0.5) * 27 + (r() - 0.5) * 0.4; z = -17 + (r() - 0.5) * 1.5;
        sx = 0.5 + r() * 1.5; sy = 0.07; sz = 0.55;
      } else if (kind === 'grid') {
        const cols = 14, rows = Math.ceil(n / cols);
        x = ((i % cols) - (cols - 1) / 2) * 2.1; y = (Math.floor(i / cols) - (rows - 1) / 2) * 1.8; z = -17 + Math.sin(i * 0.7) * 0.6;
        sx = sy = sz = 0.55;
        if (rows > 6) { y *= 6 / rows; }
      } else if (kind === 'ring') {
        const t = i / n, ring = i % 3;
        const a = t * Math.PI * 2 * 3 + ring;
        const rad = 6.5 + ring * 1.1;
        x = Math.cos(a) * rad; y = Math.sin(a) * rad * 0.7; z = -16 + Math.sin(a * 2) * 0.8;
        sx = sy = sz = 0.32 + r() * 0.35;
      }
      pp[b] = x; pp[b + 1] = y; pp[b + 2] = z;
      ps[b] = sx; ps[b + 1] = sy; ps[b + 2] = sz;
    }
  }

  // ---------- pointer / pulses / scroll ----------
  const ptr = { x: 0, y: 0, sx: 0, sy: 0, active: false, ndcx: 0, ndcy: 0 };
  const pulses = [];
  let scrollT = 0, scrollS = 0;
  let w = 1, h = 1;

  function toNdc(cx, cy) {
    return [(cx / Math.max(w, 1)) * 2 - 1, -((cy / Math.max(h, 1)) * 2 - 1)];
  }
  function onPointerMove(e) {
    const [nx, ny] = toNdc(e.clientX, e.clientY);
    ptr.x = nx; ptr.y = ny; ptr.ndcx = nx; ptr.ndcy = ny; ptr.active = true; requestRender();
  }
  function onPointerLeave() { ptr.active = false; ptr.x = 0; ptr.y = 0; }
  function onPointerDown(e) { if (opts.autoPulse !== false) handle.pulse(e.clientX, e.clientY); }
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('pointerdown', onPointerDown, { passive: true });

  // ---------- sizing ----------
  function resize() {
    w = canvas.clientWidth || (host === document.body ? window.innerWidth : host.clientWidth) || 1;
    h = canvas.clientHeight || (host === document.body ? window.innerHeight : host.clientHeight) || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dpr, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    mat.uniforms.uRes.value.set(w * dpr, h * dpr);
    pMat.uniforms.uScale.value = (h * dpr * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    if (framed && !destroyed && !contextLost) renderer.render(scene, camera); // avoid a blank canvas until the next frame
    requestRender();
  }
  let framed = false;
  window.addEventListener('resize', resize);
  let ro = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

  // ---------- main loop ----------
  const tmpV = new THREE.Matrix4();
  let simT = 0, last = 0, rafId = 0, running = false, paused = false, destroyed = false, contextLost = false;
  let slowFrames = 0, lastDraw = 0, emaDt = 1 / 60;
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();

  function pathAt(s, out) {
    out.set(Math.sin(s * 5.5) * 7, Math.cos(s * 3.7) * 2.5 + 1.5, 10 - s * 100);
    return out;
  }

  function updateCamera(dt, tNow) {
    const ps_ = scrollS;
    pathAt(ps_, camPos);
    pathAt(Math.min(ps_ + 0.03, 1.05), camTarget);
    camPos.x += Math.sin(tNow * 0.1) * 1.4;
    camPos.y += Math.sin(tNow * 0.08) * 0.5;
    camTarget.y -= 0.7;
    camera.up.set(0, 1, 0);
    const roll = Math.sin(ps_ * 9) * 0.05 + ptr.sx * 0.02;
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    // pointer parallax (position + gaze)
    const e = camera.matrixWorld.elements;
    camera.position.x += e[0] * ptr.sx * 1.3 + e[4] * ptr.sy * 0.8;
    camera.position.y += e[1] * ptr.sx * 1.3 + e[5] * ptr.sy * 0.8;
    camera.position.z += e[2] * ptr.sx * 1.3 + e[6] * ptr.sy * 0.8;
    camera.lookAt(camTarget);
    if (Math.abs(camera.fov - camState.fov) > 0.01) {
      camera.fov = camState.fov;
      camera.updateProjectionMatrix();
      const dpr = renderer.getPixelRatio();
      pMat.uniforms.uScale.value = (h * dpr * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    }
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  function updateInstances(dt, tNow) {
    const n = tier.n;
    const e = camera.matrixWorld.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], bxv = e[8], byv = e[9], bzv = e[10];
    const cpx = e[12], cpy = e[13], cpz = e[14];
    tmpV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const vp = tmpV.elements;
    const aspect = camera.aspect;
    const yaw = 0.22 * Math.sin(tNow * 0.15) + (scrollS - 0.5) * 0.5;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const interact = !reduced && ptr.active;
    const nP = pulses.length;
    const wrap = XSPAN * 2;
    const hasPattern = !!routeCfg.pat;
    const snap = reduced;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      // morph progress
      const target = (hasPattern && pIn[i]) ? 1 : 0;
      let m = mArr[i];
      if (m !== target) {
        if (snap) m = target;
        else { m += (target - m) * (1 - Math.exp(-dt * mRate[i] * 0.9)); if (Math.abs(m - target) < 0.002) m = target; }
        mArr[i] = m;
      }
      const me = smooth(m);

      // lattice position with drift + bob
      let lx = bx[i] + tNow * lspd[i];
      lx = ((lx + XSPAN) % wrap + wrap) % wrap - XSPAN;
      const ly = by[i] + Math.sin(tNow * 0.6 + phase[i]) * bob[i];
      const lz = bz[i];
      let x = lx, y = ly, z = lz;
      let sxs = bs[i3], sys = bs[i3 + 1], szs = bs[i3 + 2];

      if (me > 0) {
        const dxp = pp[i3], dzp = pp[i3 + 2] + 16;
        const qx = dxp * cy + dzp * sy_;
        const qz = -dxp * sy_ + dzp * cy - 16;
        const qy = pp[i3 + 1] + Math.sin(tNow * 0.7 + phase[i]) * 0.15;
        const tx = cpx + rx * qx + ux * qy + bxv * qz;
        const ty = cpy + ry * qx + uy * qy + byv * qz;
        const tz = cpz + rz * qx + uz * qy + bzv * qz;
        x = lx + (tx - lx) * me; y = ly + (ty - ly) * me; z = lz + (tz - lz) * me;
        sxs += (ps[i3] - sxs) * me; sys += (ps[i3 + 1] - sys) * me; szs += (ps[i3 + 2] - szs) * me;
      }

      // pointer + pulse interaction
      let g = glowArr[i];
      let tg = 0;
      if (interact || nP) {
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
        const cyy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        if (cw > 0.5) {
          const nx = cx / cw, ny = cyy / cw;
          if (interact) {
            const ddx = (nx - ptr.ndcx) * aspect, ddy = ny - ptr.ndcy;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            if (d < 0.26) {
              const f = 1 - d / 0.26; const k = f * f;
              tg = Math.max(tg, k);
              const inv = d > 1e-4 ? 1 / d : 0;
              const push = k * 0.9;
              x += (rx * ddx * inv / aspect + ux * ddy * inv) * push * 0 + (rx * ddx * inv + ux * ddy * inv) * push;
              y += (ry * ddx * inv + uy * ddy * inv) * push;
              z += (rz * ddx * inv + uz * ddy * inv) * push;
            }
          }
          for (let p = 0; p < nP; p++) {
            const pl = pulses[p];
            const age = tNow - pl.t0;
            const R = age * 1.15;
            const ddx = (nx - pl.x) * aspect, ddy = ny - pl.y;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            const q = (d - R) / 0.09;
            const amp = Math.exp(-q * q) * (1 - age / 1.9);
            if (amp > 0.02) {
              tg = Math.max(tg, amp);
              const inv = d > 1e-4 ? 1 / d : 0;
              const push = amp * 0.7;
              x += (rx * ddx + ux * ddy) * inv * push; y += (ry * ddx + uy * ddy) * inv * push; z += (rz * ddx + uz * ddy) * inv * push;
            }
          }
        }
      }
      g += (tg - g) * (tg > g ? 0.35 : 0.06);
      if (g < 0.003) g = 0;
      glowArr[i] = g;

      cur[i3] = x; cur[i3 + 1] = y; cur[i3 + 2] = z;

      // compose matrix: Y rotation * scale, translation
      const a = rot0[i] + tNow * spin[i] + (me > 0 ? (0 - rot0[i]) * me : 0);
      const c = Math.cos(a), s = Math.sin(a);
      const gs = 1 + g * 0.2;
      sxs *= gs; sys *= gs; szs *= gs;
      const o = i * 16;
      mArrE[o] = c * sxs; mArrE[o + 1] = 0; mArrE[o + 2] = -s * sxs; mArrE[o + 3] = 0;
      mArrE[o + 4] = 0; mArrE[o + 5] = sys; mArrE[o + 6] = 0; mArrE[o + 7] = 0;
      mArrE[o + 8] = s * szs; mArrE[o + 9] = 0; mArrE[o + 10] = c * szs; mArrE[o + 11] = 0;
      mArrE[o + 12] = x; mArrE[o + 13] = y; mArrE[o + 14] = z; mArrE[o + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    glowAttr.needsUpdate = true;
  }

  function updateRailsAndPackets(dt) {
    let o = 0;
    for (let r = 0; r < RAILS; r++) {
      const ch = railIdx[r];
      for (let k = 0; k < RAIL_K - 1; k++) {
        const a = ch[k] * 3, b = ch[k + 1] * 3;
        railPos[o++] = cur[a]; railPos[o++] = cur[a + 1]; railPos[o++] = cur[a + 2];
        railPos[o++] = cur[b]; railPos[o++] = cur[b + 1]; railPos[o++] = cur[b + 2];
      }
    }
    railAttr.needsUpdate = true;
    const np = tier.packets;
    for (let i = 0; i < np; i++) {
      if (!reduced) {
        pT[i] += pSpd[i] * dt * camState.ts;
        if (pT[i] >= RAIL_K - 1) { pT[i] -= RAIL_K - 1; pRail[i] = (pRail[i] + 5) % RAILS; }
      }
      const seg = Math.min(Math.floor(pT[i]), RAIL_K - 2), f = pT[i] - seg;
      const ch = railIdx[pRail[i]];
      const a = ch[seg] * 3, b = ch[seg + 1] * 3;
      pPos[i * 3] = cur[a] + (cur[b] - cur[a]) * f;
      pPos[i * 3 + 1] = cur[a + 1] + (cur[b + 1] - cur[a + 1]) * f;
      pPos[i * 3 + 2] = cur[a + 2] + (cur[b + 2] - cur[a + 2]) * f;
    }
    pPosAttr.needsUpdate = true;
  }

  function setTier(name) {
    tierName = name; tier = TIERS[name];
    mesh.count = tier.n;
    pGeo.setDrawRange(0, tier.packets);
    pMat.uniforms.uHalo.value = tier.glow ? 1 : 0;
    for (let i = tier.n; i < MAX_N; i++) { glowArr[i] = 0; }
    buildPattern(routeCfg.pat);
    for (let i = 0; i < MAX_N; i++) mArr[i] = (routeCfg.pat && pIn[i]) ? mArr[i] : 0;
    resize();
  }
  pMat.uniforms.uHalo.value = tier.glow ? 1 : 0;

  function frame(now) {
    rafId = 0;
    if (destroyed || paused || contextLost) { running = false; return; }
    const minGap = 1000 / tier.fps - 2;
    if (!reduced && now - lastDraw < minGap) { rafId = requestAnimationFrame(frame); return; }
    lastDraw = now;
    let dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    dt = clamp(dt, 0.001, 0.05);

    if (!reduced) {
      // adaptive quality
      emaDt += (Math.min((now - (frame.prev || now)) / 1000 || dt, 0.2) - emaDt) * 0.05;
      frame.prev = now;
      if (qualityMode === 'auto' && !document.hidden) {
        const slow = emaDt > (tier.fps === 30 ? 0.06 : 0.034);
        slowFrames = slow ? slowFrames + 1 : Math.max(0, slowFrames - 2);
        if (slowFrames > 90 && tierName !== 'low') {
          slowFrames = 0; emaDt = 1 / 60;
          setTier(TIER_ORDER[TIER_ORDER.indexOf(tierName) + 1]);
        }
      }
    }

    // smoothing
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3);
    scrollS += (scrollT - scrollS) * k;
    ptr.sx += (ptr.x - ptr.sx) * (reduced ? 0 : 1 - Math.exp(-dt * 4));
    ptr.sy += (ptr.y - ptr.sy) * (reduced ? 0 : 1 - Math.exp(-dt * 4));
    const kc = reduced ? 1 : 1 - Math.exp(-dt * 2.2);
    camState.fov += (routeCfg.fov - camState.fov) * kc;
    camState.ts += (routeCfg.ts - camState.ts) * kc;
    if (!reduced) simT += dt * camState.ts;
    for (let i = pulses.length - 1; i >= 0; i--) if (simT - pulses[i].t0 > 2) pulses.splice(i, 1);

    updateCamera(dt, simT);
    updateInstances(dt, simT);
    updateRailsAndPackets(dt);
    renderer.render(scene, camera);
    framed = true;

    if (reduced) {
      const settled = Math.abs(scrollT - scrollS) < 1e-4 && Math.abs(routeCfg.fov - camState.fov) < 0.05;
      if (!settled) rafId = requestAnimationFrame(frame); else running = false;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function requestRender() {
    if (destroyed || paused || running || contextLost) return;
    running = true; last = 0;
    rafId = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = 0; running = false; }
    else { last = 0; frame.prev = 0; requestRender(); }
  }
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; if (rafId) cancelAnimationFrame(rafId); rafId = 0; running = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; requestRender(); });

  // theme observers
  const mo = new MutationObserver(() => {
    if (themeForced) return;
    const t = detectTheme();
    if (t !== themeName) { themeName = t; applyThemeColors(); applyThemeMaterials(); requestRender(); }
    else { applyThemeColors(); tintAttr.needsUpdate = true; requestRender(); }
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
  let mq = null, mqHandler = null;
  if (window.matchMedia) {
    mq = matchMedia('(prefers-color-scheme: light)');
    mqHandler = () => { if (!themeForced) { const t = detectTheme(); if (t !== themeName) { themeName = t; applyThemeColors(); applyThemeMaterials(); requestRender(); } } };
    if (mq.addEventListener) mq.addEventListener('change', mqHandler);
  }

  // ---------- handle ----------
  const handle = {
    active: true,
    unmount() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      mo.disconnect(); if (ro) ro.disconnect();
      if (mq && mqHandler && mq.removeEventListener) mq.removeEventListener('change', mqHandler);
      geo.dispose(); mat.dispose(); railGeo.dispose(); railMat.dispose(); pGeo.dispose(); pMat.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      canvas.remove();
      if (current === handle) current = null;
    },
    setRoute(name, o) {
      const cfg = ROUTES[name] || ROUTES.overview;
      routeName = ROUTES[name] ? name : 'overview';
      routeCfg = cfg;
      buildPattern(cfg.pat);
      if (reduced || (o && o.instant)) { for (let i = 0; i < MAX_N; i++) mArr[i] = (cfg.pat && pIn[i]) ? 1 : 0; camState.fov = cfg.fov; camState.ts = cfg.ts; }
      requestRender();
    },
    setScroll(p) { scrollT = clamp(+p || 0, 0, 1); requestRender(); },
    pulse(x, y) {
      let nx, ny;
      if (x == null) { nx = 0; ny = 0; }
      else if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { nx = x * 2 - 1; ny = -(y * 2 - 1); }
      else [nx, ny] = toNdc(x, y);
      pulses.push({ x: nx, y: ny, t0: simT });
      if (pulses.length > 4) pulses.shift();
      requestRender();
    },
    setTheme(t) {
      if (t === 'dark' || t === 'light') { themeForced = true; themeName = t; }
      else { themeForced = false; themeName = detectTheme(); }
      applyThemeColors(); applyThemeMaterials(); requestRender();
    },
    setQuality(q) {
      qualityMode = q === 'auto' || TIERS[q] ? q : 'auto';
      slowFrames = 0;
      if (TIERS[qualityMode]) setTier(qualityMode);
      requestRender();
    },
    pause() { paused = true; running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; canvas.style.visibility = 'hidden'; },
    resume() { if (!paused) return; paused = false; canvas.style.visibility = ''; last = 0; requestRender(); },
    get route() { return routeName; },
    get quality() { return tierName; },
    get theme() { return themeName; },
  };

  applyThemeMaterials();
  resize();
  if (opts.route) handle.setRoute(opts.route, { instant: opts.instant });
  if (opts.scroll != null) { scrollT = scrollS = clamp(+opts.scroll, 0, 1); }
  if (reduced) { for (let i = 0; i < MAX_N; i++) mArr[i] = (routeCfg.pat && pIn[i]) ? 1 : 0; camState.fov = routeCfg.fov; camState.ts = routeCfg.ts; }
  simT = reduced ? 3 : 0;
  // warm start: prewarm the morph so first paint is not an empty/unsettled frame
  requestRender();
  current = handle;
  return handle;
}
