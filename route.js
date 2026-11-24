/* Pure routing helpers (no DOM). Used by app.js and tests/router.test.mjs. */
const ALIAS = { projects: 'work', blogs: 'writing' };
const KNOWN = new Set(['overview', 'career', 'work', 'writing', 'technologies', 'lab', 'connect']);

export function parseRoute(hash) {
  let h = typeof hash === 'string' ? hash : '';
  h = h.replace(/^#/, '');
  const qi = h.indexOf('?');
  const qs = qi >= 0 ? h.slice(qi + 1) : '';
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const query = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  if (path && !path.startsWith('/')) return { name: 'anchor', slug: null, key: '#' + path, query, notFound: false, anchor: true };
  const parts = path.split('/').filter(Boolean);
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  if (!parts.length) return { name: 'overview', slug: null, key: 'overview', query, notFound: false, anchor: false };
  let name = ALIAS[parts[0]] || parts[0];
  if (name === 'tech') {
    if (!parts[1]) return { name: 'technologies', slug: null, key: 'technologies', query, notFound: false, anchor: false };
    const slug = dec(parts[1]);
    return { name: 'tech', slug, key: 'tech/' + slug, query, notFound: false, anchor: false };
  }
  if (KNOWN.has(name)) return { name, slug: null, key: name, query, notFound: false, anchor: false };
  return { name: 'notfound', slug: null, key: 'notfound/' + parts.join('/'), query, notFound: true, anchor: false };
}

/* prev: route object or null. event: { type: 'init'|'push'|'pop'|'force', hash }.
   Returns { route, render, scroll: 'top'|'restore'|'none', redirect: null }. Never redirects. */
export function nextRoute(prev, event) {
  const route = parseRoute(event.hash);
  if (route.anchor) return { route: prev || parseRoute(''), render: false, scroll: 'none', redirect: null };
  if (event.type === 'init') return { route, render: true, scroll: 'none', redirect: null };
  if (event.type === 'force') return { route, render: true, scroll: 'none', redirect: null };
  if (prev && prev.key === route.key) return { route, render: false, scroll: 'none', redirect: null };
  return { route, render: true, scroll: event.type === 'pop' ? 'restore' : 'top', redirect: null };
}
