/*
 * hero3d/quest.js - "Career Quest": scroll-driven (and keyboard-playable) 3D journey.
 *   import { mountQuest, unmountQuest } from './hero3d/quest.js';
 *   mountQuest(el, { base:'assets/journey/', careerUrl:'data/career.json', onNavigate(hash){ location.hash = hash } });
 * The container becomes a tall scroll section (default 500vh) with a sticky 100vh stage.
 * Reduced motion, no WebGL, or asset failure => static vertical list of role cards.
 */

const THREE_VERSION = '0.160.0';
const DEFAULT_CDN = `https://unpkg.com/three@${THREE_VERSION}/`;
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const ACCENT_HEX = 0x8ab4f8;
const LINKEDIN = 'https://www.linkedin.com/in/iamhasanimam';
const LEVEL_DWELL = 0.075, SUMMIT_DWELL = 0.1;
const DEFAULT_BADGES = {
  aws: 'AWS Certified Cloud Practitioner',
  throughput: '400 req/s at p95 under 50 ms',
  runbook: 'Runbooks cut resolution time 12%',
  mentor: 'Mentored a team of 4',
};
const STOP_NAMES = ['cloud', 'sysadmin', 'support', 'wingify', 'platform'];

let current = null;
export async function mountQuest(containerEl, opts = {}) {
  if (current) unmountQuest();
  current = createQuest(containerEl, opts);
  await current.ready;
  return current.api;
}
export function unmountQuest() { if (current) { current.dispose(); current = null; } }

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function yearFrac(s) {
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s || '');
  if (m) return +m[2] + (MONTHS[m[1].toLowerCase()] || 0) / 12;
  const y = /(\d{4})/.exec(s || '');
  return y ? +y[1] : 2020;
}
const wc = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function createQuest(host, opts) {
  const base = opts.base ?? 'assets/journey/';
  const usePh = !opts.glb; // procedural world unless opts.glb is passed
  const cdn = opts.cdn ?? DEFAULT_CDN;
  const careerUrl = opts.careerUrl ?? 'data/career.json';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
  const navigate = opts.onNavigate || ((h) => { location.hash = h; });
  let disposed = false, live = null, levelsData = [];
  const cleanups = [];
  const on = (t, e, f, o) => { t.addEventListener(e, f, o); cleanups.push(() => t.removeEventListener(e, f, o)); };

  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const btn = (txt, cls, parent) => { const b = el('button', 'q-btn' + (cls ? ' ' + cls : ''), parent, txt); b.type = 'button'; return b; };

  host.classList.add('quest');
  const root = el('div', 'q-root', host);
  const skip = el('a', 'q-skip', root, 'Skip the journey');
  skip.href = '#q-final';
  const sticky = el('div', 'q-sticky', root);
  sticky.setAttribute('role', 'region');
  sticky.setAttribute('aria-label', 'Career quest, an interactive 3D journey');
  const stage = el('div', 'q-stage', sticky);
  const speedFx = el('div', 'q-speed', sticky); speedFx.setAttribute('aria-hidden', 'true');
  el('div', 'q-vignette', sticky).setAttribute('aria-hidden', 'true');
  const loading = el('div', 'q-loading', sticky, 'LOADING WORLD');
  const live_ = el('div', 'q-sr', root); live_.setAttribute('aria-live', 'polite'); live_.setAttribute('role', 'status');

  /* HUD */
  const hud = el('div', 'q-hud', sticky);
  const hudL = el('div', 'q-panel q-hud-l', hud);
  const hLevel = el('div', 'q-mono q-level', hudL, 'LEVEL 1 / 5');
  const hYear = el('div', 'q-year', hudL);
  const hRole = el('div', 'q-role', hudL);
  const xp = el('div', 'q-xp', hudL);
  const xpRow = el('div', 'q-mono q-xp-row', xp);
  el('span', '', xpRow, 'XP');
  const xpVal = el('span', 'q-xp-val', xpRow, '0.0 YRS');
  const xpBar = el('div', 'q-xp-bar', xp); xpBar.setAttribute('aria-hidden', 'true');
  const xpFill = el('div', 'q-xp-fill', xpBar);
  const mapWrap = el('div', 'q-map', hudL); mapWrap.setAttribute('aria-hidden', 'true');
  const hudR = el('div', 'q-panel q-hud-r', hud);
  el('div', 'q-mono q-badges-t', hudR, 'BADGES');
  const badgeRow = el('div', 'q-badge-row', hudR);
  const toast = el('div', 'q-toast', sticky); toast.setAttribute('aria-hidden', 'true');
  const hint = el('div', 'q-mono q-hint', sticky, 'SCROLL  /  ARROW KEYS  /  SPACE   ·  ESC TO EXIT');
  const card = el('article', 'q-card', sticky);
  const fin = el('section', 'q-final', sticky); fin.id = 'q-final';
  fin.setAttribute('aria-label', 'Journey complete');
  const exitBtn = btn('Exit', 'q-exit', sticky); exitBtn.setAttribute('aria-label', 'Exit the journey');
  const statics = el('div', 'q-static', root);

  /* ---------- career ---------- */
  let roles = [];
  async function loadCareer() {
    try {
      const r = await fetch(careerUrl); const j = await r.json();
      const arr = (Array.isArray(j) ? j : j.roles) || [];
      roles = arr.slice().sort((a, b) => yearFrac(a.start) - yearFrac(b.start)).slice(0, 5);
    } catch (e) { roles = []; }
  }
  function buildCardContent(c, role, idx, typedHeadline) {
    c.textContent = '';
    const top = el('div', 'q-mono q-card-k', c, `LEVEL ${idx + 1} / 5  ·  ${yearOf(role)} – ${endOf(role)}`);
    const co = el('p', 'q-company', c, role.company || '');
    if (role.industry) { const tg = document.createElement('span'); tg.className = 'ind ' + (/product/i.test(role.industry) ? 'prod' : 'svc'); tg.textContent = role.industry; co.appendChild(tg); if (role.sector) { const sc = document.createElement('span'); sc.className = 'sector'; sc.textContent = role.sector; co.appendChild(sc); } }
    el('h3', 'q-card-title', c, role.title || '');
    const hd = el('p', 'q-headline', c, typedHeadline ? '' : role.headline || '');
    if (role.impact) {
      const im = el('div', 'q-impact', c);
      el('span', 'q-impact-v', im, role.impact.value);
      el('span', 'q-impact-l', im, role.impact.label);
    }
    const ul = el('ul', 'q-bul', c);
    (role.quest && role.quest.length ? role.quest : (role.highlights || []).slice(0, 3)).forEach((h) => el('li', '', ul, h));
    const chips = el('div', 'q-chips', c);
    (role.stack || []).slice(0, 5).forEach((s) => el('span', 'q-chip', chips, s));
    const more = el('button', 'q-more', c, 'see more'); more.type = 'button'; more.setAttribute('aria-label', 'See more about ' + (role.company || 'this role') + ' in the career story');
    more.onclick = (e) => { e.stopPropagation(); if (opts.onMore) opts.onMore(role); else navigate('#/career'); };
    top.setAttribute('aria-hidden', 'false');
    return hd;
  }
  const yearOf = (r) => Math.floor(yearFrac(r.start));
  const endOf = (r) => (/present/i.test(r.end || '') ? 'Now' : Math.floor(yearFrac(r.end)));

  function buildStatic() {
    statics.textContent = '';
    el('h2', 'q-static-h', statics, 'Career Quest');
    const ol = el('ol', 'q-static-list', statics);
    roles.forEach((r, i) => buildCardContent(el('li', 'q-card q-card-static', ol), r, i, false));
    buildFinal(el('div', 'q-final q-final-static', statics));
  }
  function buildFinal(f) {
    f.textContent = '';
    el('p', 'q-mono q-final-k', f, 'QUEST COMPLETE');
    el('h2', 'q-final-t', f, 'You made it');
    const st = el('ul', 'q-stats', f);
    [['6+', 'years of experience'], ['5', 'roles, one path'], ['400 req/s', 'p95 under 50 ms']].forEach(([v, l]) => {
      const li = el('li', '', st); el('b', '', li, v); el('span', '', li, l);
    });
    const cur = roles[roles.length - 1];
    if (cur && cur.levels && cur.levels.length) {
      const lv = el('div', 'q-final-lv', f);
      el('p', 'q-mono q-final-lk', lv, 'WHAT I RUN IN PRODUCTION');
      const cp = el('div', 'q-chips', lv);
      cur.levels.forEach((l) => el('span', 'q-chip', cp, `${l.level} · ${(l.items || []).length}`));
      const sm = el('button', 'q-more', lv, 'see the full story'); sm.type = 'button';
      sm.onclick = () => { if (opts.onMore) opts.onMore(cur); else navigate('#/career'); };
    }
    const row = el('div', 'q-final-btns', f);
    const a = el('a', 'q-btn q-primary', row, 'Connect on LinkedIn'); a.href = LINKEDIN; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const b = btn('See the work', '', row); b.onclick = () => navigate('#/projects');
  }

  function goStatic(why) {
    host.classList.add('is-static'); host.classList.remove('is-live');
    host.style.height = '';
    if (!statics.childElementCount) buildStatic();
    if (why) console.warn('[quest] static fallback:', why);
  }

  /* ---------- boot ---------- */
  const api = {
    goTo: (i) => live && live.goTo(i), setProgress: (p) => live && live.setProgress(p),
    isLive: () => !!live, stats: () => live && live.stats(), unmount: unmountQuest,
  };
  const ready = (async () => {
    await loadCareer();
    if (disposed) return;
    if (!roles.length) { host.classList.add('is-static'); statics.textContent = 'Career data unavailable.'; return; }
    buildStatic();
    if (reduce) return goStatic();
    try {
      host.style.setProperty('--q-len', (opts.height || 500) + 'vh');
      live = await buildLive();
      if (disposed) { live.dispose(); live = null; return; }
      host.classList.add('is-live');
      loading.remove();
    } catch (err) { live = null; goStatic(err); }
  })();

  function dispose() {
    disposed = true; cleanups.forEach((f) => f());
    if (live) live.dispose();
    root.remove(); host.classList.remove('quest', 'is-live', 'is-static'); host.style.removeProperty('--q-len');
  }

  /* ---------- live ---------- */
  async function buildLive() {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no WebGL');
    ensureImportMap(cdn);
    const T = await import(/* @vite-ignore */ cdn + 'build/three.module.js');
    const J = cdn + 'examples/jsm/';
    const imp = (p) => import(/* @vite-ignore */ J + p);
    const [gl, ec, rp, ub, op] = await Promise.all([
      usePh ? Promise.resolve({}) : imp('loaders/GLTFLoader.js'),
      imp('postprocessing/EffectComposer.js'), imp('postprocessing/RenderPass.js'),
      imp('postprocessing/UnrealBloomPass.js'), imp('postprocessing/OutputPass.js'),
    ]);
    const { EffectComposer } = ec, { RenderPass } = rp, { UnrealBloomPass } = ub, { OutputPass } = op;
    if (disposed) throw new Error('unmounted');

    /* world data */
    const getJSON = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); };
    let model, levels, pathPts, badges;
    if (usePh) {
      ({ model, levels, pathPts, badges } = buildPlaceholder(T));
    } else {
      const loader = new gl.GLTFLoader();
      try { const { DRACOLoader } = await imp('loaders/DRACOLoader.js'); const d = new DRACOLoader(); d.setDecoderPath(DRACO_PATH); loader.setDRACOLoader(d); } catch (e) { /* optional */ }
      const [gltf, lv, pj, bj] = await Promise.all([
        new Promise((res, rej) => loader.load(base + 'journey.glb', res, undefined, rej)),
        getJSON('levels.json'), getJSON('path.json'), getJSON('badges.json'),
      ]);
      model = gltf.scene; levels = lv; pathPts = pj; badges = bj;
    }
    if (disposed) throw new Error('unmounted');
    levels = levels.slice().sort((a, b) => a.order - b.order);
    levelsData = levels;
    const vec = (a) => (Array.isArray(a) ? new T.Vector3(a[0], a[1], a[2]) : new T.Vector3(a.x, a.y, a.z));

    /* path (flat typed array, no per-frame allocation) */
    const NP = pathPts.length;
    const P = new Float32Array(NP * 3);
    const bb = new T.Box3();
    pathPts.forEach((p, i) => { P[i * 3] = p[0]; P[i * 3 + 1] = p[1]; P[i * 3 + 2] = p[2]; bb.expandByPoint(vec(p)); });
    const S = Math.max(bb.getSize(new T.Vector3()).length(), 1);
    function pathAt(u, out) {
      const f = clamp(u, 0, 1) * (NP - 1), i = Math.min(Math.floor(f), NP - 2), t = f - i, o = i * 3;
      return out.set(P[o] + (P[o + 3] - P[o]) * t, P[o + 1] + (P[o + 4] - P[o + 1]) * t, P[o + 2] + (P[o + 5] - P[o + 2]) * t);
    }
    const nearestU = (v) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < NP; i++) { const dx = P[i * 3] - v.x, dy = P[i * 3 + 1] - v.y, dz = P[i * 3 + 2] - v.z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
      return best / (NP - 1);
    };

    /* renderer & scene */
    const canvas = document.createElement('canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    stage.appendChild(canvas);
    const scene = new T.Scene();
    scene.background = gradientTexture(T);
    scene.fog = new T.FogExp2(0x202124, 1.1 / S);
    scene.add(model);
    const camera = new T.PerspectiveCamera(52, 1, S * 0.002, S * 4);
    scene.add(new T.HemisphereLight(0xffffff, 0x5f6368, 1.3));
    const sun = new T.DirectionalLight(0xffffff, 1.7); sun.position.set(0.5, 1, 0.6).multiplyScalar(S);
    scene.add(sun, new T.AmbientLight(0xffffff, 0.45));
    model.updateMatrixWorld(true);

    const ACCENT = new T.Color(ACCENT_HEX);
    const tmpB = new T.Box3(), tmpS = new T.Sphere();
    const find = (pred) => { let r = null; model.traverse((o) => { if (!r && o.name && pred(o.name)) r = o; }); return r; };

    /* levels */
    const L = levels.map((lv, i) => {
      const obj = find((n) => n.startsWith(`level_${lv.order}_`)) || find((n) => n === lv.id);
      const pos = lv.position ? vec(lv.position) : (obj ? obj.getWorldPosition(new T.Vector3()) : new T.Vector3());
      let r = S * 0.04;
      if (obj) { tmpB.setFromObject(obj).getBoundingSphere(tmpS); r = Math.max(tmpS.radius, S * 0.01); }
      const off = lv.cameraOffset ? vec(lv.cameraOffset) : new T.Vector3(r * 3, r * 1.6, r * 3.4);
      const mats = [], baseE = [], baseI = [];
      if (obj) obj.traverse((m) => {
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        for (const mt of [].concat(m.material)) if (mt.emissive) { mats.push(mt); baseE.push(mt.emissive.clone()); baseI.push(mt.emissiveIntensity == null ? 1 : mt.emissiveIntensity); }
      });
      return { lv, obj, pos, r, off, mats, baseE, baseI, y0: obj ? obj.position.y : 0, glow: 0, u: nearestU(pos), side: i % 2 === 0 ? -1 : 1, beam: null, ring: null };
    });
    const summitObj = find((n) => n === 'goal_summit' || n.startsWith('goal_summit'));
    const summitPos = summitObj ? summitObj.getWorldPosition(new T.Vector3()) : pathAt(1, new T.Vector3());
    let sr = S * 0.06; if (summitObj) { tmpB.setFromObject(summitObj).getBoundingSphere(tmpS); sr = Math.max(tmpS.radius, S * 0.02); }
    const summitFrame = new T.Vector3(0.5, 0.35, 0.9).normalize().multiplyScalar(sr * 4.2).add(summitPos);

    /* stops: 5 levels + summit, scroll warp with dwell plateaus */
    const stopsU = L.map((l) => l.u); stopsU.push(1);
    for (let i = 1; i < stopsU.length; i++) if (stopsU[i] < stopsU[i - 1]) stopsU[i] = stopsU[i - 1];
    const NS = stopsU.length;
    const dwell = stopsU.map((_, i) => (i === NS - 1 ? SUMMIT_DWELL : LEVEL_DWELL));
    const travelTotal = 1 - dwell.reduce((a, b) => a + b, 0);
    const gaps = stopsU.map((u, i) => Math.max(u - (i ? stopsU[i - 1] : 0), 0.02));
    const gsum = gaps.reduce((a, b) => a + b, 0);
    const pT0 = [], pS0 = [], pE0 = [];
    { let c = 0; for (let i = 0; i < NS; i++) { pT0[i] = c; c += (gaps[i] / gsum) * travelTotal; pS0[i] = c; c += dwell[i]; pE0[i] = c; } }
    function warp(p) {
      for (let i = 0; i < NS; i++) {
        if (p < pS0[i]) { const t = (p - pT0[i]) / Math.max(pS0[i] - pT0[i], 1e-6); const s = smooth(0, 1, t); const a = i ? stopsU[i - 1] : 0; return a + (stopsU[i] - a) * s; }
        if (p <= pE0[i]) return stopsU[i];
      }
      return 1;
    }
    const distToStop = (p, i) => (p < pS0[i] ? pS0[i] - p : p > pE0[i] ? p - pE0[i] : 0);
    const stopMid = (i) => (pS0[i] + pE0[i]) / 2;

    /* beacons */
    L.forEach((l) => {
      const mat = (o) => new T.MeshBasicMaterial({ color: ACCENT_HEX, transparent: true, opacity: o, blending: T.AdditiveBlending, depthWrite: false });
      l.beam = new T.Mesh(new T.CylinderGeometry(l.r * 0.03, l.r * 0.07, l.r * 5, 14, 1, true), mat(0.1));
      l.beam.position.copy(l.pos); l.beam.position.y += l.r * 2.6;
      l.ring = new T.Mesh(new T.TorusGeometry(l.r * 1.05, l.r * 0.025, 6, 64), mat(0.3));
      l.ring.rotation.x = Math.PI / 2; l.ring.position.copy(l.pos); l.ring.position.y += l.r * 0.15;
      scene.add(l.beam, l.ring);
    });

    /* trail */
    const TUB = 260, RAD = 5;
    const curve = new T.CatmullRomCurve3(pathPts.map(vec));
    const tubeGeo = new T.TubeGeometry(curve, TUB, S * 0.0022, RAD, false);
    const trailBase = new T.Mesh(tubeGeo, new T.MeshBasicMaterial({ color: 0x4285f4, transparent: true, opacity: 0.25, fog: false }));
    const trailGeo = new T.TubeGeometry(curve, TUB, S * 0.0038, RAD, false);
    const trail = new T.Mesh(trailGeo, new T.MeshBasicMaterial({ color: ACCENT_HEX, fog: false, toneMapped: false }));
    scene.add(trailBase, trail);
    trailGeo.setDrawRange(0, 0);
    const idxPer = RAD * 6;

    /* dust / stars */
    const ND = 900, dp = new Float32Array(ND * 3);
    { const c = bb.getCenter(new T.Vector3()); for (let i = 0; i < ND; i++) { dp[i * 3] = c.x + (Math.random() - 0.5) * S * 1.4; dp[i * 3 + 1] = c.y + (Math.random() - 0.3) * S * 0.9; dp[i * 3 + 2] = c.z + (Math.random() - 0.5) * S * 1.4; } }
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(dp, 3));
    const dust = new T.Points(dg, new T.PointsMaterial({ color: 0xe8eaed, size: S * 0.004, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    dust.frustumCulled = false; scene.add(dust);

    /* badges */
    const B = badges.map((b) => {
      const key = String(b.id).replace(/^badge_/, '');
      const obj = find((n) => n === 'badge_' + key || n === b.id) || null;
      const pos = b.position ? vec(b.position) : (obj ? obj.getWorldPosition(new T.Vector3()) : new T.Vector3());
      return { b, key, obj, pos, u: nearestU(pos), y0: obj ? obj.position.y : 0, unlocked: false, label: DEFAULT_BADGES[key] || b.label || b.name, el: null, pop: 0 };
    }).sort((a, b) => a.u - b.u);
    B.forEach((bd) => {
      const s = el('div', 'q-badge is-locked', badgeRow); s.title = bd.label; s.setAttribute('aria-label', bd.label + ' (locked)');
      el('span', 'q-badge-ico', s, '★'); el('span', 'q-badge-n', s, bd.label);
      bd.el = s;
    });
    const NB = 36, bp = new Float32Array(NB * 3), bdir = new Float32Array(NB * 3);
    for (let i = 0; i < NB; i++) { const th = Math.random() * 6.2832, ph = Math.acos(2 * Math.random() - 1), ring = i < 18; bdir[i * 3] = Math.sin(ph) * Math.cos(th) * (ring ? 1 : 0.6); bdir[i * 3 + 1] = ring ? 0.05 : Math.cos(ph) * 0.6; bdir[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * (ring ? 1 : 0.6); }
    const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.BufferAttribute(bp, 3));
    const bm = new T.PointsMaterial({ color: ACCENT_HEX, size: S * 0.012, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    const burst = new T.Points(bg, bm); burst.frustumCulled = false; burst.visible = false; scene.add(burst);
    const burstC = new T.Vector3(); let burstT = 9;

    /* post */
    const composer = new EffectComposer(renderer);
    const bloom = new UnrealBloomPass(new T.Vector2(512, 512), 0.8, 0.7, 0.8);
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass());

    /* minimap */
    const SVGNS = 'http://www.w3.org/2000/svg';
    const sv = document.createElementNS(SVGNS, 'svg'); sv.setAttribute('viewBox', '0 0 100 70'); mapWrap.appendChild(sv);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < NP; i++) { minx = Math.min(minx, P[i * 3]); maxx = Math.max(maxx, P[i * 3]); minz = Math.min(minz, P[i * 3 + 2]); maxz = Math.max(maxz, P[i * 3 + 2]); }
    const sc = Math.min(90 / Math.max(maxx - minx, 1e-3), 60 / Math.max(maxz - minz, 1e-3));
    const mx = (x) => 5 + (x - minx) * sc + (90 - (maxx - minx) * sc) / 2, mz = (z) => 5 + (z - minz) * sc + (60 - (maxz - minz) * sc) / 2;
    const ptsStr = []; for (let i = 0; i < NP; i += 2) ptsStr.push(mx(P[i * 3]).toFixed(1) + ',' + mz(P[i * 3 + 2]).toFixed(1));
    const mk = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); sv.appendChild(n); return n; };
    mk('polyline', { points: ptsStr.join(' '), fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
    const mapProg = mk('polyline', { points: ptsStr.join(' '), fill: 'none', stroke: '#8ab4f8', 'stroke-width': 1.8, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 });
    const cps = L.map((l, i) => mk('circle', { cx: mx(l.pos.x).toFixed(1), cy: mz(l.pos.z).toFixed(1), r: 2.2, fill: '#292a2d', stroke: '#fff', 'stroke-width': 0.8 }));
    mk('path', { d: `M${mx(summitPos.x).toFixed(1)} ${(mz(summitPos.z) - 4).toFixed(1)} l3 2 -3 2z`, fill: '#8ab4f8' });
    const dot = mk('circle', { r: 2.6, fill: '#8ab4f8', stroke: '#fff', 'stroke-width': 0.8, cx: 0, cy: 0 });

    /* temps */
    const v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), v4 = new T.Vector3(), camP = new T.Vector3(), camL = new T.Vector3();
    const startCam = true;
    const fixed = typeof opts.progress === 'number' ? clamp(opts.progress, 0, 1) : null;
    let pT = fixed ?? 0, pS = pT, pPrev = pT, spd = 0, roll = 0, fovCur = 52;
    let running = false, inView = true, raf = 0, last = 0, time = 0, frames = 0, ema = 0.016, slow = 0, level = isMobile ? 1 : 2;
    let curLevel = -1, cardStop = -2, typeT0 = 0, typeEl = null, typeText = '', typeN = -1, first = true, toastT = 0, lastDot = -1, lastXp = -1, lastU = 0;
    let span = 1, sticky0 = 0;
    const times = roles.map((r) => yearFrac(r.start));
    const t0 = times[0] ?? 2020, tEnd = Math.max(2026.9, (times[times.length - 1] || 2025) + 1);
    const yearsAt = (u) => {
      let i = 0; while (i < L.length - 1 && L[i + 1].u <= u) i++;
      const a = L[i].u, b = i + 1 < L.length ? L[i + 1].u : 1, ya = times[i] ?? t0, yb = i + 1 < L.length ? (times[i + 1] ?? tEnd) : tEnd;
      return clamp(ya + (yb - ya) * clamp((u - a) / Math.max(b - a, 1e-4), 0, 1) - t0, 0, tEnd - t0);
    };

    function measure() { span = Math.max(host.offsetHeight - innerHeight, 1); }
    function readScroll() { if (fixed != null) return; const r = host.getBoundingClientRect(); pT = clamp(-r.top / span, 0, 1); inQuest = r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5; }
    let inQuest = fixed != null;
    on(window, 'scroll', readScroll, { passive: true });
    function resize() {
      const w = Math.max(sticky.clientWidth, 2), h = Math.max(sticky.clientHeight, 2);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false); composer.setSize(w, h); measure(); readScroll();
    }
    const ro = new ResizeObserver(resize); ro.observe(sticky);

    function applyLevel(l) {
      level = l;
      const dpr = l === 0 ? 1 : l === 1 ? Math.min(devicePixelRatio || 1, 1.5) : Math.min(devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr);
      composer.setSize(sticky.clientWidth || 2, sticky.clientHeight || 2);
      bloom.enabled = l > 0; bloom.strength = (isMobile ? 0.55 : 0.8) * (l === 1 ? 0.7 : 1);
    }
    applyLevel(level); resize();

    /* keyboard */
    const NEXT = ['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'd', 'D', 's', 'S', 'w', 'W'], PREV = ['ArrowUp', 'ArrowLeft', 'PageUp', 'a', 'A'];
    // note: W/D/S are "forward" keys here as in games: W/D/Space forward, S/A back
    const FWD = ['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'd', 'D', 'w', 'W'], BACK = ['ArrowUp', 'ArrowLeft', 'PageUp', 'a', 'A', 's', 'S'];
    function scrollToP(p) {
      if (fixed != null) { pT = p; return; }
      const top = host.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top + p * span, behavior: reduce ? 'auto' : 'smooth' });
    }
    function goTo(i) { scrollToP(stopMid(clamp(i, 0, NS - 1))); }
    function nearestStop() { let b = 0, bd = 9; for (let i = 0; i < NS; i++) { const d = Math.abs(pT - stopMid(i)); if (d < bd) { bd = d; b = i; } } return b; }
    on(document, 'keydown', (e) => {
      if (!inQuest || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { exit(); return; }
      const t = e.target; if (t && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && (e.key === ' ' || e.key === 'Enter')) return;
      const f = FWD.includes(e.key), b = BACK.includes(e.key);
      if (!f && !b) return;
      e.preventDefault();
      let i = nearestStop();
      if (f) i = pT < stopMid(i) - 0.004 ? i : i + 1; else i = pT > stopMid(i) + 0.004 ? i : i - 1;
      if (i < 0) { exit(); return; }
      goTo(i);
    });
    function exit() {
      if (opts.onExit) opts.onExit();
      const top = host.getBoundingClientRect().top + scrollY + host.offsetHeight;
      scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' }); if (document.activeElement) document.activeElement.blur();
    }
    exitBtn.onclick = exit;
    skip.onclick = (e) => { e.preventDefault(); goTo(NS - 1); setTimeout(() => { const a = fin.querySelector('a,button'); if (a) a.focus({ preventScroll: true }); }, 900); };
    buildFinal(fin);

    /* UI helpers */
    function showCard(i) {
      if (i === cardStop) return;
      cardStop = i;
      card.classList.remove('is-in', 'is-left', 'is-right');
      fin.classList.toggle('is-in', i === NS - 1);
      if (i < 0 || i >= L.length) { typeEl = null; return; }
      typeEl = buildCardContent(card, roles[Math.min(i, roles.length - 1)], i, true);
      typeText = roles[Math.min(i, roles.length - 1)].headline || ''; typeN = 0; typeT0 = time;
      card.classList.add(L[i].side < 0 ? 'is-left' : 'is-right');
      void card.offsetWidth; card.classList.add('is-in');
    }
    function setLevel(i) {
      if (i === curLevel) return; curLevel = i;
      const r = roles[Math.min(i, roles.length - 1)], n = Math.min(i, L.length - 1);
      hLevel.textContent = `LEVEL ${n + 1} / ${L.length}`;
      hYear.textContent = `${yearOf(r)} – ${endOf(r)}`;
      hRole.textContent = r.title;
      live_.textContent = `Level ${n + 1} of ${L.length}: ${r.title} at ${r.company}, ${yearOf(r)}. ${r.headline || ''}`;
      cps.forEach((c, k) => c.setAttribute('fill', k <= n ? '#8ab4f8' : '#292a2d'));
    }
    function unlock(bd, silent) {
      bd.unlocked = true; bd.el.classList.remove('is-locked'); bd.el.setAttribute('aria-label', bd.label + ' (unlocked)');
      if (silent) return;
      bd.el.classList.remove('pop'); void bd.el.offsetWidth; bd.el.classList.add('pop');
      toast.textContent = ''; el('span', 'q-mono', toast, 'ACHIEVEMENT UNLOCKED'); el('b', '', toast, bd.label);
      toast.classList.remove('is-on'); void toast.offsetWidth; toast.classList.add('is-on'); toastT = 3.2;
      live_.textContent = 'Achievement unlocked: ' + bd.label;
      burstC.copy(bd.pos); burstT = 0; burst.visible = true;
    }

    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1); last = now; time += dt;
      ema = ema * 0.95 + dt * 0.05; frames++;
      if (frames > 90 && level > 0) { slow = ema > 0.034 ? slow + 1 : 0; if (slow > 90) { applyLevel(level - 1); slow = 0; ema = 0.016; } }

      /* smoothed progress */
      if (first) { pS = pT; pPrev = pT; } else pS += (pT - pS) * (1 - Math.exp(-dt * (reduce ? 20 : 4.2)));
      const vel = Math.abs(pS - pPrev) / Math.max(dt, 1e-3); pPrev = pS;
      spd += (clamp(vel / 0.25, 0, 1) - spd) * Math.min(1, dt * 5);
      const u = warp(pS);
      lastU = u;

      /* camera: cruise along path, blend into level frame near stops */
      pathAt(u, v1); pathAt(u + 0.02, v2); v3.copy(v2).sub(v1).normalize();
      pathAt(u + 0.05, v4);
      camP.copy(v1).addScaledVector(v3, -S * 0.055); camP.y += S * 0.032;
      camL.copy(v2).lerp(v4, 0.5);
      let k = 0, kd = 9; for (let i = 0; i < NS; i++) { const d = distToStop(pS, i); if (d < kd) { kd = d; k = i; } }
      const w = 1 - smooth(0, 0.05, kd);
      if (w > 0) {
        const fp = k < L.length ? v1.copy(L[k].pos).add(L[k].off) : summitFrame;
        const fl = k < L.length ? L[k].pos : summitPos;
        camP.lerp(fp, w); camL.lerp(fl, w);
        // offset the focal island to the side opposite the card
        v2.copy(camL).sub(camP); const dist = v2.length(); v2.normalize();
        v3.set(0, 1, 0).cross(v2).normalize();            // camera-left axis
        const side = k < L.length ? L[k].side : 0;
        if (k === NS - 1) camL.y -= dist * (isMobile ? 0.3 : 0.2) * w;
        else if (isMobile) camL.y -= dist * 0.16 * w; else camL.addScaledVector(v3, -side * dist * 0.3 * w);
      }
      camera.position.copy(camP); camera.lookAt(camL);
      // roll from path curvature, FOV push on speed
      pathAt(u + 0.01, v1); pathAt(u + 0.06, v2); pathAt(u, v4);
      v2.sub(v1).normalize(); v1.sub(v4).normalize();
      const curv = v1.x * v2.z - v1.z * v2.x;
      roll += (clamp(curv * 6, -0.12, 0.12) * spd - roll) * Math.min(1, dt * 3);
      camera.rotateZ(roll);
      const fov = 52 + spd * 14 - w * 4;
      if (Math.abs(fov - fovCur) > 0.02) { fovCur = fov; camera.fov = fov; camera.updateProjectionMatrix(); }

      /* world animation */
      dust.rotation.y = time * 0.01;
      for (let i = 0; i < L.length; i++) {
        const l = L[i], act = i === k && w > 0.5 ? 1 : 0;
        if (l.obj) l.obj.position.y = l.y0 + Math.sin(time * 0.9 + i * 1.7) * l.r * 0.06;
        l.glow += (act - l.glow) * Math.min(1, dt * 5);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
        l.beam.material.opacity = 0.08 + l.glow * (0.2 + 0.15 * pulse);
        l.ring.material.opacity = 0.25 + l.glow * 0.4 * pulse;
        const rs = 1 + l.glow * (0.08 + 0.14 * pulse); l.ring.scale.set(rs, rs, rs);
        for (let m = 0; m < l.mats.length; m++) { const mt = l.mats[m]; mt.emissive.copy(l.baseE[m]).lerp(ACCENT, l.glow * 0.5); mt.emissiveIntensity = l.baseI[m] + l.glow * (0.6 + 0.5 * pulse); }
      }
      trailGeo.setDrawRange(0, Math.floor(u * TUB) * idxPer);
      for (let i = 0; i < B.length; i++) {
        const bd = B[i];
        if (bd.obj) { bd.obj.rotation.y = time * 1.2; bd.obj.position.y = bd.y0 + Math.sin(time * 1.6 + i) * S * 0.003; }
        const should = u >= bd.u - 0.004;
        if (should && !bd.unlocked) unlock(bd, first || Math.abs(u - bd.u) > 0.1);
        else if (!should && bd.unlocked) { bd.unlocked = false; bd.el.classList.add('is-locked'); bd.el.classList.remove('pop'); bd.el.setAttribute('aria-label', bd.label + ' (locked)'); }
      }
      if (burstT < 1.3) {
        burstT += dt; const e = easeOut(Math.min(burstT / 1.2, 1)), rr = S * 0.05 * e;
        for (let i = 0; i < NB; i++) { bp[i * 3] = burstC.x + bdir[i * 3] * rr; bp[i * 3 + 1] = burstC.y + bdir[i * 3 + 1] * rr; bp[i * 3 + 2] = burstC.z + bdir[i * 3 + 2] * rr; }
        bg.attributes.position.needsUpdate = true; bm.opacity = 1 - clamp(burstT / 1.3, 0, 1);
        if (burstT >= 1.3) burst.visible = false;
      }
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.classList.remove('is-on'); }

      /* HUD */
      let near = 0, nd = 9; for (let i = 0; i < L.length; i++) { const d = Math.abs(pS - (pS0[i] + pE0[i]) / 2); if (d < nd) { nd = d; near = i; } }
      setLevel(pS > stopMid(L.length - 1) + (stopMid(NS - 1) - stopMid(L.length - 1)) * 0.5 ? L.length - 1 : near);
      const cs = distToStop(pS, k) < 0.012 ? k : -1;
      showCard(cs);
      if (typeEl && typeN < typeText.length) {
        const n = Math.min(typeText.length, Math.floor((time - typeT0) * 55));
        if (n !== typeN) { typeN = n; typeEl.textContent = typeText.slice(0, n) + (n < typeText.length ? '▌' : ''); }
      }
      if (Math.abs(u - lastDot) > 0.0015) {
        lastDot = u; pathAt(u, v1);
        dot.setAttribute('cx', mx(v1.x).toFixed(1)); dot.setAttribute('cy', mz(v1.z).toFixed(1));
        mapProg.setAttribute('stroke-dashoffset', (1 - u).toFixed(3));
        const yrs = yearsAt(u);
        xpFill.style.transform = `scaleX(${clamp(yrs / 6, 0, 1).toFixed(3)})`;
        xpVal.textContent = (u > 0.995 || yrs >= 6 ? '6+' : yrs.toFixed(1)) + ' YRS';
        hint.classList.toggle('is-off', pS > 0.02);
      }
      speedFx.style.opacity = (spd > 0.25 ? (spd - 0.25) * 0.9 : 0).toFixed(2);
      first = false;
      if (bloom.enabled) composer.render(); else renderer.render(scene, camera);
    }

    function setRunning() {
      const r = inView && !document.hidden && !disposed; if (r === running) return; running = r;
      if (r) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; setRunning(); });
    io.observe(host);
    on(document, 'visibilitychange', setRunning);
    readScroll(); setRunning();

    function dispose() {
      running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { for (const key in m) if (m[key] && m[key].isTexture) m[key].dispose(); m.dispose(); }); });
      if (scene.background && scene.background.dispose) scene.background.dispose();
      composer.passes.forEach((p) => { if (p.dispose) p.dispose(); }); if (composer.dispose) composer.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    }
    return {
      goTo, dispose, setProgress: (p) => { if (fixed != null) pT = clamp(p, 0, 1); else scrollToP(clamp(p, 0, 1)); },
      stats: () => ({ levels: L.length, badges: B.length, pathPts: NP, stops: NS, level, u: lastU, running, levelMissingObjs: L.filter((l) => !l.obj).length }),
    };
  }

  return { ready, api, dispose };
}

/* ---------- helpers ---------- */
function ensureImportMap(cdn) {
  if (ensureImportMap.done) return; ensureImportMap.done = true;
  for (const m of document.querySelectorAll('script[type="importmap"]')) if (m.textContent.includes('"three"')) return;
  const s = document.createElement('script'); s.type = 'importmap';
  s.textContent = JSON.stringify({ imports: { three: cdn + 'build/three.module.js' } }); document.head.appendChild(s);
}
function gradientTexture(T) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#202124'); gr.addColorStop(1, '#292a2d');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

/* Primitive stand-in for journey.glb + json (same names and schema). */
function buildPlaceholder(T) {
  const g = new T.Group();
  const lp = [[0, 0, 0], [30, 4, -40], [-10, 10, -85], [35, 18, -130], [0, 28, -175]];
  const summit = [-5, 45, -225];
  const names = ['cloud', 'sysadmin', 'support', 'wingify', 'platform'];
  const curve = new T.CatmullRomCurve3([...lp, summit].map((p) => new T.Vector3(...p)));
  const pathPts = curve.getPoints(119).map((v) => [v.x, v.y, v.z]);
  const mat = (c, e) => new T.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, emissive: e, emissiveIntensity: 0.6 });
  const levels = lp.map((p, i) => {
    const grp = new T.Group(); grp.name = `level_${i + 1}_${names[i]}`; grp.position.set(...p);
    const top = new T.Mesh(new T.CylinderGeometry(7, 5.5, 2, 24), mat(0x4285f4, 0x0b2a66)); top.name = 'top';
    const rock = new T.Mesh(new T.ConeGeometry(5.5, 6, 24), mat(0x3c4043, 0x101113)); rock.position.y = -4; rock.rotation.x = Math.PI;
    const tower = new T.Mesh(new T.BoxGeometry(2, 3 + i, 2), mat(0xfbbc04, 0x4a3600)); tower.position.y = 2.5 + i / 2;
    grp.add(top, rock, tower); g.add(grp);
    const side = i % 2 === 0 ? 1 : -1;
    return { id: `level_${i + 1}_${names[i]}`, name: names[i], order: i + 1, year: 2020 + i, label: names[i], position: p, cameraOffset: [side * 12, 7, 24] };
  });
  const sm = new T.Mesh(new T.ConeGeometry(8, 16, 6), mat(0xffffff, 0x5f6368)); sm.name = 'goal_summit'; sm.position.set(...summit); g.add(sm);
  const badgeDefs = [['mentor', 0.46], ['aws', 0.66], ['throughput', 0.8], ['runbook', 0.9]];
  const badges = badgeDefs.map(([id, u]) => {
    const v = curve.getPoint(u); v.x += 4; v.y += 3;
    const o = new T.Mesh(new T.IcosahedronGeometry(1.6, 1), mat(0x34a853, 0x0f4a22)); o.name = 'badge_' + id; o.position.copy(v); g.add(o);
    return { id, name: id, position: [v.x, v.y, v.z], levelId: 'level_5_platform', label: id };
  });
  const road = new T.Mesh(new T.TubeGeometry(curve, 120, 0.5, 6, false), mat(0x4285f4, 0x174ea6)); road.name = 'path_main'; g.add(road);
  return { model: g, levels, pathPts, badges };
}
