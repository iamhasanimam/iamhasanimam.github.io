/*
 * hero3d/hero.js - cinematic, playable architecture hero.
 *   import { mountHero, unmountHero } from './hero3d/hero.js';
 *   const api = await mountHero(el, { base: 'assets/hero/', onOpenTech(slug) {...} });
 * Three.js is lazy-loaded from unpkg only when the live scene is needed.
 * No per-frame allocations: all temp vectors are preallocated.
 */

const THREE_VERSION = '0.160.0';
const DEFAULT_CDN = `https://unpkg.com/three@${THREE_VERSION}/`;
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const ACCENT_HEX = 0x4285f4;
const GOOGLE = { blue: 0x4285f4, red: 0xea4335, yellow: 0xfbbc04, green: 0x34a853 };

const DEFAULT_HOTSPOTS = [
  ['node_client', 'Client', 'client', 'Clients and edge traffic', 'Requests enter the platform from browsers, mobile apps and partner systems.'],
  ['node_slb', 'Load balancer', 'load-balancer', 'Server load balancer', 'A layer 4 entry point that spreads connections across the proxy tier.'],
  ['node_haproxy_a', 'HAProxy A', 'haproxy', 'HAProxy (active)', 'Active reverse proxy holding the virtual IP, terminating TLS and health-checking backends.'],
  ['node_haproxy_b', 'HAProxy B', 'haproxy', 'HAProxy (standby)', 'Standby proxy that takes over the floating address through VRRP when the active node fails.'],
  ['node_nginx', 'NGINX', 'nginx', 'NGINX', 'Static delivery, caching and request shaping in front of the gateway.'],
  ['node_kong', 'Kong', 'kong', 'API gateway', 'Authentication, rate limiting and routing policy applied at one consistent gateway.'],
  ['node_istio', 'Service mesh', 'istio', 'Service mesh', 'mTLS, traffic splitting and retries between services, defined as configuration.'],
  ['node_services', 'Services', 'services', 'Application services', 'Stateless workloads on Kubernetes, scaled and rolled out through GitOps.'],
  ['node_kafka', 'Kafka', 'kafka', 'Event streaming', 'Durable event log decoupling producers from consumers.'],
  ['node_redis', 'Redis', 'redis', 'Cache', 'Low-latency cache and ephemeral state.'],
  ['node_postgresql', 'PostgreSQL', 'postgresql', 'Relational store', 'System of record with replication and tested restores.'],
  ['node_prometheus', 'Prometheus', 'prometheus', 'Metrics', 'Metrics collection and alerting rules driven by SLOs.'],
  ['node_grafana', 'Grafana', 'grafana', 'Dashboards', 'Dashboards that tie metrics, logs and traces together.'],
  ['node_loki', 'Loki', 'loki', 'Logs', 'Cheap, label-indexed log storage queried alongside metrics.'],
].map(([id, name, techSlug, title, summary], i) => ({ id, name, techSlug, title, summary, order: i + 1 }));

/* Fallback topology (node ids without prefix) used when no link_* objects exist. */
const FALLBACK_EDGES = [
  ['client', 'slb'], ['slb', 'haproxy_a'], ['slb', 'haproxy_b'], ['haproxy_a', 'nginx'], ['haproxy_b', 'nginx'],
  ['nginx', 'kong'], ['kong', 'istio'], ['istio', 'services'], ['services', 'kafka'], ['services', 'redis'],
  ['services', 'postgresql'], ['services', 'prometheus'], ['prometheus', 'grafana'], ['services', 'loki'],
];

const strip = (id) => String(id).replace(/^node_/, '');
let current = null;

export async function mountHero(containerEl, opts = {}) {
  if (current) unmountHero();
  current = createHero(containerEl, opts);
  await current.ready;
  return current.api;
}
export function unmountHero() {
  if (current) { current.dispose(); current = null; }
}

function createHero(host, opts) {
  const base = opts.base ?? 'assets/hero/';
  const cdn = opts.cdn ?? DEFAULT_CDN;
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection || {};
  const saveData = !!conn.saveData || /(^|-)2g$|3g/.test(conn.effectiveType || '');
  const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
  const calm = mqReduce || saveData;                 // no autoplay video / auto 3D
    const autoLive = opts.autoLive ?? !calm;

  const usePlaceholder = !opts.glb; // procedural scene by default; GLB only if opts.glb is passed
  let disposed = false;
  let hotspots = [];
  const byId = new Map();
  let selId = null;
  let live = null;
  const cleanups = [];
  const on = (t, e, f, o) => { t.addEventListener(e, f, o); cleanups.push(() => t.removeEventListener(e, f, o)); };

  /* ---------- DOM ---------- */
  host.classList.add('hero3d');
  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const root = el('div', 'h3d-root', host);
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Interactive platform architecture');
  const media = el('div', 'h3d-media', root);
  let video = null; // legacy: no video/poster, procedural scene only
  const stage = el('div', 'h3d-stage', root);
  const vignette = el('div', 'h3d-vignette', root);
  vignette.setAttribute('aria-hidden', 'true');
  const progress = el('div', 'h3d-progress', root);
  progress.setAttribute('aria-hidden', 'true');
  const label = el('div', 'h3d-label', root);
  label.setAttribute('aria-hidden', 'true');
  const caption = el('div', 'h3d-caption', root);
  caption.setAttribute('aria-live', 'polite');
  caption.setAttribute('role', 'status');

  const mkBtn = (txt, parent, cls) => { const b = el('button', 'h3d-btn' + (cls ? ' ' + cls : ''), parent, txt); b.type = 'button'; return b; };
  const bar = el('div', 'h3d-bar', root);
  bar.hidden = true;
  const bTake = mkBtn('Take control', bar, 'h3d-take');
  bTake.setAttribute('aria-pressed', 'false');
  const bTour = mkBtn('Play tour', bar);
  const bFail = mkBtn('Failover', bar); bFail.setAttribute('aria-pressed', 'false');
  const bTraf = mkBtn('Traffic', bar); bTraf.setAttribute('aria-pressed', 'true');
  const qWrap = el('label', 'h3d-quality', bar);
  el('span', 'h3d-sr', qWrap, 'Quality');
  const qSel = el('select', 'h3d-select', qWrap);
  [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']].forEach(([v, t]) => { const o = el('option', '', qSel, t); o.value = v; });
  qSel.value = opts.quality || 'auto';

  const bLoad = mkBtn('Explore in 3D', root, 'h3d-load');
  bLoad.hidden = true;

  // slim chip row under the canvas, inside the host (not overlapping the scene)
  const nav = el('nav', 'h3d-nodes', host);
  nav.setAttribute('aria-label', 'Architecture nodes');
  const chips = el('div', 'h3d-chips', nav);

  const card = el('aside', 'h3d-card', root);
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Node details');
  const cTop = el('div', 'h3d-card-top', card);
  const cPrev = mkBtn('‹', cTop, 'h3d-ico'); cPrev.setAttribute('aria-label', 'Previous node');
  const cCount = el('span', 'h3d-count', cTop);
  const cNext = mkBtn('›', cTop, 'h3d-ico'); cNext.setAttribute('aria-label', 'Next node');
  const cClose = mkBtn('×', cTop, 'h3d-ico h3d-close'); cClose.setAttribute('aria-label', 'Close details');
  const cName = el('p', 'h3d-kicker', card);
  const cTitle = el('h3', 'h3d-title', card);
  const cSum = el('p', 'h3d-sum', card);
  const cLink = el('a', 'h3d-btn h3d-deep', card, 'Open the deep dive');

  /* ---------- hotspots + UI state (independent of WebGL) ---------- */
  async function loadHotspots() {
    hotspots = (opts.hotspots || DEFAULT_HOTSPOTS).slice();
    hotspots.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    hotspots.forEach((h) => byId.set(h.id, h));
    hotspots.forEach((h) => {
      const b = mkBtn(h.name || h.title, chips, 'h3d-chip');
      b.dataset.id = h.id;
      b.addEventListener('click', () => select(h.id, true));
    });
  }

  function select(id, fly) {
    const i = hotspots.findIndex((h) => h.id === id);
    if (i < 0) return;
    const h = hotspots[i];
    selId = id;
    cName.textContent = h.name || '';
    cTitle.textContent = h.title || h.name || '';
    cSum.textContent = h.summary || '';
    cCount.textContent = (i + 1) + ' / ' + hotspots.length;
    cLink.href = '#/tech/' + encodeURIComponent(h.techSlug || strip(h.id));
    card.hidden = false;
    for (const c of chips.children) c.setAttribute('aria-current', c.dataset.id === id ? 'true' : 'false');
    caption.textContent = (h.title || h.name) + '. ' + (h.summary || '');
    if (fly && live) live.focus(id);
  }
  function step(d) {
    const i = hotspots.findIndex((h) => h.id === selId);
    const n = hotspots.length;
    select(hotspots[(((i < 0 ? 0 : i + d) % n) + n) % n].id, true);
  }
  function closeCard() {
    card.hidden = true; selId = null;
    for (const c of chips.children) c.setAttribute('aria-current', 'false');
    if (live) live.overview();
  }
  cPrev.onclick = () => step(-1);
  cNext.onclick = () => step(1);
  cClose.onclick = closeCard;
  cLink.addEventListener('click', (e) => {
    if (typeof opts.onOpenTech === 'function') {
      e.preventDefault();
      const h = hotspots.find((x) => x.id === selId);
      opts.onOpenTech((h && h.techSlug) || strip(selId));
    }
  });
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (live && live.tourOn()) live.stopTour();
    else if (!card.hidden) closeCard();
    else if (live && live.controlTaken()) live.setControl(false);
  });

  /* ---------- live scene ---------- */
  async function startLive() {
    bLoad.hidden = true;
    progress.classList.add('is-on');
    try {
      const l = await buildLive();
      if (disposed) { l.dispose(); return; }
      live = l;
      root.classList.add('is-live');
      bar.hidden = false;
      progress.classList.remove('is-on');
      if (video) setTimeout(() => { if (video) video.pause(); }, 1200);
    } catch (err) {
      console.warn('[hero3d] live scene unavailable', err);
      root.classList.add('is-fallback');
      progress.classList.remove('is-on');
      bLoad.hidden = false; bLoad.textContent = 'Retry 3D';
      live = null;
    }
  }

  async function buildLive() {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no WebGL');
    ensureImportMap(cdn);
    const T = await import(/* @vite-ignore */ cdn + 'build/three.module.js');
    const J = cdn + 'examples/jsm/';
    const imp = (p) => import(/* @vite-ignore */ J + p);
    const [gl, oc, ec, rp, ub, op] = await Promise.all([
      usePlaceholder ? Promise.resolve({}) : imp('loaders/GLTFLoader.js'),
      imp('controls/OrbitControls.js'), imp('postprocessing/EffectComposer.js'), imp('postprocessing/RenderPass.js'),
      imp('postprocessing/UnrealBloomPass.js'), imp('postprocessing/OutputPass.js'),
    ]);
    const { GLTFLoader } = gl, { OrbitControls } = oc, { EffectComposer } = ec, { RenderPass } = rp, { UnrealBloomPass } = ub, { OutputPass } = op;
    if (disposed) throw new Error('unmounted');

    /* model */
    let model;
    if (usePlaceholder) model = buildPlaceholder(T, hotspots);
    else {
      const loader = new GLTFLoader();
      try {
        const { DRACOLoader } = await imp('loaders/DRACOLoader.js');
        const d = new DRACOLoader(); d.setDecoderPath(DRACO_PATH); loader.setDRACOLoader(d);
      } catch (e) { /* optional */ }
      const gltf = await new Promise((res, rej) => loader.load(base + (opts.glb || 'platform.glb'), res,
        (p) => { if (p.total) progress.style.setProperty('--p', (p.loaded / p.total).toFixed(3)); }, rej));
      model = gltf.scene;
    }
    if (disposed) throw new Error('unmounted');

    /* renderer / scene */
    const canvas = document.createElement('canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    stage.appendChild(canvas);
    const scene = new T.Scene();
    scene.background = new T.Color(themeBg());
    scene.add(model);
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 1000);

    const hemi = new T.HemisphereLight(0xffffff, 0x9aa0a6, 1.4);
    const key = new T.DirectionalLight(0xffffff, 1.6);
    const rim = new T.DirectionalLight(0x8ab4f8, 0.5);
    scene.add(hemi, key, rim, new T.AmbientLight(0xffffff, 0.5));
    key.shadow.mapSize.set(1024, 1024);

    model.updateMatrixWorld(true);
    const sphere = new T.Box3().setFromObject(model).getBoundingSphere(new T.Sphere());
    const R = Math.max(sphere.radius, 0.001);
    key.position.copy(sphere.center).addScaledVector(new T.Vector3(0.5, 1, 0.6), R * 2);
    rim.position.copy(sphere.center).addScaledVector(new T.Vector3(-0.8, 0.3, -0.7), R * 2);
    key.target.position.copy(sphere.center); scene.add(key.target);
    const sc = key.shadow.camera;
    sc.left = -R * 1.4; sc.right = R * 1.4; sc.top = R * 1.4; sc.bottom = -R * 1.4; sc.near = 0.1; sc.far = R * 6;
    sc.updateProjectionMatrix();

    /* items: nodes + links, each with cloned materials for individual glow */
    const ACCENT = new T.Color(ACCENT_HEX);
    const tmpBox = new T.Box3(), tmpSph = new T.Sphere();
    const mkItem = (obj) => {
      const it = {
        obj, mats: [], baseE: [], baseI: [], glow: 0, gT: 0, dim: 0, dT: 0, lit: false,
        s0: obj.scale.clone(), c: new T.Vector3(), r: 1, meshes: [], dimmable: false,
      };
      obj.traverse((m) => {
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        for (const mt of [].concat(m.material)) {
          if (!mt.emissive) continue;
          it.mats.push(mt); it.baseE.push(mt.emissive.clone()); it.baseI.push(mt.emissiveIntensity == null ? 1 : mt.emissiveIntensity);
        }
        it.meshes.push(m); m.castShadow = true; m.receiveShadow = true;
      });
      tmpBox.setFromObject(obj); tmpBox.getCenter(it.c); tmpBox.getBoundingSphere(tmpSph);
      it.r = Math.max(tmpSph.radius, R * 0.04);
      return it;
    };
    const nodes = new Map();   // key: id without node_ prefix
    const links = [];
    const pickables = [];
    for (const h of hotspots) {
      const k = strip(h.id);
      const obj = model.getObjectByName('node_' + k) || model.getObjectByName(h.id);
      if (!obj) { console.warn('[hero3d] node missing in GLB:', h.id); continue; }
      const it = mkItem(obj); it.id = h.id; it.k = k;
      it.meshes.forEach((m) => { m.userData.h3d = h.id; pickables.push(m); });
      nodes.set(k, it);
    }
    const nodeKeys = [...nodes.keys()];
    const linkObjs = [];
    model.traverse((o) => { if (o.name && o.name.startsWith('link_')) linkObjs.push(o); });
    for (const o of linkObjs) {
      let p = o.parent, nested = false;
      while (p) { if (p.name && p.name.startsWith('link_')) nested = true; p = p.parent; }
      if (nested) continue;
      const rest = o.name.slice(5).replace(/\.\d+$/, '');
      let a = null, b = null;
      for (const ka of nodeKeys) {
        if (!rest.startsWith(ka + '_')) continue;
        const kb = rest.slice(ka.length + 1);
        if (nodes.has(kb)) { a = ka; b = kb; break; }
      }
      const it = mkItem(o); it.dimmable = true; it.name = rest; it.a = a; it.b = b;
      links.push(it);
    }
    const hasA = nodes.has('haproxy_a'), hasB = nodes.has('haproxy_b');
    if (hasA) nodes.get('haproxy_a').dimmable = true;
    if (hasB) nodes.get('haproxy_b').dimmable = true;
    [...nodes.values(), ...links].forEach((it) => { if (it.dimmable) it.mats.forEach((m) => { m.transparent = true; }); });

    /* traffic edges (from link_* names when parseable, else fallback topology) */
    const edges = [];
    for (const l of links) if (l.a && l.b) edges.push({ a: nodes.get(l.a).c, b: nodes.get(l.b).c, ka: l.a, kb: l.b });
    if (!edges.length) for (const [a, b] of FALLBACK_EDGES) if (nodes.has(a) && nodes.has(b)) edges.push({ a: nodes.get(a).c, b: nodes.get(b).c, ka: a, kb: b });
    const PER = 6;
    const N = edges.length * PER;
    const pos = new Float32Array(Math.max(N, 1) * 3);
    const ph = new Float32Array(Math.max(N, 1));
    const spd = new Float32Array(Math.max(N, 1));
    for (let i = 0; i < N; i++) { ph[i] = (i % PER) / PER + Math.random() * 0.05; spd[i] = 0.18 + Math.random() * 0.1; }
    const pg = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(pos, 3));
    const pm = new T.PointsMaterial({ color: ACCENT_HEX, size: R * 0.03, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending });
    const points = new T.Points(pg, pm);
    points.frustumCulled = false;
    scene.add(points);

    /* post */
    const composer = new EffectComposer(renderer);
    const bloom = new UnrealBloomPass(new T.Vector2(512, 512), 0.12, 0.25, 0.92);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    /* controls */
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = R * 0.5; controls.maxDistance = R * 4.5;
    controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = true;
    controls.autoRotate = !mqReduce; controls.autoRotateSpeed = 0.35;
    controls.enabled = false;
    canvas.style.touchAction = 'pan-y';

    /* temp objects (allocated once) */
    const v1 = new T.Vector3(), v2 = new T.Vector3();
    const homeDir = new T.Vector3(0.55, 0.42, 0.72).normalize();
    const homeT = sphere.center.clone();
    const homeP = new T.Vector3();
    const ray = new T.Raycaster(); const ndc = new T.Vector2();
    const tw = { on: false, t: 0, dur: 1, p0: new T.Vector3(), t0: new T.Vector3(), p1: new T.Vector3(), t1: new T.Vector3() };
    const size = { w: 0, h: 0 };
    let userMoved = false;

    function computeHome() {
      const vf = camera.fov * Math.PI / 180;
      let d = R / Math.sin(vf / 2) * (usePlaceholder ? 1.0 : 0.55);
      if (camera.aspect < 1.4) d *= Math.min(1.9, 1.4 / camera.aspect);
      homeP.copy(homeT).addScaledVector(homeDir, d);
    }
    function resize() {
      const w = Math.max(stage.clientWidth, 2), h = Math.max(stage.clientHeight, 2);
      if (w === size.w && h === size.h) return;
      size.w = w; size.h = h;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false); composer.setSize(w, h);
      computeHome();
      if (!userMoved && !tw.on) { camera.position.copy(homeP); controls.target.copy(homeT); }
    }
    function fly(p, t, dur) {
      if (mqReduce || dur <= 0) { camera.position.copy(p); controls.target.copy(t); tw.on = false; return; }
      tw.p0.copy(camera.position); tw.t0.copy(controls.target); tw.p1.copy(p); tw.t1.copy(t);
      tw.t = 0; tw.dur = dur; tw.on = true;
    }
    let idleT = 0;
    function focus(id, dur = 1.4) {
      const it = nodes.get(strip(id));
      if (!it) return;
      const dist = Math.min(Math.max(it.r * 3.6, controls.minDistance * 1.3), controls.maxDistance * 0.6);
      v1.copy(it.c).addScaledVector(homeDir, dist);
      v1.y += it.r * 0.4;
      fly(v1, it.c, dur);
      idleT = 0;
    }
    function overview(dur = 1.4) { fly(homeP, homeT, dur); userMoved = false; }

    /* quality */
    const dprCap = Math.min(devicePixelRatio || 1, 2);
    let qMode = opts.quality || 'auto', level = isMobile ? 1 : 2, slow = 0;
    const bloomMax = isMobile ? 0.08 : 0.14;
    function applyLevel(l) {
      level = l;
      const dpr = l === 0 ? 1 : l === 1 ? Math.min(dprCap, 1.5) : dprCap;
      renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr);
      composer.setSize(size.w || 2, size.h || 2);
      bloom.enabled = l > 0; bloom.strength = l === 1 ? bloomMax * 0.65 : bloomMax;
      const sh = l === 2 && !isMobile;
      if (renderer.shadowMap.enabled !== sh) {
        renderer.shadowMap.enabled = sh; key.castShadow = sh;
        scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      }
    }
    function setQuality(q) { qMode = q; applyLevel(q === 'low' ? 0 : q === 'high' ? 2 : (isMobile ? 1 : 2)); slow = 0; }

    computeHome(); camera.position.copy(homeP); controls.target.copy(homeT); camera.lookAt(homeT);
    resize(); setQuality(qMode);

    /* state */
    let hoverId = null, failover = false, traffic = true, inView = true, running = false, raf = 0;
    let controlTaken = false, last = 0, ema = 0.016, frames = 0, time = 0, hoverDirty = false;
    const mouse = { x: 0, y: 0 };
    const tour = { on: false, paused: false, i: 0, t: 0 };

    const setHover = (id) => {
      if (id === hoverId) return;
      hoverId = id; canvas.style.cursor = id ? 'pointer' : '';
      if (id) { const h = byId.get(id); label.textContent = h ? (h.name || h.title) : ''; label.classList.add('is-on'); } else label.classList.remove('is-on');
    };
    const setMouse = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    function pickAt() {
      ndc.set(mouse.x, mouse.y); ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      return hit ? hit.object.userData.h3d : null;
    }
    let down = null;
    on(canvas, 'pointermove', (e) => { setMouse(e); if (e.pointerType === 'mouse') hoverDirty = true; });
    on(canvas, 'pointerleave', () => setHover(null));
    on(canvas, 'pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY }; setMouse(e);
      userMoved = true; tw.on = false; idleT = 0;
      if (tour.on) stopTour();
    });
    on(canvas, 'pointerup', (e) => {
      if (!down || !controlTaken) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved > 6) return;
      const id = pickAt();
      if (id) select(id, true);
    });
    on(canvas, 'wheel', () => { userMoved = true; idleT = 0; tw.on = false; }, { passive: true });

    function setControl(v) {
      controlTaken = v; controls.enabled = v;
      canvas.style.touchAction = v ? 'none' : 'pan-y';
      bTake.textContent = v ? 'Release control' : 'Take control';
      bTake.setAttribute('aria-pressed', String(v));
      root.classList.toggle('is-controlling', v);
      if (!v) setHover(null);
    }
    bTake.onclick = () => setControl(!controlTaken);

    /* tour */
    const tourOn = () => tour.on;
    function tourShow() {
      const h = hotspots[tour.i];
      select(h.id, true);
      caption.textContent = `Step ${tour.i + 1} of ${hotspots.length}. ${h.title || h.name}. ${h.summary || ''}`;
      tour.t = 0;
    }
    function startTour() {
      tour.on = true; tour.paused = false; tour.i = 0;
      bTour.textContent = 'Pause tour'; root.classList.add('is-touring');
      setControl(false); tourShow();
    }
    function stopTour() {
      tour.on = false; tour.paused = false; bTour.textContent = 'Play tour'; root.classList.remove('is-touring');
      card.hidden = true; selId = null; overview();
      caption.textContent = 'Tour ended.';
    }
    bTour.onclick = () => {
      if (!tour.on) startTour();
      else {
        tour.paused = !tour.paused; bTour.textContent = tour.paused ? 'Resume tour' : 'Pause tour';
        caption.textContent = tour.paused ? 'Tour paused.' : 'Tour resumed.';
      }
    };

    /* toggles */
    const setPressed = (b, v) => b.setAttribute('aria-pressed', String(v));
    const setFailover = (v) => {
      failover = !!v; setPressed(bFail, failover);
      caption.textContent = failover ? 'Failover on: the standby proxy takes the floating address through VRRP.' : 'Failover off: the primary proxy is active.';
    };
    const setTraffic = (v) => { traffic = !!v; setPressed(bTraf, traffic); points.visible = traffic; };
    bFail.onclick = () => setFailover(!failover);
    bTraf.onclick = () => setTraffic(!traffic);
    qSel.onchange = () => setQuality(qSel.value);

    /* run control: visibility + offscreen pause, single rAF loop */
    function setRunning() {
      const r = inView && !document.hidden && !disposed;
      if (r === running) return;
      running = r;
      if (r) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; setRunning(); });
    io.observe(host);
    on(document, 'visibilitychange', setRunning);
    const ro = new ResizeObserver(resize); ro.observe(stage);

    const isFailLink = (l, k) => l.a === k || l.b === k || (!l.a && l.name && l.name.indexOf(k) >= 0);
    const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

    function applyItem(it, dt) {
      const k = Math.min(1, dt * 9);
      const gT = it.lit ? 0.55 + 0.45 * Math.sin(time * 3.2) : it.gT;
      it.glow += (gT - it.glow) * k;
      it.dim += (it.dT - it.dim) * k;
      if (!it.dimmable || it.k) it.obj.scale.copy(it.s0).multiplyScalar(1 + 0.05 * it.glow);
      const g = Math.min(it.glow, 1);
      for (let i = 0; i < it.mats.length; i++) {
        const m = it.mats[i];
        m.emissive.copy(it.baseE[i]).lerp(ACCENT, g);
        m.emissiveIntensity = (it.baseI[i] + it.glow * 1.8) * (1 - 0.92 * it.dim);
        if (it.dimmable) m.opacity = 1 - 0.65 * it.dim;
      }
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1); last = now; time += dt;
      ema = ema * 0.95 + dt * 0.05; frames++;
      if (qMode === 'auto' && frames > 90 && level > 0) {
        slow = ema > 0.034 ? slow + 1 : 0;
        if (slow > 90) { applyLevel(level - 1); slow = 0; ema = 0.016; }
      }

      if (tour.on && !tour.paused) {
        tour.t += dt;
        if (tour.t > 5) { tour.i++; if (tour.i >= hotspots.length) stopTour(); else tourShow(); }
      }
      if (tw.on) {
        tw.t += dt; const e = easeIO(Math.min(tw.t / tw.dur, 1));
        camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
        if (tw.t >= tw.dur) tw.on = false;
      }
      idleT += dt;
      controls.autoRotate = !mqReduce && !tw.on && !tour.on && selId === null && idleT > 2.5;
      controls.update();
      v1.copy(controls.target).sub(homeT);
      if (v1.lengthSq() > R * R) controls.target.copy(v1.setLength(R).add(homeT));

      if (hoverDirty) { hoverDirty = false; setHover(controlTaken && !tw.on ? pickAt() : null); }

      for (const it of nodes.values()) { it.gT = it.id === hoverId ? 1 : it.id === selId ? 0.7 : 0; it.lit = false; it.dT = 0; }
      for (const l of links) { l.gT = 0; l.lit = false; l.dT = 0; }
      if (failover && hasA && hasB) {
        const a = nodes.get('haproxy_a'), b = nodes.get('haproxy_b');
        a.dT = 1; a.gT = 0; b.lit = true;
        for (const l of links) {
          if (isFailLink(l, 'haproxy_a')) l.dT = 1;
          else if (isFailLink(l, 'haproxy_b') || /vip|float|vrrp/i.test(l.name || '')) l.lit = true;
        }
      }
      for (const it of nodes.values()) applyItem(it, dt);
      for (const l of links) applyItem(l, dt);

      if (traffic && N) {
        for (let e = 0; e < edges.length; e++) {
          const ed = edges[e];
          const dead = failover && hasA && (ed.ka === 'haproxy_a' || ed.kb === 'haproxy_a');
          for (let p = 0; p < PER; p++) {
            const i = e * PER + p, o = i * 3;
            let t = ph[i] + dt * spd[i]; if (t > 1) t -= 1; ph[i] = t;
            if (dead) { pos[o + 1] = -1e5; continue; }
            pos[o] = ed.a.x + (ed.b.x - ed.a.x) * t; pos[o + 1] = ed.a.y + (ed.b.y - ed.a.y) * t; pos[o + 2] = ed.a.z + (ed.b.z - ed.a.z) * t;
          }
        }
        pg.attributes.position.needsUpdate = true;
      }

      const lid = hoverId || selId;
      const li = lid ? nodes.get(strip(lid)) : null;
      if (li) {
        if (!hoverId) { const nm = (byId.get(lid) || {}).name || ''; if (label.textContent !== nm) label.textContent = nm; label.classList.add('is-on'); }
        v2.copy(li.c); v2.y += li.r * 1.2; v2.project(camera);
        label.style.transform = `translate(${((v2.x + 1) * 0.5 * size.w).toFixed(1)}px,${((1 - v2.y) * 0.5 * size.h).toFixed(1)}px) translate(-50%,-100%)`;
      } else if (!hoverId) label.classList.remove('is-on');

      if (bloom.enabled) composer.render(); else renderer.render(scene, camera);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));
    setRunning();

    function dispose() {
      running = false; cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect(); controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); });
      });
      if (scene.background && scene.background.dispose) scene.background.dispose();
      composer.passes.forEach((p) => { if (p.dispose) p.dispose(); });
      if (composer.dispose) composer.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    }
    return {
      focus, overview, dispose, tourOn, stopTour, startTour, setControl, setQuality, setFailover, setTraffic,
      controlTaken: () => controlTaken,
      stats: () => ({ nodes: nodes.size, links: links.length, edges: edges.length, level, running }),
    };
  }

  /* ---------- boot ---------- */
  const api = {
    select: (id) => select(id, true),
    next: () => step(1), prev: () => step(-1),
    startTour: () => { if (live) live.startTour(); },
    stopTour: () => { if (live) live.stopTour(); },
    setFailover: (v) => { if (live) live.setFailover(v); },
    setTraffic: (v) => { if (live) live.setTraffic(v); },
    setQuality: (q) => { qSel.value = q; if (live) live.setQuality(q); },
    isLive: () => !!live,
    stats: () => (live ? live.stats() : null),
    unmount: unmountHero,
  };
  bLoad.onclick = () => startLive();
  const ready = (async () => {
    await loadHotspots();
    if (disposed) return;
    if (autoLive) await startLive(); else bLoad.hidden = false;
  })();

  function dispose() {
    disposed = true;
    cleanups.forEach((f) => f());
    if (live) live.dispose();
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    root.remove(); nav.remove();
    host.classList.remove('hero3d');
  }
  return { ready, api, dispose };
}

/* ---------- helpers ---------- */
function ensureImportMap(cdn) {
  if (ensureImportMap.done) return;
  ensureImportMap.done = true;
  for (const m of document.querySelectorAll('script[type="importmap"]')) if (m.textContent.includes('"three"')) return;
  const s = document.createElement('script');
  s.type = 'importmap';
  s.textContent = JSON.stringify({ imports: { three: cdn + 'build/three.module.js' } });
  document.head.appendChild(s);
}

function themeBg() {
  const r = document.documentElement;
  const a = r.getAttribute('data-theme');
  if (a === 'light') return '#ffffff';
  if (a === 'dark') return '#202124';
  return matchMedia('(prefers-color-scheme: light)').matches ? '#ffffff' : '#202124';
}

/* Primitive stand-in for platform.glb (demo/testing): same node/link naming. */
const NODE_COLORS = { client: GOOGLE.yellow, slb: GOOGLE.blue, haproxy_a: GOOGLE.blue, haproxy_b: GOOGLE.blue, nginx: GOOGLE.green, kong: GOOGLE.blue, istio: GOOGLE.blue, services: GOOGLE.green, kafka: GOOGLE.red, redis: GOOGLE.red, postgresql: GOOGLE.blue, prometheus: GOOGLE.red, grafana: GOOGLE.yellow, loki: GOOGLE.yellow };
const nodeColor = (k) => NODE_COLORS[k] || GOOGLE.blue;
function buildPlaceholder(T, hotspots) {
  const g = new T.Group();
  const layout = {
    client: [-9, 0, 0], slb: [-6, 0, 0], haproxy_a: [-3, 0, -1.4], haproxy_b: [-3, 0, 1.4], nginx: [0, 0, 0], kong: [2.6, 0, 0],
    istio: [5.2, 0, 0], services: [8, 0, 0], kafka: [11, 0, -2.4], redis: [11, 0, 0], postgresql: [11, 0, 2.4],
    prometheus: [8, 3, -3], grafana: [11, 3, -3], loki: [8, 3, 3],
  };
  const pos = {};
  for (const h of hotspots) {
    const k = strip(h.id); const p = layout[k]; if (!p) continue;
    const m = new T.Mesh(new T.BoxGeometry(1.3, 0.9, 1.3), new T.MeshStandardMaterial({ color: nodeColor(k), roughness: 0.5, metalness: 0.1, emissive: nodeColor(k), emissiveIntensity: 0.08 }));
    m.name = 'node_' + k; m.position.set(p[0], p[1], p[2]); g.add(m); pos[k] = m.position;
  }
  const edges = [['client', 'slb'], ['slb', 'haproxy_a'], ['slb', 'haproxy_b'], ['haproxy_a', 'nginx'], ['haproxy_b', 'nginx'], ['nginx', 'kong'], ['kong', 'istio'], ['istio', 'services']];
  const up = new T.Vector3(0, 1, 0);
  for (const [a, b] of edges) {
    if (!pos[a] || !pos[b]) continue;
    const dir = pos[b].clone().sub(pos[a]);
    const m = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, dir.length(), 6), new T.MeshStandardMaterial({ color: 0x9aa0a6, emissive: 0x5f6368, emissiveIntensity: 0.2 }));
    m.name = `link_${a}_${b}`;
    m.position.copy(pos[a]).add(pos[b]).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  return g;
}
