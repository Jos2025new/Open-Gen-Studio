import type { Pt, Seg } from './pathNodes';

/*
 * Polyline -> cubic Bézier fitting for paths that come out of polygon boolean operations (flattened curves), so a
 * result is a few smooth curves instead of hundreds of straight segments. Schneider, "An Algorithm for Automatically
 * Fitting Digitized Curves" (Graphics Gems, 1990): chord-length parameters, least-squares handle lengths, Newton
 * reparameterisation and a split at the worst point. Corners (sharp turns) are kept sharp: runs are fitted between them.
 * Pure and total: bad input returns [] and nothing throws.
 */

export interface FitOptions {
  /** Maximum distance (same units as the points) between the input polyline and the result. */
  tolerance: number;
  /** Turn angle in degrees above which a vertex is a corner. Default 50. */
  cornerAngle?: number;
}

const MAX_REPARAM = 6;
const MAX_DEPTH = 48;
/** The fit works to this share of the tolerance, leaving room for the gap between sample points. */
const SAFETY = 0.85;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; };

type Cubic = [Pt, Pt, Pt, Pt];

function bez(c: Cubic, t: number): Pt {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, d = 3 * m * t * t, e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}
function bez1(c: Cubic, t: number): Pt {
  const m = 1 - t;
  const q0 = sub(c[1], c[0]), q1 = sub(c[2], c[1]), q2 = sub(c[3], c[2]);
  return [3 * (m * m * q0[0] + 2 * m * t * q1[0] + t * t * q2[0]), 3 * (m * m * q0[1] + 2 * m * t * q1[1] + t * t * q2[1])];
}
function bez2(c: Cubic, t: number): Pt {
  const m = 1 - t;
  const r0: Pt = [c[2][0] - 2 * c[1][0] + c[0][0], c[2][1] - 2 * c[1][1] + c[0][1]];
  const r1: Pt = [c[3][0] - 2 * c[2][0] + c[1][0], c[3][1] - 2 * c[2][1] + c[1][1]];
  return [6 * (m * r0[0] + t * r1[0]), 6 * (m * r0[1] + t * r1[1])];
}

function chordParams(pts: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const n = pts.length, p0 = pts[0], p3 = pts[n - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < n; i++) {
    const t = u[i], m = 1 - t;
    const b0 = m * m * m, b1 = 3 * t * m * m, b2 = 3 * t * t * m, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = len(sub(p3, p0));
  let aL = 0, aR = 0;
  if (Math.abs(det) > 1e-12) { aL = (x0 * c11 - x1 * c01) / det; aR = (c00 * x1 - c01 * x0) / det; }
  const eps = 1e-6 * seg;
  if (!(aL > eps) || !(aR > eps)) { aL = aR = seg / 3; } // Wu/Barsky fallback
  return [p0, add(p0, mul(t1, aL)), add(p3, mul(t2, aR)), p3];
}

function maxError(pts: Pt[], c: Cubic, u: number[]): { err: number; at: number } {
  let err = 0, at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const q = bez(c, u[i]), dx = q[0] - pts[i][0], dy = q[1] - pts[i][1], d = dx * dx + dy * dy;
    if (d >= err) { err = d; at = i; }
  }
  return { err, at };
}

function reparam(pts: Pt[], c: Cubic, u: number[]): number[] {
  return u.map((t, i) => {
    if (i === 0 || i === u.length - 1) return t;
    const q = bez(c, t), d1 = bez1(c, t), d2 = bez2(c, t);
    const dq = sub(q, pts[i]);
    const num = dot(dq, d1), den = dot(d1, d1) + dot(dq, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - num / den));
  });
}

/** Largest distance from the interior points to the chord of the run. */
function chordDeviation(pts: Pt[]): number {
  const a = pts[0], b = pts[pts.length - 1], d = sub(b, a), l = len(d);
  let m = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const v = sub(pts[i], a);
    const dist = l < 1e-12 ? len(v) : Math.abs(v[0] * d[1] - v[1] * d[0]) / l;
    if (dist > m) m = dist;
  }
  return m;
}

function fitRun(pts: Pt[], t1: Pt, t2: Pt, tol: number, out: Seg[], depth = 0): void {
  const n = pts.length, end = pts[n - 1];
  if (n < 2) return;
  if (n === 2 || chordDeviation(pts) <= tol * 0.5 && dot(t1, norm(sub(end, pts[0]))) > 0.99 && dot(t2, norm(sub(pts[0], end))) > 0.99) {
    out.push({ c: 'L', p: [end] });
    return;
  }
  const tol2 = tol * tol;
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let { err, at } = maxError(pts, c, u);
  if (err <= tol2) { out.push({ c: 'C', p: [c[1], c[2], c[3]] }); return; }
  if (err < tol2 * 16) {
    for (let i = 0; i < MAX_REPARAM; i++) {
      u = reparam(pts, c, u);
      c = generate(pts, u, t1, t2);
      ({ err, at } = maxError(pts, c, u));
      if (err <= tol2) { out.push({ c: 'C', p: [c[1], c[2], c[3]] }); return; }
    }
  }
  if (depth >= MAX_DEPTH || n < 4) { // cannot split further: keep the points as lines
    for (let i = 1; i < n; i++) out.push({ c: 'L', p: [pts[i]] });
    return;
  }
  const s = Math.min(n - 2, Math.max(1, at));
  const tc = norm(sub(pts[s - 1], pts[s + 1]));
  const tcSafe: Pt = tc[0] === 0 && tc[1] === 0 ? norm(sub(pts[s - 1], pts[s])) : tc;
  fitRun(pts.slice(0, s + 1), t1, tcSafe, tol, out, depth + 1);
  fitRun(pts.slice(s), mul(tcSafe, -1), t2, tol, out, depth + 1);
}

function clean(points: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  if (closed) while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  return out;
}

/** Turn angle (degrees) at vertex i. */
function turnAt(pts: Pt[], i: number, closed: boolean): number {
  const n = pts.length;
  const a = pts[closed ? (i + n - 1) % n : i - 1], b = pts[i], c = pts[closed ? (i + 1) % n : i + 1];
  const d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
  return Math.acos(Math.max(-1, Math.min(1, dot(d1, d2)))) * 180 / Math.PI;
}

function smoothTangent(pts: Pt[], i: number, closed: boolean): Pt {
  const n = pts.length;
  const a = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], c = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  return norm(sub(c, a));
}

/** Fit one subpath: M, then L/C segments, and Z when closed. Never throws; degenerate input gives []. */
export function fitPolyline(points: Pt[], closed: boolean, opts: FitOptions): Seg[] {
  try {
    if (!Array.isArray(points)) return [];
    const tolerance = Number.isFinite(opts?.tolerance) && opts.tolerance > 0 ? opts.tolerance : 0.25;
    const tol = tolerance * SAFETY;
    const cornerAngle = Number.isFinite(opts?.cornerAngle) ? (opts.cornerAngle as number) : 50;
    const pts = clean(points, closed);
    if (pts.length < 2) return [];
    const n = pts.length;
    const isClosed = closed && n >= 3;
    const out: Seg[] = [{ c: 'M', p: [pts[0]] }];

    // Corner indices
    const corners: number[] = [];
    for (let i = isClosed ? 0 : 1; i < (isClosed ? n : n - 1); i++) if (turnAt(pts, i, isClosed) > cornerAngle) corners.push(i);

    if (!isClosed) {
      const cuts = [0, ...corners, n - 1];
      runs(pts, cuts, false, tol, out, corners);
      return out;
    }
    let loop = pts, cs = corners;
    if (corners.length) { // rotate to start at the first corner
      const k = corners[0];
      loop = [...pts.slice(k), ...pts.slice(0, k)];
      cs = corners.map((c) => (c - k + n) % n).sort((a, b) => a - b);
    }
    const ext = [...loop, loop[0]];
    let best: Seg[] | null = null;
    // Smooth loop: joints with centred tangents; try 2..4 evenly spaced joints and keep the fewest segments.
    for (const joints of corners.length ? [0] : [2, 3, 4]) {
      const cuts = corners.length ? [...cs, n] : [...Array.from({ length: joints }, (_, j) => Math.floor((j * n) / joints)), n];
      const trial: Seg[] = [];
      runs(ext, cuts, true, tol, trial, corners.length ? cs : [], loop);
      if (!best || trial.length < best.length) best = trial;
    }
    out[0] = { c: 'M', p: [loop[0]] };
    out.push(...(best ?? []), { c: 'Z', p: [] });
    return out;
  } catch {
    return [];
  }
}

function runs(pts: Pt[], cuts: number[], closed: boolean, tol: number, out: Seg[], corners: number[], loop?: Pt[]): void {
  const cornerSet = new Set(corners);
  const base = loop ?? pts;
  const m = base.length;
  const tangentAt = (idx: number, dir: 1 | -1): Pt => {
    const i = closed ? idx % m : idx;
    if (cornerSet.has(i) || (!closed && (idx === 0 || idx === pts.length - 1))) {
      // one-sided tangent along the run
      const nb = closed ? base[(i + dir + m) % m] : pts[Math.min(pts.length - 1, Math.max(0, idx + dir))];
      return norm(sub(nb, base[closed ? i : idx]));
    }
    const t = smoothTangent(base, closed ? i : idx, closed);
    return mul(t, dir);
  };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b <= a) continue;
    const run = pts.slice(a, b + 1);
    if (run.length < 2) continue;
    fitRun(run, tangentAt(a, 1), tangentAt(b, -1), tol, out);
  }
}

/** Fit several subpaths (outer contours and holes) and concatenate them. */
export function fitSubpaths(loops: Array<{ points: Pt[]; closed: boolean }>, opts: FitOptions): Seg[] {
  const out: Seg[] = [];
  try {
    for (const l of loops ?? []) out.push(...fitPolyline(l.points, l.closed, opts));
  } catch { /* never throw */ }
  return out;
}
