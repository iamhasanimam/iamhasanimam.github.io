/* flow-fx.js - pure helpers for flow3d (no DOM, no three.js): lightning arcs and inner-part layout. */

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Electric arc from a to b: points[0] === a, points[last] === b, 6 to 9 segments (seeded), jitter perpendicular to a->b,
 * tapering to zero at both ends. Deterministic for a given seed.
 */
export function arcPoints(a, b, seed, opts = {}) {
  const r = rng(seed * 2654435761 + 1), segs = opts.segments || 6 + Math.floor(r() * 4), jitter = opts.jitter ?? 0.12;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1e-6, ux = dx / len, uy = dy / len, uz = dz / len;
  // perpendicular basis: p1 = u x helper, p2 = u x p1
  const hx = Math.abs(uy) > 0.9 ? 1 : 0, hy = hx ? 0 : 1;
  let p1x = uy * 0 - uz * hy, p1y = uz * hx - ux * 0, p1z = ux * hy - uy * hx; const pl = Math.hypot(p1x, p1y, p1z) || 1; p1x /= pl; p1y /= pl; p1z /= pl;
  const p2x = uy * p1z - uz * p1y, p2y = uz * p1x - ux * p1z, p2z = ux * p1y - uy * p1x;
  const amp = jitter * Math.min(len, 3), out = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, env = Math.sin(Math.PI * t), j1 = (r() - 0.5) * 2 * amp * env, j2 = (r() - 0.5) * 2 * amp * env;
    if (i === 0) out.push({ x: a.x, y: a.y, z: a.z }); else if (i === segs) out.push({ x: b.x, y: b.y, z: b.z });
    else out.push({ x: a.x + dx * t + p1x * j1 + p2x * j2, y: a.y + dy * t + p1y * j1 + p2y * j2, z: a.z + dz * t + p1z * j1 + p2z * j2 });
  }
  return out;
}

/** Position inner parts in flow order along a gentle curve (local coordinates, centred on x). */
export function innerLayout(parts, opts = {}) {
  const size = opts.size ?? 0.5, minGap = opts.minGap ?? 1, curve = opts.curve ?? 0.35, pitch = Math.max(opts.pitch ?? 1.5, size + minGap + curve * 0.6), n = (parts || []).length;
  return (parts || []).map((p, i) => {
    const u = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
    return { id: p.id || `p${i}`, label: p.label || p.id || `Part ${i + 1}`, pos: { x: (i - (n - 1) / 2) * pitch, y: 0, z: -curve * (1 - u * u) }, size };
  });
}
