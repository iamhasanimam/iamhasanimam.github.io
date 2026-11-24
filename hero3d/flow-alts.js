// flow-alts: "Choose your stack" consultancy panel for the 3D flow scene.
// mountAlts(container, handle, opts) -> { supported, destroy() }
//   handle needs getBoxes() and swapTech(); focus() is optional. Host events used: flow3d:hover, flow3d:pick.
// opts: { host: element that dispatches flow3d:* (default: container), icon(slug,label) -> Node (optional), title }
const ICON_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@11.14.0/icons/';
const ZONES = [['edge', 'Edge'], ['api', 'API / Ops'], ['cluster', 'Cluster'], ['data', 'Data'], ['observ', 'Observability'], ['infra', 'Infrastructure']];
const zoneKey = (z) => { const s = String(z || '').toLowerCase(); const f = ZONES.find(([k]) => s.includes(k)); return f ? f[0] : null; };
const isActor = (s) => String(s || '').startsWith('actor-');

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
function logo(slug, label, custom) {
  if (custom) { try { const n = custom(slug, label); if (n) return n; } catch (e) { /* fall through */ } }
  if (!slug || !/^[a-z0-9._-]+$/i.test(slug)) return el('span', { class: 'fa-mono', 'aria-hidden': 'true' }, (label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase());
  const s = el('span', { class: 'fa-logo', 'aria-hidden': 'true' });
  s.style.setProperty('--fa-m', `url("${ICON_CDN}${encodeURIComponent(slug)}.svg")`);
  return s;
}

try { if (!document.querySelector('link[href*="flow-alts.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./flow-alts.css', import.meta.url).href; document.head.appendChild(l); } } catch (e) { /* host css */ }

export function mountAlts(container, handle, opts = {}) {
  const none = { destroy() {}, supported: false };
  if (!handle || typeof handle.getBoxes !== 'function' || typeof handle.swapTech !== 'function') return none;
  const host = opts.host || container, can = (m) => typeof handle[m] === 'function';
  let boxes = [];
  try { boxes = (handle.getBoxes() || []).filter((b) => !isActor(b.icon) && zoneKey(b.zone)); } catch (e) { boxes = []; }
  if (!boxes.length) return none;

  const defaults = new Map(boxes.map((b) => [b.id, { label: b.label, tech: b.tech, icon: b.icon }]));
  const chosen = new Map(); // id -> alt label
  const rows = new Map(); // id -> { row, head, body, chips, name, ico }
  const root = el('aside', { class: 'fa-panel', 'aria-label': opts.title || 'Choose your stack' });
  const reset = el('button', { type: 'button', class: 'fa-reset', hidden: true }, 'Reset');
  const head = el('div', { class: 'fa-head' }, el('h3', { class: 'fa-title' }, opts.title || 'Choose your stack'), reset);
  const sub = el('p', { class: 'fa-sub' }, 'Hover to focus a technology. Pick an alternative to swap it in the scene.');
  const list = el('div', { class: 'fa-list' });
  root.append(head, sub, list);

  const focus = (id) => { if (can('focus')) { try { handle.focus(id); } catch (e) { /* ignore */ } } };
  const mark = (id) => rows.forEach((r, k) => r.row.classList.toggle('is-hot', k === id));
  const open = (id, on) => { const r = rows.get(id); if (!r || !r.body) return; r.body.hidden = !on; r.head.setAttribute('aria-expanded', String(on)); r.row.classList.toggle('is-open', on); };

  const apply = (id, alt) => {
    const d = defaults.get(id), r = rows.get(id); if (!d || !r) return;
    const t = alt || { label: d.label, tech: d.tech, icon: d.icon };
    try { handle.swapTech(id, { label: t.label, tech: t.tech || t.label, icon: t.icon || null }); } catch (e) { /* ignore */ }
    if (alt) chosen.set(id, alt.label); else chosen.delete(id);
    const cur = chosen.get(id);
    r.chips.forEach(({ btn, alt: a }) => btn.setAttribute('aria-pressed', String(cur ? a.label === cur : !!a.isDefault)));
    r.name.textContent = cur || d.label;
    r.ico.replaceChildren(logo(alt ? alt.icon : d.icon, cur || d.label, opts.icon));
    reset.hidden = chosen.size === 0;
    r.row.classList.toggle('is-swapped', !!cur);
  };

  ZONES.forEach(([zk, zl]) => {
    const items = boxes.filter((b) => zoneKey(b.zone) === zk);
    if (!items.length) return;
    const sec = el('section', { class: 'fa-zone' }, el('h4', { class: 'fa-zname' }, zl));
    items.forEach((b) => {
      const alts = Array.isArray(b.alts) ? b.alts.filter((a) => a && a.label) : [];
      const ico = el('span', { class: 'fa-ico' }, logo(b.icon, b.label, opts.icon));
      const name = el('span', { class: 'fa-name' }, b.label);
      const tag = el('span', { class: 'fa-role' }, b.tech && b.tech !== b.label ? b.tech : '');
      const headBtn = el(alts.length ? 'button' : 'div', { class: 'fa-rowhead', type: alts.length ? 'button' : null, 'aria-expanded': alts.length ? 'false' : null }, ico, el('span', { class: 'fa-txt' }, name, tag), alts.length ? el('span', { class: 'fa-caret', 'aria-hidden': 'true' }) : null);
      const row = el('div', { class: 'fa-row', 'data-id': b.id }, headBtn);
      const rec = { row, head: headBtn, body: null, chips: [], name, ico };
      if (alts.length) {
        const body = el('div', { class: 'fa-chips', role: 'group', 'aria-label': 'Alternatives to ' + b.label, hidden: true });
        const all = [{ label: b.label, tech: b.tech, icon: b.icon, isDefault: true }, ...alts.filter((a) => a.label !== b.label)];
        all.forEach((a) => {
          const btn = el('button', { type: 'button', class: 'fa-chip', 'aria-pressed': String(!!a.isDefault) }, logo(a.icon, a.label, opts.icon), el('span', null, a.label));
          btn.addEventListener('click', () => apply(b.id, a.isDefault ? null : a));
          btn.addEventListener('mouseenter', () => focus(b.id)); btn.addEventListener('focus', () => focus(b.id));
          rec.chips.push({ btn, alt: a }); body.append(btn);
        });
        rec.body = body; row.append(body);
        headBtn.addEventListener('click', () => open(b.id, body.hidden));
      }
      headBtn.addEventListener('mouseenter', () => focus(b.id)); headBtn.addEventListener('focus', () => focus(b.id));
      row.addEventListener('mouseleave', () => { if (!row.contains(document.activeElement)) focus(null); });
      row.addEventListener('focusout', (e) => { if (!row.contains(e.relatedTarget)) focus(null); });
      rows.set(b.id, rec); sec.append(row);
    });
    list.append(sec);
  });

  reset.addEventListener('click', () => { [...chosen.keys()].forEach((id) => apply(id, null)); focus(null); });

  const onHover = (e) => { mark((e.detail && e.detail.id) || null); };
  const onPick = (e) => {
    const id = e.detail && e.detail.id, r = rows.get(id); if (!r) return;
    rows.forEach((_, k) => open(k, k === id)); mark(id);
    try { r.row.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (err) { /* ignore */ }
  };
  host.addEventListener('flow3d:hover', onHover); host.addEventListener('flow3d:pick', onPick);
  container.append(root);
  return {
    supported: true,
    destroy() { host.removeEventListener('flow3d:hover', onHover); host.removeEventListener('flow3d:pick', onPick); root.remove(); },
  };
}
