/* Portfolio SPA: hash routing, static JSON data, no build. All data text is inserted with textContent (no innerHTML on data). */
import { parseRoute, nextRoute } from './route.js?v=20261125e';
(() => {
  'use strict';

  const ICON_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/';
  const GITHUB = 'https://github.com/iamhasanimam';
  const LINKEDIN_URL = 'https://www.linkedin.com/in/iamhasanimam';
  const TYPE_CODE_MS = 22; // code typing speed in the hero editor, git log and code blocks (ms per character)
  const PAUSE_MS = 1800;   // pause after a snippet is typed, before the next tab
  const ASSET_V = '20261125e'; // cache-busting for dynamic imports; keep in sync with index.html

  // Brand colours (tuned for the dark banner). Slugs missing from simple-icons get a monogram.
  const COLORS = {
    kong: '#d4ff2a', nginx: '#17b05a', kubernetes: '#4a86ff', docker: '#2aa4f4', amazonaws: '#ff9900', vmware: '#7ccf4b',
    linux: '#ffd24a', redis: '#e8453b', istio: '#27c2ff', keycloak: '#b7c4d6', grafana: '#ff7a1a', prometheus: '#ff6a3d',
    ansible: '#f01a1a', jenkins: '#e5604f', vault: '#ffd814', apachekafka: '#9aa0a6', postgresql: '#5b9be0', python: '#ffd43b',
    elasticsearch: '#19c6b8', nodedotjs: '#5fb04e', minio: '#e04a68', k6: '#8f7bff', haproxy: '#7ec8ff'
  };
  const COLORS_LIGHT = { kong: '#6b8a00', vault: '#a87b00', linux: '#9a6b00', apachekafka: '#3c4043', python: '#b38900', keycloak: '#5f6368', elasticsearch: '#0f8f84', nodedotjs: '#3f8f35', docker: '#1a7fc4', k6: '#6a4fd8', minio: '#c0304f', haproxy: '#2b7fb8' };
  const NO_SVG = new Set(['haproxy']);
  const MONO = { haproxy: 'HA' };

  // Hero grid, matching the banner: [icon slug, label, route slug]
  const HERO_ROWS = [
    [['kong', 'Kong', 'kong'], ['nginx', 'NGINX', 'nginx'], ['kubernetes', 'Kubernetes', 'kubernetes-okd'], ['docker', 'Docker', 'docker'],
     ['amazonaws', 'AWS', 'aws'], ['vmware', 'VMware', 'vmware-esxi'], ['linux', 'Linux', 'linux-networking']],
    [['redis', 'Redis', 'redis'], ['istio', 'Istio', 'istio'], ['keycloak', 'Keycloak', 'keycloak'], ['grafana', 'Grafana', 'grafana'],
     ['prometheus', 'Prometheus', 'prometheus'], ['ansible', 'Ansible', 'ansible'], ['jenkins', 'Jenkins', 'jenkins']],
    [null, ['vault', 'OpenBao', 'openbao'], ['apachekafka', 'Kafka', 'kafka'], ['postgresql', 'PostgreSQL', 'postgresql'],
     ['python', 'Python', 'python'], ['elasticsearch', 'Elasticsearch', 'elasticsearch'], ['nodedotjs', 'Node.js', 'nodejs']]
  ];
  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  const cache = new Map();
  async function getJSON(path) {
    if (cache.has(path)) return cache.get(path);
    let data = null;
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (r.ok) data = await r.json();
    } catch (e) { /* offline or missing */ }
    cache.set(path, data);
    return data;
  }
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Never show the sensitive wording from data on the public site.
  const clean = (s) => String(s == null ? '' : s).replace(/\s{2,}/g, ' ').trim();
  const firstSentence = (s) => { const t = String(s || '').trim(); const m = t.match(/^.*?[.!?](\s|$)/); return (m ? m[0] : t).trim(); };
  const words = (s, n) => { const w = String(s).split(/\s+/); return w.length > n ? w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '...' : String(s); };
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})$/); return m ? MON[+m[2] - 1] + ' ' + m[1] : String(d || ''); };
  const fmtYears = (y) => String(y || '').replace(/(\d{4})\s*[-–]\s*(\d{4})/, '$1 – $2');
  const yearOf = (s) => { const m = String(s || '').match(/\d{4}/); return m ? m[0] : ''; };

  const cleanups = [];
  function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } }

  function glyph(slug, name) {
    if (!slug || NO_SVG.has(slug)) {
      const txt = MONO[slug] || (name || slug || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
      return h('span', { class: 'mono', style: `--c:${COLORS[slug] || '#cfd2ff'}`, 'aria-hidden': 'true' }, txt);
    }
    const s = h('span', { class: 'glyph', 'aria-hidden': 'true' });
    s.style.setProperty('--m', `url("${ICON_CDN}${encodeURIComponent(slug)}.svg")`);
    s.style.setProperty('--c', COLORS[slug] || '#cfd2ff');
    if (COLORS_LIGHT[slug]) s.style.setProperty('--cl', COLORS_LIGHT[slug]);
    return s;
  }
  const comingCard = (msg) => h('div', { class: 'empty' }, msg || 'Coming soon.');

  // scroll reveal: elements already on screen are never hidden; only below-the-fold ones start hidden.
  function reveal(root) {
    const els = [...root.querySelectorAll('.rv:not(.in)')];
    const show = (e) => { const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.classList.contains('rv')) : []; e.style.transitionDelay = Math.min(Math.max(sib.indexOf(e), 0), 5) * 40 + 'ms'; e.classList.add('in'); };
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach(show); return; }
    const vh = window.innerHeight || 800;
    const pending = [];
    els.forEach((e) => {
      const r = e.getBoundingClientRect();
      if (!e.isConnected || r.top < vh * 1.05) show(e); else { e.classList.add('rv-h'); pending.push(e); }
    });
    if (!pending.length) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { rootMargin: '0px 0px 6% 0px', threshold: 0 });
    pending.forEach((e) => io.observe(e));
    const t = setTimeout(() => pending.forEach((e) => { if (e.isConnected) show(e); }), 1200); // safety net: nothing stays hidden
    const all = () => pending.forEach(show);
    window.addEventListener('beforeprint', all);
    cleanups.push(() => { io.disconnect(); clearTimeout(t); window.removeEventListener('beforeprint', all); });
  }


  // ---------- tiny syntax highlighter, one shared typing ticker ----------
  const KW = {
    bash: ['set', 'echo', 'exit', 'if', 'then', 'fi', 'else', 'for', 'do', 'done', 'grep', 'deck', 'kubectl', 'curl', 'docker', 'sudo', 'export', 'cd', 'cat', 'ip', 'ssh', 'aws', 'helm'],
    groovy: ['pipeline', 'agent', 'any', 'stages', 'stage', 'steps', 'sh', 'post', 'always', 'environment', 'when'],
    python: ['def', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'in', 'with', 'class', 'try', 'except', 'as', 'print', 'raise', 'not', 'and', 'or'],
    yaml: [], cfg: [], plain: []
  };
  const LANG = { yaml: 'yaml', yml: 'yaml', bash: 'bash', sh: 'bash', shell: 'bash', groovy: 'groovy', jenkinsfile: 'groovy', python: 'python', py: 'python',
    nginx: 'cfg', conf: 'cfg', haproxy: 'cfg', ini: 'cfg', hcl: 'cfg', toml: 'cfg', cfg: 'cfg' };
  function tokenizeLine(line, lang0) {
    const lang = LANG[String(lang0 || '').toLowerCase()] || 'plain';
    const out = [];
    const push = (t, c) => { if (t) out.push([t, c || '']); };
    let i = 0;
    if (lang === 'yaml') {
      const m = line.match(/^(\s*(?:-\s+)?)([^\s:#'"\[\{][^:#]*?)(:)(?=\s|$)/);
      if (m) { push(m[1]); push(m[2], 'y'); push(m[3], 'p'); i = m[0].length; }
    } else if (lang === 'cfg') {
      const m = line.match(/^(\s*)([A-Za-z_][\w.\-]*)/);
      if (m && !line.trim().startsWith('#')) { push(m[1]); push(m[2], 'k'); i = m[0].length; }
    }
    const kws = KW[lang] || [];
    const cm = lang === 'groovy' ? '\\/\\/.*$' : '#.*$';
    const re = new RegExp('(' + cm + ')|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|(\\$\\{?\\w+\\}?)|(\\s--?[A-Za-z][\\w-]*)|(\\b\\d[\\w.:\\/]*)|([A-Za-z_][\\w-]*)|(\\s+|.)', 'y');
    while (i < line.length) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (!m) { push(line.slice(i)); break; }
      i = re.lastIndex;
      if (m[1]) push(m[1], 'c');
      else if (m[2]) push(m[2], 's');
      else if (m[3]) push(m[3], 'v');
      else if (m[4]) push(m[4], 'f');
      else if (m[5]) push(m[5], 'n');
      else if (m[6]) push(m[6], kws.includes(m[6]) ? 'k' : (/^(true|false|null)$/.test(m[6]) ? 'n' : ''));
      else push(m[7], /^[{}\[\]():,=]$/.test(m[7]) ? 'p' : '');
    }
    return out;
  }
  function lineNodes(line, lang) {
    const f = document.createDocumentFragment();
    tokenizeLine(line, lang).forEach(([t, c]) => f.append(c ? h('span', { class: 'tk-' + c }, t) : document.createTextNode(t)));
    return f;
  }
  function staticLines(body, code, lang) {
    body.replaceChildren(...String(code).split('\n').map((l, i) => h('div', { class: 'ln' }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'tx' }, lineNodes(l, lang)))));
  }
  // returns a step() function: types one character (or an indent run) per call, returns false when finished
  function typeCode(body, text, lang) {
    body.replaceChildren();
    const cur = h('span', { class: 'cur', 'aria-hidden': 'true' });
    let idx = 0, tx = null, curLine = '';
    const newLine = () => { tx = h('span', { class: 'tx' }, cur); body.append(h('div', { class: 'ln' }, h('span', { class: 'no' }, String(body.children.length + 1)), tx)); curLine = ''; body.scrollTop = body.scrollHeight; };
    newLine();
    return () => {
      if (idx >= text.length) return false;
      const ch = text[idx++];
      if (ch === '\n') newLine();
      else if (ch === ' ' && curLine.trim() === '') { curLine += ' '; while (text[idx] === ' ') { curLine += ' '; idx++; } tx.replaceChildren(lineNodes(curLine, lang), cur); }
      else { curLine += ch; tx.replaceChildren(lineNodes(curLine, lang), cur); }
      return true;
    };
  }
  function typeText(el, text) {
    const t = document.createTextNode(''); const cur = h('span', { class: 'cur', 'aria-hidden': 'true' });
    el.replaceChildren(t, cur);
    let i = 0;
    return () => { if (i >= text.length) { cur.remove(); return false; } t.data = text.slice(0, ++i); return true; };
  }
  const ticker = {
    fns: new Set(), id: 0,
    add(fn) { this.fns.add(fn); if (!this.id) this.id = setInterval(() => this.tick(), TYPE_CODE_MS); },
    tick() {
      if (document.hidden) return;
      for (const f of [...this.fns]) { let keep = true; try { keep = f() !== false; } catch (e) { keep = false; } if (!keep) this.fns.delete(f); }
      if (!this.fns.size) { clearInterval(this.id); this.id = 0; }
    },
    clear() { this.fns.clear(); clearInterval(this.id); this.id = 0; }
  };
  function onVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.2 });
    io.observe(el); cleanups.push(() => io.disconnect());
  }

  const SNIPS = [
    { file: 'kong.yaml', lang: 'yaml', code: ['_format_version: "3.0"', 'services:', '  - name: orders', '    url: http://orders.internal:8080', '    routes:', '      - name: orders-route', '        paths: [/orders]', '    plugins:', '      - name: rate-limiting', '        config: { minute: 600 }'].join('\n') },
    { file: 'haproxy.cfg', lang: 'cfg', code: ['frontend fe_https', '    bind :443 ssl crt /etc/haproxy/certs/', '    default_backend be_nginx', '', 'backend be_nginx', '    balance roundrobin', '    option httpchk GET /healthz', '    server nginx1 10.0.0.11:8080 check send-proxy', '    server nginx2 10.0.0.12:8080 check send-proxy'].join('\n') },
    { file: 'Jenkinsfile', lang: 'groovy', code: ['pipeline {', '  agent any', '  stages {', "    stage('Build')  { steps { sh 'make image' } }", "    stage('Scan')   { steps { sh 'trivy image --exit-code 1 app' } }", "    stage('Deploy') { steps { sh 'kubectl apply -k prod' } }", "    stage('Smoke')  { steps { sh 'curl -fsS $APP/healthz' } }", '  }', '}'].join('\n') },
    { file: 'deploy.sh', lang: 'bash', code: ['#!/usr/bin/env bash', 'set -euo pipefail', 'kubectl apply -k overlays/prod', 'kubectl rollout status deploy/orders --timeout=120s', 'echo "deployed"'].join('\n') }
  ];
  function termCard() {
    const tabs = h('div', { class: 'term-tabs', role: 'tablist', 'aria-label': 'Code samples' });
    const body = h('div', { class: 'term-body', 'aria-hidden': 'true' });
    const card = h('div', { class: 'term', role: 'group', 'aria-label': 'Code samples: ' + SNIPS.map((x) => x.file).join(', ') },
      h('div', { class: 'term-bar' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), tabs), body);
    let tab = 0, phase = 'type', wait = 0, step = null;
    const btns = SNIPS.map((sn, i) => {
      const b = h('button', { type: 'button', class: 'term-tab', role: 'tab', 'aria-selected': 'false', onclick: () => start(i) }, sn.file);
      tabs.append(b); return b;
    });
    function start(i) {
      tab = i; btns.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
      if (reduced()) { staticLines(body, SNIPS[i].code, SNIPS[i].lang); return; }
      step = typeCode(body, SNIPS[i].code, SNIPS[i].lang); phase = 'type';
    }
    start(0);
    if (!reduced()) {
      let seen = false;
      ticker.add(() => {
        if (card.isConnected) seen = true; else if (seen) return false; else return true; // not attached yet: wait
        if (phase === 'type') { if (step() === false) { phase = 'wait'; wait = Math.ceil(PAUSE_MS / TYPE_CODE_MS); } }
        else if (--wait <= 0) start((tab + 1) % SNIPS.length);
        return true;
      });
    }
    return card;
  }

  // eyebrow label written like a code comment or a prompt
  const eb = (text, heading) => h('div', null, h('span', { class: 'eyebrow' }, text), heading);


  // ---------- bullet formatting: never render a paragraph longer than two lines ----------
  function bulletize(text, maxWords) {
    maxWords = maxWords || 22;
    const keep = [];
    let t = String(text == null ? '' : text).replace(/`[^`]*`/g, (m) => { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0001'; })
      .replace(/\b(e\.g|i\.e|vs|etc)\./gi, (m) => m.replace('.', '\u0002'));
    const sents = t.split(/(?<=[.!?])\s+(?=[A-Z\u0001(])/).map((x) => x.trim()).filter(Boolean);
    const out = [];
    sents.forEach((snt) => {
      const wc = (x) => x.replace(/\u0001\d+\u0001/g, 'c').split(/\s+/).length;
      if (wc(snt) <= maxWords) { out.push(snt); return; }
      const parts = snt.split(/;\s+/);
      let cur = '';
      parts.forEach((pt) => { if (cur && wc(cur + ' ' + pt) > maxWords) { out.push(cur); cur = pt; } else cur = cur ? cur + '; ' + pt : pt; });
      if (cur) out.push(cur);
    });
    return out.map((x) => x.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]).replace(/\u0002/g, '.').replace(/[;,]$/, ''));
  }
  const STOP = new Set(['a','an','the','it','in','if','when','each','there','for','by','on','at','to','and','or','so','which','with','inside','within','as','this','these','those','they','because','once','after','before','while','then','both','all','any','when','what','where','that']);
  function inlineNodes(text, lead) {
    const out = [];
    const parts = String(text).split(/(`[^`]+`)/);
    let first = true;
    parts.forEach((pt) => {
      if (!pt) return;
      if (pt[0] === '`' && pt.length > 2) { out.push(h('code', { class: 'ic' }, pt.slice(1, -1))); first = false; return; }
      if (lead && first) {
        const m = pt.match(/^(\S+)(\s[\s\S]*)?$/);
        if (m && m[1].length >= 4 && !STOP.has(m[1].toLowerCase().replace(/[^a-z]/g, ''))) { out.push(h('b', { class: 'vb' }, m[1])); if (m[2]) out.push(m[2]); first = false; return; }
      }
      out.push(pt); first = false;
    });
    return out;
  }
  function bulletList(items, max, lead) {
    const mk = (arr) => h('ul', { class: 'bl' }, arr.map((x) => h('li', null, inlineNodes(x, lead !== false))));
    max = max || 7;
    if (items.length <= max) return mk(items);
    return h('div', null, mk(items.slice(0, max)), h('details', { class: 'more' }, h('summary', null, 'More'), mk(items.slice(max))));
  }
  const textBullets = (text, max, words) => bulletList(bulletize(text, words || 22), max);

  // ---------- shared components ----------
  function techCard(t) {
    return h('a', { class: 'card tcard compact', href: '#/tech/' + t.slug },
      h('span', { class: 'ico' }, glyph(t.icon, t.name)), h('h3', null, t.name), h('span', { class: 'lvl ' + (t.level || '') }, t.level ? cap(t.level) : ''));
  }

  function copyBtn(getText) {
    const b = h('button', { type: 'button', class: 'copy', 'aria-label': 'Copy code to clipboard' }, 'Copy');
    b.addEventListener('click', async () => {
      const text = getText();
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
        const ta = h('textarea', { style: 'position:fixed;opacity:0', 'aria-hidden': 'true' }); ta.value = text;
        document.body.append(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
        ta.remove();
      }
      b.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(() => { b.textContent = 'Copy'; }, 1600);
    });
    return b;
  }
  function fileNameFor(code, lang) {
    const m = String(code).split('\n')[0].match(/^(?:#|\/\/|--)\s*(\/?[\w.\/\-]+\.\w{1,6})\s*$/);
    if (m) return m[1].split('/').pop();
    const d = { bash: 'terminal.sh', sh: 'terminal.sh', yaml: 'config.yaml', yml: 'config.yaml', python: 'script.py', text: 'notes.txt' };
    return d[String(lang).toLowerCase()] || ('snippet.' + (lang || 'txt'));
  }
  function codeBlock(code, lang, typeOnce) {
    const body = h('pre', { class: 'code-body', tabindex: '0' });
    const lines = String(code).split('\n');
    staticLines(body, code, lang);
    const box = h('div', { class: 'code ide' }, h('div', { class: 'ide-bar' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'ide-file' }, fileNameFor(code, lang)), h('span', { class: 'ide-lang' }, lang || 'text'), copyBtn(() => code)), body);
    if (false && typeOnce && lines.length <= 12) {
      onVisible(box, () => { const st = typeCode(body, code, lang); ticker.add(() => { if (!box.isConnected) return false; if (st() === false) { staticLines(body, code, lang); return false; } return true; }); });
    }
    return box;
  }

  function blogCard(p) {
    const url = safeUrl(p.url);
    return h('article', { class: 'card slide rv', role: 'group', 'aria-roledescription': 'slide' },
      h('div', { class: 'meta' }, p.soon ? h('span', { class: 'badge soon' }, 'Coming soon') : [fmtDate(p.date), p.readMinutes ? ` \u00b7 ${p.readMinutes} min read` : '']),
      h('h3', null, p.title), h('p', null, p.summary || ''),
      h('div', { class: 'chips' }, (p.tags || []).slice(0, 3).map((t) => h('span', { class: 'chip' }, '#' + t))),
      url ? h('a', { class: 'tlink', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Read on LinkedIn \u2197') : null);
  }
  const sortedPosts = (posts) => (posts || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  function carousel(posts) {
    const track = h('div', { class: 'carousel', tabindex: '0', role: 'region', 'aria-roledescription': 'carousel', 'aria-label': 'Posts, scroll horizontally' }, posts.map(blogCard));
    const bar = h('i'); const prog = h('div', { class: 'car-prog', 'aria-hidden': 'true' }, bar);
    const step = () => Math.max(240, track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 16 : 316);
    const go = (d) => track.scrollBy({ left: d * step() });
    const upd = () => { const w = Math.max(1, track.scrollWidth); bar.style.width = Math.min(100, (track.clientWidth / w) * 100) + '%'; bar.style.marginLeft = (track.scrollLeft / w) * 100 + '%'; };
    track.addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); cleanups.push(() => removeEventListener('resize', upd));
    setTimeout(upd, 0); requestAnimationFrame(upd);
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });
    const ctl = h('div', { class: 'car-ctl' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous posts', onclick: () => go(-1) }, '\u2190'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next posts', onclick: () => go(1) }, '\u2192'));
    return { track, ctl, prog };
  }

  // ---------- data ----------
  async function loadBlogs() { const d = await getJSON('data/blogs.json'); return d && Array.isArray(d.posts) ? d.posts.filter((p) => p.status === 'published') : null; }
  async function loadIndex() { const d = await getJSON('data/tech/index.json'); return Array.isArray(d) ? d : null; }
  async function loadProjects() { const d = await getJSON('data/projects.json'); return d && Array.isArray(d.projects) ? d.projects : null; }
  async function loadCareer() { const d = await getJSON('data/career.json'); return d && Array.isArray(d.roles) ? d : null; }


  function hero() {
    const right = h('div', { class: 'hero-r' });
    const box = h('section', { class: 'hero', 'aria-label': 'Introduction' },
      h('div', null, h('h1', null, 'Hasan Imam'), h('p', { class: 'sub' }, 'DevOps Engineer'), h('p', { class: 'build' }, 'I build systems', h('span', { class: 'build-dim' }, ' that stay up.')),
        h('div', { class: 'hero-cta' }, h('a', { class: 'btn primary', href: LINKEDIN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'LinkedIn'), h('a', { class: 'btn', href: GITHUB, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub')),
        termCard()), right);
    box.append(h('div', { class: 'scan', 'aria-hidden': 'true' }));

    // fallback: plain coloured icon grid linking to the tech pages (no WebGL, reduced motion, or module failure)
    function fallbackGrid() {
      const grid = h('ul', { class: 'icon-grid', 'aria-label': 'Technologies' });
      HERO_ROWS.forEach((row) => row.forEach((c) => {
        if (!c) { grid.append(h('li', { class: 'spacer', 'aria-hidden': 'true' })); return; }
        const [icon, label, slug] = c;
        const a = h('a', { class: 'ti', href: '#/tech/' + slug, 'aria-label': label, title: label }, glyph(icon, label));
        a.style.setProperty('--bc', (curTheme() === 'light' && COLORS_LIGHT[icon]) || COLORS[icon] || '#8ab4f8');
        grid.append(h('li', null, a));
      }));
      right.replaceChildren(grid);
    }
    const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
    if (reduced() || !hasGL) { fallbackGrid(); return box; }

    const host = h('div', { class: 'hero-graph' });
    right.append(host);
    let tg = null, dead = false;
    cleanups.push(() => { dead = true; if (tg) { try { tg.unmount(); } catch (e) { /* ignore */ } tg = null; } });
    const sub = (t) => { try { if (tg && tg.setTheme) tg.setTheme(t); } catch (e) { /* ignore */ } };
    themeSubs.add(sub); cleanups.push(() => themeSubs.delete(sub));
    import(`./hero3d/techgraph.js?v=${ASSET_V}`).then(async (m) => {
      if (dead) return;
      tg = m.mountTechGraph(host, { idleColor: true, onSelect(route) { navigate('#/tech/' + route); } });
      await tg.ready;
      if (dead) return;
      const q = new URLSearchParams(location.search);
      const hq = q.get('hover') || q.get('tip');
      if (hq) { tg.hover(hq); if (q.get('settle') && tg.settle) tg.settle(); }
    }).catch(() => { if (!dead) { tg = null; fallbackGrid(); } });
    return box;
  }

  function lazy3D(wrap, mount, unmount, onFail) {
    let on = false, busy = false;
    const go = () => { on = true; busy = true; Promise.resolve().then(mount).catch(() => { on = false; if (onFail) onFail(); }).finally(() => { busy = false; }); };
    if (!('IntersectionObserver' in window)) { go(); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !on && !busy) go();
      else if (!e.isIntersecting && on && !busy) { on = false; try { unmount(); } catch (err) { /* ignore */ } }
    }), { rootMargin: '200px' });
    io.observe(wrap);
    cleanups.push(() => { io.disconnect(); if (on) { on = false; try { unmount(); } catch (err) { /* ignore */ } } });
  }
  let heroMod = null;
  function cinematic() {
    const host = h('div', { class: 'cine-host', id: 'cine-host' });
    const wrap = h('section', { 'aria-label': 'Interactive 3D platform', id: 'cinematic', class: 'cine' }, host);
    lazy3D(wrap, () => import(`./hero3d/hero.js?v=${ASSET_V}`).then((m) => {
      heroMod = m;
      return m.mountHero(host, { base: 'about:blank#', placeholder: true, video: false, onOpenTech(slug) { navigate('#/tech/' + slug); } });
    }), () => { if (heroMod) heroMod.unmountHero(); }, () => { wrap.remove(); });
    return wrap;
  }
  function sectionHead(title, link, linkText) {
    return h('div', { class: 'sec' }, h('h2', null, title), link ? h('a', { class: 'more', href: link }, linkText || 'View all') : null);
  }

  // ---------- career ----------
  function roleParts(r) {
    const hl = (r.highlights || []).map(clean).filter(Boolean);
    const headline = clean(r.headline) || hl[0] || firstSentence(clean(r.summary));
    const imp = r.impact && r.impact.value ? { value: String(r.impact.value), label: clean(r.impact.label) } : null;
    const hasHead = !!clean(r.headline);
    const bullets = (hasHead ? hl : hl.slice(1)).slice(0, 3);
    const end = /present|now/i.test(r.end || '') ? 'Now' : yearOf(r.end);
    return { headline, imp, bullets, years: (yearOf(r.start) === end ? end : `${yearOf(r.start)} – ${end}`), current: end === 'Now' };
  }
  const orderedRoles = (c, oldestFirst) => { const a = c.roles.slice(); return oldestFirst ? a.reverse() : a; };

  const hash7 = (str) => { let x = 2166136261; for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return ((x >>> 0).toString(16) + '0000000').slice(0, 7); };
  function gitLog(c, compact) {
    const roles = orderedRoles(c, false); // newest first, HEAD at the top
    const box = h('ol', { class: 'gitlog' + (compact ? ' compact' : ''), 'aria-label': 'Career as a git log' });
    roles.forEach((r, i) => {
      const p = roleParts(r);
      const head = i === 0;
      const msg = h('div', { class: 'cmsg' }, p.headline);
      const imp = p.imp ? (/^[-\u2212]/.test(p.imp.value) ? { cls: 'del', t: p.imp.value + ' ' + p.imp.label } : { cls: 'add', t: '+' + p.imp.value.replace(/^\+/, '') + ' ' + p.imp.label }) : null;
      box.append(h('li', { class: 'commit rv' + (head ? ' head' : '') },
        h('span', { class: 'gcol', 'aria-hidden': 'true' }, h('i', { class: 'gd' })),
        h('div', { class: 'cbody' },
          h('div', { class: 'chash' }, 'commit ', h('b', null, hash7(r.title + (r.start || ''))), head ? h('span', { class: 'refs' }, ' (HEAD -> main)') : null),
          h('div', { class: 'cmeta' }, 'Author: Md Hasan Imam'),
          h('div', { class: 'cmeta' }, 'Date:   ' + (r.start || '')),
          msg,
          h('div', { class: 'cmeta' }, [r.title, r.company].filter(Boolean).join(' @ ')),
          imp ? h('div', { class: 'cstat ' + imp.cls }, imp.t) : null,
          !compact && p.bullets.length ? bulletList(p.bullets, 3) : null)));
    });
    return box;
  }
  function seg(current, onPick, tabs) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': 'Career view' });
    (tabs || [['story', 'Story'], ['git', 'git log']]).forEach(([id, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(current === id), onclick: () => { [...wrap.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onPick(id); } }, label);
      wrap.append(b);
    });
    return wrap;
  }
  let careerView = (() => { const v = new URLSearchParams(location.search).get('view'); return v === 'git' || v === 'story' ? v : 'quest'; })();

  function careerCompact(c) {
    const body = h('ol', { class: 'trail' }, orderedRoles(c, false).map((r) => {
      const p = roleParts(r);
      return h('li', { class: 'tn rv' + (p.current ? ' now' : '') }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('div', { class: 'yr' }, p.years),
        h('h3', null, r.title), h('p', null, words(p.headline, 14)));
    }));
    return h('section', { 'aria-labelledby': 'tr-h', id: 'trajectory' },
      h('div', { class: 'sec' }, eb('// career', h('h2', { id: 'tr-h' }, 'Career trajectory')),
        h('div', { class: 'sec-r' }, h('a', { class: 'btn primary', href: '#/career' }, 'Play the journey'), h('a', { class: 'more', href: '#/career' }, 'Full journey \u2192'))),
      body);
  }

  async function careerPage(root) {
    root.append(h('h1', { class: 'big-h' }, 'Career'));
    const c = await loadCareer();
    if (!c) { root.append(comingCard()); return; }
    const host = h('div', { class: 'career-host' });
    let unscroll = null, questMod = null;
    const stopQuest = () => { if (questMod) { try { questMod.unmountQuest(); } catch (e) { /* ignore */ } questMod = null; } };
    const stopScroll = () => { if (unscroll) { unscroll(); unscroll = null; } };
    cleanups.push(() => { stopQuest(); stopScroll(); });
    function paint() {
      stopQuest(); stopScroll();
      if (careerView === 'quest') paintQuest();
      else if (careerView === 'git') { host.replaceChildren(gitLog(c, false)); reveal(host); }
      else paintStory();
    }
    async function paintQuest() {
      const qh = h('div', { class: 'quest-host' });
      host.replaceChildren(qh);
      try {
        const m = await import(`./hero3d/quest.js?v=${ASSET_V}`);
        for (let k = 0; k < 40 && !qh.isConnected; k++) await new Promise((r) => setTimeout(r, 50));
        if (careerView !== 'quest' || !qh.isConnected) return;
        questMod = m;
        await m.mountQuest(qh, { base: 'about:blank#', careerUrl: 'data/career.json', placeholder: true, onNavigate(hs) { navigate(hs); } });
      } catch (e) { careerView = 'story'; paintStory(); }
    }
    root.append(h('div', { class: 'toolbar' }, seg(careerView, (v) => { careerView = v; paint(); }, [['quest', 'Quest'], ['story', 'Story'], ['git', 'git log']])), host);
    function paintStory() {
      const roles = orderedRoles(c, false); // newest first
      const first = roles[0], last = roles[roles.length - 1];
      const label = (r, end) => (end ? (/present|now/i.test(r.end || '') ? 'Now' : yearOf(r.end)) : yearOf(r.start));
      const fill = h('div', { class: 'path-fill' });
      const rFill = h('i');
      const story = h('div', { class: 'story' }, h('div', { class: 'path', 'aria-hidden': 'true' }, fill),
        roles.map((r) => {
          const p = roleParts(r);
          return h('article', { class: 'rcard rv' + (p.current ? ' now' : '') },
            h('span', { class: 'node', 'aria-hidden': 'true' }),
            h('div', { class: 'ryear' }, p.years),
            h('h2', null, r.title), h('div', { class: 'cat' }, [r.company, r.location].filter(Boolean).join(' \u00b7 ')),
            h('p', { class: 'headline' }, p.headline),
            p.imp ? h('div', { class: 'impact' }, h('strong', null, p.imp.value), h('span', null, p.imp.label)) : null,
            p.bullets.length ? bulletList(p.bullets, 3) : null,
            r.stack && r.stack.length ? h('div', { class: 'chips' }, r.stack.slice(0, 8).map((x) => h('span', { class: 'chip' }, x))) : null);
        }));
      const rail = h('aside', { class: 'rail', 'aria-hidden': 'true' }, h('span', { class: 'ry' }, label(first, true)), h('div', { class: 'rbar' }, rFill), h('span', { class: 'ry' }, label(last)));
      host.replaceChildren(h('div', { class: 'story-wrap' }, story, rail));
      const upd = () => {
        const r = story.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (innerHeight * 0.55 - r.top) / r.height));
        fill.style.height = (p * 100) + '%'; rFill.style.height = (p * 100) + '%';
      };
      addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd);
      unscroll = () => { removeEventListener('scroll', upd); removeEventListener('resize', upd); };
      upd(); reveal(host);
    }
    paint();
    const rows = (title, arr) => arr && arr.length ? h('div', { class: 'card' }, h('h3', null, title),
      h('ul', { class: 'plain' }, arr.map((x) => h('li', null, typeof x === 'string' ? x : [x.name || x.degree, x.institution || x.issuer, x.date || [x.start, x.end].filter(Boolean).join(' - ')].filter(Boolean).join(' \u00b7 '))))) : null;
    root.append(h('div', { class: 'two mt6' }, rows('Education', c.education), rows('Certifications', c.certs)));
  }

  // ---------- work ----------

  // ---------- catalogue of work (data/work.json, falls back to data/projects.json) ----------
  const ICON_GUESS = { aws: 'amazonaws', kubernetes: 'kubernetes', docker: 'docker', python: 'python', redis: 'redis', postgresql: 'postgresql', vmware: 'vmware', nginx: 'nginx', kong: 'kong', jenkins: 'jenkins', grafana: 'grafana', prometheus: 'prometheus', ansible: 'ansible', istio: 'istio', keycloak: 'keycloak', superset: 'apachesuperset', cloudfront: 'amazonaws', route: 'amazonroute53', s3: 'amazons3', ec2: 'amazonec2', cloudwatch: 'amazoncloudwatch', terraform: 'terraform', linux: 'linux', github: 'github' };
  function normWork(p, i) {
    const stack = (p.stack || []).map(String);
    let icons = Array.isArray(p.icons) && p.icons.length ? p.icons.map(String) : [];
    if (!icons.length) stack.forEach((t) => { const k = Object.keys(ICON_GUESS).find((x) => t.toLowerCase().includes(x)); if (k && !icons.includes(ICON_GUESS[k])) icons.push(ICON_GUESS[k]); });
    return { slug: p.slug || 'w' + i, title: p.title || '', category: p.category || 'Cloud', kind: p.kind || 'Personal project', summary: p.summary || '', icons: icons.slice(0, 5),
      bullets: (p.bullets || p.highlights || []).map(clean).filter(Boolean), repo: safeUrl(p.repo), image: typeof p.image === 'string' && p.image ? p.image : null, imageAlt: p.imageAlt || '', stack, year: p.year || '', status: p.status || '' };
  }
  async function loadWork() {
    const w = await getJSON('data/work.json');
    if (w && Array.isArray(w.projects) && w.projects.length) return { projects: w.projects.map(normWork), studied: Array.isArray(w.studied) ? w.studied : [] };
    const p = await loadProjects();
    return { projects: (p || []).map(normWork), studied: [] };
  }
  const EXTRA_C = { react: ['#61dafb', '#0b8aa8'], mongodb: ['#47a248', '#2e7d32'], powershell: ['#5391fe', '#1a5fd0'], windows: ['#4aa3ff', '#0067b8'], apachesuperset: ['#20a7c9', '#0e7f9c'], terraform: ['#8f5be6', '#6a3db8'], github: ['#9aa0a6', '#3c4043'], amazonroute53: ['#ff9900', '#c77700'] };
  const monoGlyph = (slug, name) => {
    const g = glyph(slug, name); const x = EXTRA_C[slug] || (/^(amazon|aws)/.test(slug) ? ['#ff9900', '#c77700'] : null);
    if (x) { g.style.setProperty('--c', x[0]); g.style.setProperty('--cl', x[1]); } else if (!COLORS[slug]) g.style.setProperty('--c', 'var(--muted)');
    return g;
  };
  function bulletLi(b) {
    const m = String(b).match(/^(\S+)\s+([\s\S]*)$/);
    return h('li', null, m ? [h('b', { class: 'vb' }, m[1]), ' ', h('span', null, m[2])] : b);
  }
  function workCard(p, opts) {
    const open = opts && opts.expand;
    const card = h('article', { class: 'card wk', tabindex: open ? '0' : null, role: open ? 'button' : null, 'aria-expanded': open ? 'false' : null });
    const more = h('div', { class: 'wk-more', hidden: true });
    card.append(...[
      h('div', { class: 'wk-icons', 'aria-hidden': 'true' }, p.icons.map((k) => h('span', { class: 'wk-ic' }, monoGlyph(k, k)))),
      h('div', { class: 'wk-meta' }, [p.category, p.kind].filter(Boolean).join(' \u00b7 ')),
      h('h3', { class: 'wk-title', title: p.title }, p.title),
      h('p', { class: 'wk-sum' }, p.summary),
      h('ul', { class: 'wk-bul' }, p.bullets.slice(0, 3).map(bulletLi)),
      more,
      h('div', { class: 'wk-foot' },
        p.repo ? h('a', { class: 'btn wk-repo', href: p.repo, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, h('span', { class: 'wk-gh', 'aria-hidden': 'true' }, glyph('github', 'GH')), 'Repo')
          : h('span', { class: 'badge ' + (/platform/i.test(p.kind) ? '' : 'soon') }, /platform/i.test(p.kind) ? 'Platform' : 'Coming soon'),
        p.year ? h('span', { class: 'wk-year' }, fmtYears(p.year)) : null)].filter(Boolean));
    if (open) {
      if (p.image) more.append(h('img', { class: 'wk-img', src: p.image, alt: p.imageAlt || '', loading: 'lazy', decoding: 'async' }));
      if (p.bullets.length > 3) more.append(h('ul', { class: 'wk-bul' }, p.bullets.slice(3).map(bulletLi)));
      if (p.stack.length) more.append(h('div', { class: 'chips' }, p.stack.map((x) => h('span', { class: 'chip' }, x))));
      if (!more.childNodes.length) more.append(h('div', { class: 'chips' }, h('span', { class: 'chip' }, p.category)));
      const toggle = () => { const on = card.classList.toggle('open'); more.hidden = !on; card.setAttribute('aria-expanded', String(on)); };
      card.addEventListener('click', (e) => { if (!e.target.closest('a')) toggle(); });
      card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); toggle(); } });
    }
    return card;
  }
  const workRank = (p) => (/shipped/i.test(p.status) ? 0 : 1) * 10 + (/personal/i.test(p.kind) ? 0 : 1);

  function projectCard(p) {
    const repo = safeUrl(p.repo), demo = safeUrl(p.demo);
    return h('article', { class: 'card pcard rv' },
      /aws/i.test(p.title + ' ' + (p.stack || []).join(' ')) ? miniIcons() : null,
      h('h3', null, p.title), h('p', { class: 'one' }, p.summary || ''),
      p.highlights && p.highlights.length ? h('ul', { class: 'plain' }, p.highlights.slice(0, 4).map((x) => h('li', null, x))) : null,
      h('div', { class: 'chips' }, (p.stack || []).slice(0, 6).map((s) => h('span', { class: 'chip' }, s))),
      repo || demo ? h('div', { class: 'chips push' }, repo ? h('a', { class: 'btn', href: repo, target: '_blank', rel: 'noopener noreferrer' }, 'Repository') : null,
        demo ? h('a', { class: 'btn primary', href: demo, target: '_blank', rel: 'noopener noreferrer' }, 'Live demo') : null) : null);
  }

  async function projectsPage(root) {
    root.append(h('h1', { class: 'big-h' }, 'Work'));
    const { projects, studied } = await loadWork();
    if (!projects.length) { root.append(comingCard()); return; }
    const CATS = ['Cloud', 'Kubernetes & Mesh', 'CI/CD', 'Virtualization', 'Observability', 'Edge & Networking', 'Automation'];
    const present = new Set(projects.map((p) => p.category));
    const cats = CATS.filter((c) => present.has(c)).concat([...present].filter((c) => !CATS.includes(c)));
    let cat = null, kind = 'all';
    const gridEl = h('div', { class: 'grid work' });
    const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' });
    const paint = () => {
      gridEl.textContent = '';
      projects.filter((p) => (!cat || p.category === cat) && (kind === 'all' || (kind === 'personal' ? /personal/i.test(p.kind) : /platform/i.test(p.kind))))
        .forEach((p) => gridEl.append(workCard(p, { expand: true })));
      if (!gridEl.childNodes.length) gridEl.append(comingCard('Nothing here yet.'));
      chipsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.c || null) === cat)));
      reveal(gridEl);
    };
    chipsEl.append(h('button', { type: 'button', class: 'chip', 'data-c': '', onclick: () => { cat = null; paint(); } }, 'All'));
    cats.forEach((c) => chipsEl.append(h('button', { type: 'button', class: 'chip', 'data-c': c, onclick: () => { cat = c; paint(); } }, c)));
    const kseg = seg(kind, (v) => { kind = v; paint(); }, [['all', 'All'], ['personal', 'Personal'], ['production', 'Platform']]);
    kseg.setAttribute('aria-label', 'Kind');
    root.append(h('div', { class: 'toolbar' }, chipsEl, kseg), gridEl);
    paint();
  }

  async function blogsPage(root) {
    root.append(h('h1', { class: 'big-h' }, 'Writing'));
    const posts = await loadBlogs();
    if (!posts || !posts.length) { root.append(comingCard()); return; }
    root.append(h('div', { class: 'grid wide' }, sortedPosts(posts).map(blogCard)));
  }

  // ---------- technologies ----------
  async function technologies(root) {
    root.append(h('h1', { class: 'big-h' }, 'Technologies'));
    const idx = await loadIndex();
    if (!idx) { root.append(comingCard()); return; }
    const q = state.q.trim().toLowerCase();
    const list = q ? idx.filter((t) => [t.name, t.slug, t.category, t.blurb, t.level].join(' ').toLowerCase().includes(q)) : idx;
    if (q) root.append(h('p', { class: 'cat', role: 'status' }, `${list.length} of ${idx.length} match "${state.q}"`));
    if (!list.length) { root.append(comingCard('No technology matches that search.')); return; }
    [...new Set(list.map((t) => t.category))].forEach((c) => {
      root.append(h('h2', { class: 'cat-h' }, c), h('div', { class: 'grid icons' }, list.filter((t) => t.category === c).map(techCard)));
    });
  }

  const isPlaceholderVideo = (v) => !v || !v.title || /\blab\s*\d+\s*$/i.test(v.title);

  async function techPage(root, slug) {
    const [idx, d] = await Promise.all([loadIndex(), getJSON(`data/tech/${encodeURIComponent(slug)}.json`)]);
    const meta = (idx || []).find((t) => t.slug === slug);
    const t = d || meta;
    root.append(h('div', { class: 'crumb' }, h('a', { href: '#/technologies' }, 'Technologies'), ' / ', t ? t.name : slug));
    if (!t) {
      root.append(h('h1', { class: 'big-h' }, 'Not found'), h('div', { class: 'empty' }, 'No technology called "' + slug + '". ', h('a', { href: '#/technologies' }, 'Browse technologies')));
      document.title = 'Not found | Hasan Imam';
      return;
    }
    document.title = `${t.name} | Hasan Imam`;
    root.append(h('header', { class: 'thead' }, h('span', { class: 'ico' }, glyph(t.icon || (meta && meta.icon), t.name)),
      h('div', null, h('h1', null, t.name), h('p', null, firstSentence(t.tagline || (meta && meta.blurb) || '')), h('div', { class: 'chips' }, t.level ? h('span', { class: 'badge ' + t.level }, cap(t.level)) : null))));
    if (!d) { root.append(comingCard('Coming soon.')); return; }

    if (slug === 'aws') root.append(awsBuilt());

    let kp = Array.isArray(t.keyPoints) && t.keyPoints.length ? t.keyPoints.map(String) : null;
    if (!kp && Array.isArray(t.howItWorks)) kp = t.howItWorks.slice(0, 4).map((s) => words(firstSentence(s.body), 16));
    if (kp && kp.length) root.append(h('div', { class: 'kp' }, kp.slice(0, 4).map((x, i) => h('div', { class: 'card kpt rv' }, h('span', { class: 'kn' }, String(i + 1)), h('p', null, x)))));

    const fspec = (await getJSON(`data/flow/${encodeURIComponent(slug)}.json`)) || (await getJSON(`data/stack/${encodeURIComponent(slug)}.json`));
    const decls = fspec && Array.isArray(fspec.declarations) ? fspec.declarations.map(String).slice(0, 4) : null;
    if (decls && decls.length) root.append(declList(decls));
    const flow = await flowSection(slug, false, t.name);
    if (flow) root.append(flow);
    if (Array.isArray(t.quickDeploy) && t.quickDeploy.length) {
      root.append(h('div', { class: 'sec' }, h('h2', null, 'Quick deploy')),
        h('ol', { class: 'qd' }, t.quickDeploy.slice(0, 4).map((s) => h('li', { class: 'card' }, typeof s === 'string' ? s : (s.title || s.step || s.text || '')))));
    }

    // deep dive: one column, one left edge, bullets only
    const dd = h('details', { class: 'deep' }, h('summary', null, 'Full deep dive'));
    if (new URLSearchParams(location.search).get('deep') || (curRoute && curRoute.query.deep)) dd.open = true;
    const body = h('div', { class: 'deep-body' });
    const dh = (t) => h('h2', { class: 'dh' }, t);
    if (t.howItWorks && t.howItWorks.length) body.append(dh('How it works'), h('div', { class: 'hiw' }, t.howItWorks.map((x) => h('div', { class: 'card hw' }, h('h3', null, x.title), textBullets(x.body, 7)))));
    if (t.flow && t.flow.length) body.append(dh('Flow, step by step'), flowStepper(t.flow));
    if (t.deploy) {
      body.append(dh('How to deploy'));
      if (t.deploy.summary) body.append(textBullets(t.deploy.summary, 4));
      if (t.deploy.prerequisites && t.deploy.prerequisites.length) body.append(h('h3', { class: 'dh3' }, 'Prerequisites'), bulletList(t.deploy.prerequisites.map(String), 7, false));
      (t.deploy.steps || []).forEach((st, i) => body.append(h('section', { class: 'dstep' }, h('header', null, h('span', { class: 'n' }, String(i + 1)), h('h3', null, st.title)),
        st.code ? codeBlock(st.code, st.lang, false) : null, st.note ? textBullets(st.note, 3) : null)));
    }
    if (t.verify && t.verify.length) body.append(dh('Verify it works'), bulletList(t.verify.map(String), 7, false));
    if (t.pitfalls && t.pitfalls.length) body.append(dh('Pitfalls'), bulletList(t.pitfalls.map(String), 7, false));
    const vids = (t.labVideos || []).filter((v) => !isPlaceholderVideo(v));
    if (vids.length) body.append(dh('Videos'), bulletList(vids.map((v) => v.title), 7, false));
    if (t.furtherReading && t.furtherReading.length) body.append(dh('Further reading'), h('ul', { class: 'bl' }, t.furtherReading.filter((l) => safeUrl(l.url)).map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label)))));
    dd.append(body);
    root.append(dd);
    reveal(root);
  }

  function flowStepper(steps) {
    let cur = 0;
    const lis = steps.map((s) => h('li', null, s));
    const status = h('p', { class: 'cat', role: 'status' });
    const paint = () => {
      lis.forEach((li, i) => { li.classList.toggle('on', i === cur); if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      status.textContent = `Step ${cur + 1} of ${steps.length}`;
    };
    const mv = (d) => { cur = Math.min(steps.length - 1, Math.max(0, cur + d)); paint(); };
    paint();
    return h('div', { class: 'fs' }, h('ol', { class: 'stepper' }, lis), status,
      h('div', { class: 'flowbar' }, h('button', { type: 'button', class: 'btn', onclick: () => mv(-1) }, 'Previous step'), h('button', { type: 'button', class: 'btn primary', onclick: () => mv(1) }, 'Next step')));
  }


  // ---------- "What I built" icon grid (AWS) ----------
  const SVGS = {
    vpc: '<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2"/><rect x="6.5" y="8" width="4.5" height="4.5" rx=".8"/><rect x="13" y="12" width="4.5" height="4.5" rx=".8"/>',
    igw: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
    nat: '<rect x="9" y="4" width="6" height="16" rx="1.5"/><path d="M2.5 9h9M8 6l3.5 3L8 12M21.5 15h-9M16 12l-3.5 3 3.5 3"/>',
    acm: '<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M7 9h6M7 12h4"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M15.2 17.6 14.5 21l2-1 2 1-.7-3.4"/>',
    ssm: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 10 3 2.5L7 15M12.5 15.5H17"/>',
    param: '<path d="M8 4.5C6 4.5 6 6 6 8s0 3-2 4c2 1 2 2 2 4s0 3.5 2 3.5M16 4.5c2 0 2 1.5 2 3.5s0 3 2 4c-2 1-2 2-2 4s0 3.5-2 3.5"/><circle cx="12" cy="11" r="1.6"/><path d="M12 12.6V16"/>',
    cf: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 2.5"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
    iam: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="18" cy="9" r="1.8"/><path d="M18 10.8V16m0 0h2m-2 2.5h2"/>'
  };
  function svgTile(key) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', '#fff');
    s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = SVGS[key] || '';
    return s;
  }
  const OR = '#4285f4', PU = '#ea4335', GR = '#34a853';
  const AWS_BUILT = [
    ['VPC', 'svg:vpc', OR, 'Public and private subnets with an internet gateway'],
    ['NAT Gateway', 'svg:nat', OR, 'Private instances reach out without being reachable'],
    ['EC2', 'amazonec2', OR, 'Private instance with no public IP address'],
    ['Session Manager', 'svg:ssm', PU, 'Shell access without SSH or open ports'],
    ['Load Balancer', 'awselasticloadbalancing', OR, 'HTTPS listener with target health checks'],
    ['ACM', 'svg:acm', PU, 'Managed TLS certificates for the load balancer'],
    ['Route 53', 'amazonroute53', OR, 'Domain pointed at the load balancer'],
    ['S3', 'amazons3', GR, 'Private bucket holding the React build'],
    ['CloudFront', 'svg:cf', OR, 'CDN in front of S3 using origin access control'],
    ['CloudWatch', 'amazoncloudwatch', PU, 'Logs, metrics and ALB 4xx/5xx alarms via SNS'],
    ['Parameter Store', 'svg:param', PU, 'Secrets kept out of the repository'],
    ['IAM roles', 'svg:iam', PU, 'Instance profile enabling Session Manager access'],
    ['Nginx + Let’s Encrypt', 'nginx', '#009639', 'Reverse proxy with Let’s Encrypt TLS']
  ];
  function tileIcon(key, color) {
    const bi = h('span', { class: 'bi', style: `--tile:${color}` });
    if (key.startsWith('svg:')) bi.append(svgTile(key.slice(4)));
    else { const g = glyph(key, key); bi.append(g); }
    return bi;
  }
  function awsBuilt() {
    const flow = [['Route 53', 'amazonroute53', OR, ''], ['ALB', 'awselasticloadbalancing', OR, ''], ['Nginx container', 'nginx', '#009639', ''],
      ['App containers', 'docker', '#2496ed', ''], ['MongoDB Atlas', 'mongodb', '#47a248', 'NAT egress IP allow-list']];
    const strip = h('div', { class: 'pathstrip', role: 'list', 'aria-label': 'Request path' });
    flow.forEach(([n, k, c, sub], i) => {
      if (i) strip.append(h('span', { class: 'ar', 'aria-hidden': 'true' }, '→'));
      strip.append(h('div', { class: 'ps', role: 'listitem' }, tileIcon(k, c), h('strong', null, n), sub ? h('small', null, sub) : null));
    });
    return h('section', { 'aria-labelledby': 'built-h' }, h('div', { class: 'sec' }, h('h2', { id: 'built-h' }, 'What I built on AWS')),
      h('div', { class: 'built' }, AWS_BUILT.map(([n, k, c, o]) => h('div', { class: 'bt rv' }, tileIcon(k, c), h('h3', null, n), h('p', null, o)))),
      h('div', { class: 'sec mt6' }, h('h2', null, 'Request path')), strip);
  }
  function miniIcons() {
    return h('div', { class: 'mini' }, [['svg:vpc', OR], ['amazonec2', OR], ['amazonroute53', OR], ['amazons3', GR], ['svg:cf', OR], ['amazoncloudwatch', PU]].map(([k, c]) => tileIcon(k, c)));
  }


  // ---------- Three.js flow showcase (lazy, fails soft) ----------
  const curTheme = () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const themeSubs = new Set();
  // home architecture toggles: Architecture v1 | v2, and (v2 only) Infrastructure OpenStack | VMware ESXi | AWS
  const INFRA = [['openstack', 'OpenStack'], ['esxi', 'VMware ESXi'], ['aws', 'AWS']];
  function homeState() {
    const st = { arch: 'v2', infra: 'openstack' };
    try { const o = JSON.parse(sessionStorage.getItem('home-arch') || '{}'); if (o.arch === 'v1' || o.arch === 'v2') st.arch = o.arch; if (INFRA.some(([k]) => k === o.infra)) st.infra = o.infra; } catch (e) { /* ignore */ }
    try {
      const q = new URLSearchParams(location.search), hq = location.hash.includes('?') ? new URLSearchParams(location.hash.split('?')[1]) : new URLSearchParams();
      const a = q.get('arch') || hq.get('arch'), i = q.get('infra') || hq.get('infra');
      if (a === 'v1' || a === 'v2') st.arch = a; if (INFRA.some(([k]) => k === i)) st.infra = i;
    } catch (e) { /* ignore */ }
    return st;
  }
  function saveHomeState(st) {
    try { sessionStorage.setItem('home-arch', JSON.stringify(st)); } catch (e) { /* ignore */ }
    try { const u = new URL(location.href); u.searchParams.set('arch', st.arch); if (st.arch === 'v2') u.searchParams.set('infra', st.infra); else u.searchParams.delete('infra'); history.replaceState(history.state, '', u.toString()); } catch (e) { /* ignore */ }
  }
  function segmented(label, opts, get, set) {
    const grp = h('div', { class: 'seg', role: 'group', 'aria-label': label }), btns = [];
    const paint = () => btns.forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === get())));
    opts.forEach(([k, t]) => { const b = h('button', { type: 'button', 'aria-pressed': 'false' }, t); b.addEventListener('click', () => { if (get() !== k) { set(k); paint(); } }); btns.push([k, b]); grp.append(b); });
    paint();
    return h('div', { class: 'flow-ctl' }, h('span', { class: 'flow-ctl-l' }, label), grp);
  }
  // phone layout of the home stack: a 3D scene this wide is not legible at 390px, so show the same layers as a clean vertical stack of cards with the real logos
  const NARROW = () => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } };
  function mobileStack(sp) {
    const order = [4, 3, 2, 5, 6, 1, 0], have = new Set((sp.layers || []).map((l) => l.layer));
    const keys = order.every((k) => have.has(k)) ? order : (sp.layers || []).map((l) => l.layer).sort((x, y) => y - x);
    const wrap = h('div', { class: 'mstack' });
    keys.forEach((k, i) => {
      const L = (sp.layers || []).find((l) => l.layer === k); if (!L) return;
      const items = sp.boxes.filter((b) => b.layer === k).sort((x, y) => (x.row - y.row) || (x.col - y.col));
      const tiles = items.map((b) => {
        const inner = String(b.icon || '').startsWith('actor-') ? h('span', { class: 'mono' }, (b.label || '?').slice(0, 1)) : glyph(b.icon, b.label);
        const tag = b.href && String(b.href).startsWith('#/') ? 'a' : 'div';
        const el = h(tag, { class: 'mtile', title: b.says || b.label }, h('span', { class: 'mico' }, inner), h('span', { class: 'mlbl' }, b.label + (b.replicas > 1 ? ' ×' + b.replicas : '')));
        if (tag === 'a') el.setAttribute('href', b.href);
        el.style.setProperty('--bc', (curTheme() === 'light' && COLORS_LIGHT[b.icon]) || COLORS[b.icon] || '#8ab4f8');
        return el;
      });
      wrap.append(h('section', { class: 'mlayer' }, h('h3', null, L.label), h('div', { class: 'mrow' }, tiles)));
      if (i < keys.length - 1) wrap.append(h('div', { class: 'mflow', 'aria-hidden': 'true' }, '↓'));
    });
    return wrap;
  }
  async function flowSection(slug, home, name) {
    const hs = home ? homeState() : null; hs && (hs.arch = 'v2'); // v1 removed: home is always the v2 stack; only the Infrastructure toggle remains
    const slugOf = () => (!home ? slug : hs.arch === 'v1' ? 'home' : `home-v2-${hs.infra}`);
    const okSpec = (sp) => sp && typeof sp === 'object' && Array.isArray(sp.boxes);
    let spec = await getJSON(`data/flow/${encodeURIComponent(slugOf())}.json`);
    if (!okSpec(spec)) return null;
    const host = h('div', { class: 'flow-host' });
    const head = home ? h('div', { class: 'sec' }, eb('// platform', h('h2', { id: 'fl-h' }, 'The stack, layer by layer')))
      : h('div', { class: 'sec' }, eb('// flow', h('h2', null, 'Flow')));
    let bar = null, infraBar = null, handle = null, gen = 0;
    const remount = async () => {
      if (!handle && !host.firstChild) return; // not mounted (off screen): the next lazy mount reads the new state
      const my = ++gen;
      try { if (handle && handle.unmount) handle.unmount(); } catch (e) { /* ignore */ } handle = null; host.replaceChildren(); if (chipBar) chipBar.replaceChildren();
      const sp = await getJSON(`data/flow/${slugOf()}.json`);
      if (my !== gen || !okSpec(sp)) return;
      if (home && NARROW()) { host.replaceChildren(mobileStack(sp)); return; }
      const m = await import(`./hero3d/flow3d.js?v=${ASSET_V}`);
      if (my !== gen) return;
      handle = await m.mountFlow(host, sp, { theme: curTheme(), flyIn: false }); setChips(handle);
    };
    let chipBar = null;
    const setChips = (hd) => {
      if (!chipBar) return; chipBar.replaceChildren();
      if (!hd || !hd.layerList) return;
      const list = [[null, 'All'], ...hd.layerList().map((l) => [l.key, l.label])], btns = [];
      const paint = (k) => btns.forEach(([kk, b]) => b.setAttribute('aria-pressed', String(kk === k)));
      list.forEach(([k, t], i) => {
        const b = h('button', { type: 'button', class: 'chip-l', 'aria-pressed': String(k === null) }, t);
        b.addEventListener('click', () => { if (hd.setLayerFocus) hd.setLayerFocus(k); paint(k); });
        b.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); const n = btns[(i + d + btns.length) % btns.length][1]; n.focus(); n.click(); });
        btns.push([k, b]); chipBar.append(b);
      });
      host.onflowlayer = (k) => paint(k);
      try { const n = Number(new URLSearchParams(location.search).get('layer')); if (n >= 1 && n < btns.length) setTimeout(() => btns[n][1].click(), 400); } catch (e) { /* ignore */ } // deep link: ?layer=1..N focuses that chip
    };
    host.addEventListener('flow3d:layer', (e) => { if (host.onflowlayer) host.onflowlayer(e.detail ? e.detail.key : null); });
    if (home) {
      chipBar = h('div', { class: 'flow-chips', role: 'group', 'aria-label': 'Focus a layer' });
      const sync = () => { saveHomeState(hs); remount(); };
      infraBar = segmented('Infrastructure', INFRA, () => hs.infra, (k) => { hs.infra = k; sync(); });
      bar = h('div', { class: 'flow-bar' }, infraBar);
      saveHomeState(hs);
    }
    const wrap = h('section', { class: 'flow-sec' + (home ? ' home' : ''), 'aria-label': home ? 'Stack' : 'Flow' }, head, bar, chipBar, host);
    host.addEventListener('flow3d:open', (e) => { const hr = e.detail && e.detail.href; if (typeof hr === 'string' && hr.startsWith('#/')) navigate(hr); });
    const sub = (t) => { try { if (handle && handle.setTheme) handle.setTheme(t); } catch (e) { /* ignore */ } };
    themeSubs.add(sub); cleanups.push(() => themeSubs.delete(sub));
    lazy3D(wrap, async () => {
      const m = await import(`./hero3d/flow3d.js?v=${ASSET_V}`);
      const sp = home ? (await getJSON(`data/flow/${slugOf()}.json`)) || spec : spec;
      if (home && NARROW()) { host.replaceChildren(mobileStack(sp)); return; }
      handle = await m.mountFlow(host, sp, { theme: curTheme() }); setChips(handle);
    }, () => { try { if (handle && handle.unmount) handle.unmount(); } catch (e) { /* ignore */ } handle = null; host.replaceChildren(); }, () => { wrap.remove(); });
    return wrap;
  }
  function declList(arr) {
    const rows = arr.map((t) => h('div', { class: 'dl', 'aria-hidden': 'true' }, h('span', { class: 'dg' }, '>'), h('span', { class: 'dt' }, t)));
    const box = h('div', { class: 'card decl' }, h('span', { class: 'sr-only' }, arr.join(' ')), rows);
    return box;
  }

  // ---------- misc ----------
  function labStrip() {
    return h('section', { 'aria-label': 'DevOps Lab' }, h('div', { class: 'strip' }, h('strong', null, 'Lab'), h('span', { class: 'badge soon' }, 'Coming soon')));
  }
  function labPage(root) { root.append(h('h1', { class: 'big-h' }, 'DevOps Lab'), labStrip()); }

  function connectCard() {
    return h('section', { 'aria-labelledby': 'cn-h', id: 'connect' }, h('div', { class: 'sec' }, eb('// connect', h('h2', { id: 'cn-h' }, 'Connect'))),
      h('div', { class: 'card connect' },
        h('div', { class: 'chips' }, h('a', { class: 'btn primary', href: LINKEDIN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'LinkedIn'),
          h('a', { class: 'btn', href: GITHUB, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'))));
  }
  function connectPage(root) { root.append(h('h1', { class: 'big-h' }, 'Connect'), connectCard()); }

  async function overview(root) {
    root.append(hero());
    const [posts, idx, workData, career, home] = await Promise.all([loadBlogs(), loadIndex(), loadWork(), loadCareer(), flowSection('home', true)]);
    const projects = workData.projects.slice().sort((a, b) => workRank(a) - workRank(b));
    root.append(h('div', { class: 'kpis' },
      [['6+', 'years'], ['400 req/s', 'at p95 < 50 ms'], ['20+', 'technologies'], ['AWS', 'Certified Cloud Practitioner']]
        .map(([v, k]) => h('div', { class: 'kpi' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k)))));
    if (home) root.append(home);
    if (career) root.append(careerCompact(career));
    if (projects && projects.length) {
      root.append(h('section', { 'aria-labelledby': 'wk-h' }, h('div', { class: 'sec' }, eb('// work', h('h2', { id: 'wk-h' }, 'Selected work')), h('a', { class: 'more', href: '#/work' }, 'All work \u2192')),
        h('div', { class: 'grid work' }, projects.slice(0, 3).map((p) => workCard(p, null)))));
    }
    const shown = [{ title: 'How does a service mesh work?', summary: 'Sidecars, control plane and traffic policy, explained from the basics.', tags: ['Istio', 'Kubernetes'], date: '', url: null, soon: true }].concat(sortedPosts(posts));
    const c = carousel(shown);
    root.append(h('section', { 'aria-labelledby': 'bl-h' }, h('div', { class: 'sec' }, eb('// writing', h('h2', { id: 'bl-h' }, 'Writing')), c.ctl), h('div', { class: 'carousel-wrap' }, c.track), c.prog));
    if (idx && idx.length) {
      root.append(h('section', { 'aria-labelledby': 'tc-h' }, h('div', { class: 'sec' }, eb('// stack', h('h2', { id: 'tc-h' }, 'Technologies')), h('a', { class: 'more', href: '#/technologies' }, 'All \u2192')),
        h('div', { class: 'grid icons' }, idx.map(techCard))));
    }
    root.append(labStrip());
    root.append(connectCard());
    reveal(root);
  }

  // ---------- router ----------
  const state = { q: '' };
  const view = $('#view');
  const titles = { overview: 'Overview', technologies: 'Technologies', work: 'Work', career: 'Career', writing: 'Writing', lab: 'DevOps Lab', connect: 'Connect' };
  const OUT_MS = 80; // fade-out; the fade-in (120 ms) lives in CSS (#view transition)
  let token = 0, curRoute = null, pushIntent = false, pushTimer = 0, lastY = 0, firstRender = true, rendering = false;
  const scrollPos = new Map(); // route key -> scrollY
  try { history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }
  addEventListener('scroll', () => { if (!rendering) lastY = window.scrollY; }, { passive: true });

  // A navigation we start (link click or navigate()) is a 'push'; anything else (back/forward) is a 'pop'.
  function markPush() { pushIntent = true; clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushIntent = false; }, 600); }
  function navigate(hash) { if (location.hash === hash) return; markPush(); location.hash = hash; }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    if (a.getAttribute('href') !== location.hash) markPush();
  }, true);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function onNav() { go({ type: pushIntent ? 'push' : 'pop', hash: location.hash }); }
  function go(event) {
    const prev = curRoute;
    const n = nextRoute(prev, event);
    if (!n.render) return;
    if (prev) scrollPos.set(prev.key, lastY);
    curRoute = n.route;
    pushIntent = false;
    render(n.route, n.scroll);
  }

  async function render(rt, scrollMode) {
    const my = ++token;
    rendering = true;
    const parts = rt.name === 'overview' ? [] : rt.name === 'tech' ? ['tech', rt.slug] : [rt.name];
    const name = rt.name === 'tech' ? 'technologies' : rt.name;
    if (!firstRender) { view.classList.add('rt-out'); if (!reduced()) await sleep(OUT_MS); if (my !== token) return; }
    runCleanups(); ticker.clear();
    if (heroMod) { try { heroMod.unmountHero(); } catch (e) { /* ignore */ } }
    document.title = (titles[name] || 'Hasan Imam') + ' | Hasan Imam';
    const root = h('div');
    try {
      if (rt.name === 'overview') await overview(root);
      else if (rt.name === 'tech') await techPage(root, rt.slug);
      else if (rt.name === 'technologies') await technologies(root);
      else if (rt.name === 'work') await projectsPage(root);
      else if (rt.name === 'career') await careerPage(root);
      else if (rt.name === 'writing') await blogsPage(root);
      else if (rt.name === 'lab') labPage(root);
      else if (rt.name === 'connect') connectPage(root);
      else root.append(h('h1', { class: 'big-h' }, 'Not found'), h('div', { class: 'empty' }, 'No such page. ', h('a', { href: '#/' }, 'Back to overview')));
    } catch (e) {
      root.append(comingCard('Something went wrong loading this page.'));
    }
    if (my !== token) { runCleanups(); return; }
    view.replaceChildren(root);
    if (scrollMode !== 'none') window.scrollTo(0, scrollMode === 'restore' ? (scrollPos.get(rt.key) || 0) : 0);
    lastY = window.scrollY; rendering = false;
    if (world) { try { world.setRoute(worldRoute(parts)); world.pulse && world.pulse(0.5, 0.5); } catch (e) { /* ignore */ } }
    reveal(root);
    document.querySelectorAll('#nav a').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    closeMenu();
    if (!firstRender) view.focus({ preventScroll: true });
    firstRender = false;
    requestAnimationFrame(() => view.classList.remove('rt-out'));
  }
  const route = () => go({ type: 'force', hash: location.hash });

  // search
  const search = $('#search');
  search.addEventListener('input', () => {
    state.q = search.value;
    if (!location.hash.startsWith('#/technologies')) navigate('#/technologies'); else route();
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; state.q = ''; if (location.hash.startsWith('#/technologies')) route(); } });

  // menu
  const sidebar = $('#sidebar'), scrim = $('#scrim'), menuBtn = $('#menu-btn');
  function closeMenu() { sidebar.classList.remove('open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const o = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', o); scrim.hidden = !o; menuBtn.setAttribute('aria-expanded', String(o)); });
  scrim.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // theme (dark is the default)
  const themeBtn = $('#theme-btn');
  try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  { const q = new URLSearchParams(location.search).get('theme'); if (q === 'light' || q === 'dark') document.documentElement.dataset.theme = q; }
  const isLight = () => curTheme() === 'light';
  function setTheme(next, persist) {
    document.documentElement.dataset.theme = next;
    themeBtn.setAttribute('aria-pressed', String(next === 'light'));
    if (persist !== false) { try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ } }
    if (world && world.setTheme) { try { world.setTheme(next); } catch (e) { /* ignore */ } }
    themeSubs.forEach((f) => f(next));
  }
  themeBtn.setAttribute('aria-pressed', String(isLight()));
  themeBtn.addEventListener('click', () => setTheme(isLight() ? 'dark' : 'light'));

  // command palette (Ctrl+K or /)
  function fuzzy(q, text) {
    q = q.toLowerCase().replace(/\s+/g, ' ').trim(); text = text.toLowerCase();
    if (!q) return 1;
    let ti = 0, score = 0, last = -2;
    for (const ch of q) {
      const k = text.indexOf(ch, ti);
      if (k < 0) return -1;
      score += (k === last + 1 ? 3 : 1) + (k === 0 || text[k - 1] === ' ' ? 2 : 0);
      last = k; ti = k + 1;
    }
    return score - text.length * 0.01;
  }
  async function openPalette() {
    if ($('#palette')) return;
    const prev = document.activeElement;
    const go = (hash) => () => { navigate(hash); };
    const cmds = [['overview', '#/'], ['career', '#/career'], ['work', '#/work'], ['writing', '#/writing'], ['technologies', '#/technologies'], ['connect', '#/connect'], ['lab', '#/lab']]
      .map(([n, hs]) => ({ label: 'cd ' + n, hint: 'go to page', run: go(hs) }));
    cmds.push({ label: 'goto connect', hint: 'LinkedIn and GitHub', run: go('#/connect') },
      { label: 'theme dark', hint: 'switch theme', run: () => setTheme('dark') }, { label: 'theme light', hint: 'switch theme', run: () => setTheme('light') });
    const input = h('input', { class: 'pal-in', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list', 'aria-label': 'Command palette', placeholder: 'cd career, open kong, theme light', autocomplete: 'off', spellcheck: 'false' });
    const list = h('ul', { id: 'pal-list', class: 'pal-list', role: 'listbox' });
    const dlg = h('div', { id: 'palette', class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
      h('div', { class: 'pal-row' }, h('span', { class: 'pal-p', 'aria-hidden': 'true' }, '>'), input), list, h('div', { class: 'pal-foot' }, '\u2191\u2193 move \u00b7 Enter run \u00b7 Esc close'));
    const ov = h('div', { class: 'pal-ov' }, dlg);
    let sel = 0, items = [];
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
    const render = () => {
      items = cmds.map((c) => ({ c, sc: fuzzy(input.value, c.label + ' ' + (c.hint || '')) })).filter((x) => x.sc >= 0).sort((a, b) => b.sc - a.sc).slice(0, 8).map((x) => x.c);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((c, i) => h('li', { id: 'pal-' + i, role: 'option', 'aria-selected': String(i === sel), class: 'pal-it' + (i === sel ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); run(c); } },
        h('span', null, c.label), h('small', null, c.hint || ''))));
      if (!items.length) list.append(h('li', { class: 'pal-none', role: 'presentation' }, 'no matches'));
      input.setAttribute('aria-activedescendant', items.length ? 'pal-' + sel : '');
    };
    const run = (c) => { close(); c.run(); };
    function onKey(e) {
      if (!ov.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
      else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
    }
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    input.addEventListener('input', () => { sel = 0; render(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(ov); render(); input.focus();
    const idx = await loadIndex();
    if (idx && ov.isConnected) { idx.forEach((t) => cmds.push({ label: 'open ' + t.name.toLowerCase(), hint: t.category || 'technology', run: go('#/tech/' + t.slug) })); render(); }
  }
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPalette(); }
  });
  const kbdBtn = $('#kbd-btn'); if (kbdBtn) kbdBtn.addEventListener('click', openPalette);

  // easter egg: Konami code or 5 quick clicks on the logo -> matrix rain over the banner for 3 s
  function matrixRain() {
    const hero = $('.hero');
    if (!hero || reduced() || $('.rain', hero)) return;
    const cv = h('canvas', { class: 'rain', 'aria-hidden': 'true' }); hero.append(cv);
    const w = cv.width = hero.clientWidth, hh = cv.height = hero.clientHeight, g = cv.getContext('2d');
    const cols = Math.floor(w / 14), drops = Array.from({ length: cols }, () => Math.random() * -20);
    const chars = '01{}[]<>/=;$#ABCDEF'; const t0 = performance.now();
    (function frame(t) {
      if (!cv.isConnected) return;
      if (t - t0 > 3000) { cv.remove(); return; }
      g.fillStyle = 'rgba(32,33,36,.16)'; g.fillRect(0, 0, w, hh); g.fillStyle = '#34a853'; g.font = '14px monospace';
      drops.forEach((y, i) => { g.fillText(chars[(Math.random() * chars.length) | 0], i * 14, y * 14); drops[i] = y * 14 > hh && Math.random() > 0.96 ? 0 : y + 1; });
      requestAnimationFrame(frame);
    })(t0);
  }
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let kpos = 0;
  document.addEventListener('keydown', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; kpos = k === KONAMI[kpos] ? kpos + 1 : (k === KONAMI[0] ? 1 : 0); if (kpos === KONAMI.length) { kpos = 0; matrixRain(); } });
  let logoClicks = [];
  const logo = $('.logo'); if (logo) logo.addEventListener('click', () => { const n = Date.now(); logoClicks = logoClicks.filter((t) => n - t < 3000); logoClicks.push(n); if (logoClicks.length >= 5) { logoClicks = []; setTimeout(matrixRain, 50); } });


  // ---------- immersion: world backdrop, scroll progress, tilt, parallax ----------
  let world = null;
  const worldRoute = (parts) => { const n = parts[0] === 'tech' ? 'tech' : (parts[0] || 'overview'); return ({ projects: 'work', blogs: 'writing' })[n] || n; };
  const sp = $('#sp');
  let scrollTick = false;
  function onScroll() {
    if (scrollTick) return; scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight), p = Math.min(1, Math.max(0, scrollY / max));
      if (sp) sp.style.width = (p * 100) + '%';
      if (world && world.setScroll) { try { world.setScroll(p); } catch (e) { /* ignore */ } }
    });
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const WORLD_ENABLED = false; // user: background world was too noisy; flip to true to bring it back
  if (WORLD_ENABLED && !reduced() && !saveData) {
    const parts0 = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    setTimeout(() => import(`./hero3d/world.js?v=${ASSET_V}`).then((m) => m.mountWorld({ theme: curTheme() })).then((w) => { world = w || null; if (world) { world.setRoute && world.setRoute(worldRoute(parts0)); onScroll(); } }).catch(() => { /* optional */ }), 700);
  }
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  go({ type: 'init', hash: location.hash });
})();
