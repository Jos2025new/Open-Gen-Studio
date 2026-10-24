/*
 * Calligraphic nib for Lineart, ported from Inkscape's Calligraphy tool (src/ui/tools/calligraphic-tool.cpp).
 *
 * Inkscape builds the stroke from two edge points per sample: brush ± width · ang (calligraphic-tool.cpp:342-346),
 * where `ang` is a unit vector along the nib. The thickness the eye sees, across the direction of travel, is therefore
 * width · |sin(angle of ang − angle of velocity)|. `ang` is a blend (calligraphic-tool.cpp:223-259):
 *   a1 = the fixed nib angle, wrapped into (−π/2, π/2]                      (:219-232)
 *   a2 = the direction perpendicular to the velocity, put in a1's half-turn  (:236-254)
 *   new_ang = a1 + (1 − |flatness|) · (a2 − a1)                              (:259)
 * Our "Fixation" is Inkscape's `flatness` (0 = nib always perpendicular to travel = constant width; 1 = the nib
 * keeps its angle). Inkscape never lets the width fall under 0.02 · width (:335); ours is the "Min width" setting.
 *
 * perfect-freehand 1.2.3 only offers one radius per point from pressure, so `nibOutline` below is its
 * getStrokeOutlinePoints with one change: each radius is multiplied by the nib factor. With a factor of 1 it
 * returns exactly what the library returns (tests compare them point by point).
 */
import { getStrokePoints, type StrokeOptions } from 'perfect-freehand';

type V = [number, number];
type SP = ReturnType<typeof getStrokePoints>[number];

export const NIB_DEFAULT_ANGLE = 30; // Inkscape's default nib angle (preferences-skeleton)
export const NIB_DEFAULT_MIN = 0.1;

/** Optional per-stroke nib parameters (all absent = plain Lineart). */
export interface Nib { nibAngle?: number; nibFixation?: number; nibMin?: number }

export const nibActive = (n: Nib) => (n.nibFixation ?? 0) > 0;

const wrapHalf = (a: number) => {
  a = a % Math.PI; // std::fmod (:219-232)
  return a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a;
};

/** Width factor (min…1) for a segment travelling along (vx, vy), page coordinates (y down), nib angle in degrees counter-clockwise on screen. */
export function nibFactor(angleDeg: number, fixation: number, minWidth: number, vx: number, vy: number): number {
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-9) return 1;
  const a1 = wrapHalf((-angleDeg * Math.PI) / 180); // :220, :226-232
  let a2 = Math.atan2(vx / mag, -vy / mag); // atan2 of rot90(vel)/|vel|  (:236-241, :245)
  let flipped = false;
  if (Math.abs(a2 - a1) > Math.PI / 2) { a2 += Math.PI; flipped = true; } // :247-250
  if (a2 > Math.PI) a2 -= 2 * Math.PI; else if (a2 < -Math.PI) a2 += 2 * Math.PI; // :252-256
  const f = Math.min(1, Math.max(0, Math.abs(fixation)));
  const ang = a1 + (1 - f) * (a2 - a1) - (flipped ? Math.PI : 0); // :259
  const across = Math.abs(Math.cos(ang) * (vy / mag) - Math.sin(ang) * (vx / mag)); // |ang × v̂|
  return Math.max(Math.min(1, Math.max(0, minWidth)), across);
}

// ---- perfect-freehand 1.2.3 getStrokeOutlinePoints, with a per-point radius factor ----
const PI = Math.PI + 0.0001;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const rot90 = (a: V): V => [a[1], -a[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const dist2 = (a: V, b: V) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const unit = (a: V): V => mul(a, 1 / Math.hypot(a[0], a[1]));
const lerp = (a: V, b: V, t: number): V => add(a, mul(sub(b, a), t));
const rotAround = (a: V, c: V, r: number): V => {
  const s = Math.sin(r), co = Math.cos(r), px = a[0] - c[0], py = a[1] - c[1];
  return [px * co - py * s + c[0], px * s + py * co + c[1]];
};
const taperLength = (t: number | boolean | undefined, size: number, len: number) => (t === false || t === undefined ? 0 : t === true ? Math.max(size, len) : t);
const rampUp = (pressure: number, distance: number, size: number) => {
  const r = Math.min(1, distance / size);
  return Math.min(1, pressure + (Math.min(1, 1 - r) - pressure) * (r * 0.275));
};
const initialPressure = (pts: SP[], simulate: boolean, size: number) =>
  pts.slice(0, 10).reduce((acc, p) => { let q = p.pressure; if (simulate) q = rampUp(acc, p.distance, size); return (acc + q) / 2; }, pts[0].pressure);

export function nibOutline(pts: SP[], o: StrokeOptions, factor: (p: SP) => number): number[][] {
  const { size = 16, smoothing = 0.5, thinning = 0.5, simulatePressure = true, easing = (t: number) => t, start = {}, end = {} } = o;
  const { cap: capStart = true, easing: easeStart = (t: number) => t * (2 - t) } = start;
  const { cap: capEnd = true, easing: easeEnd = (t: number) => --t * t * t + 1 } = end;
  if (pts.length === 0 || size <= 0) return [];
  const total = pts[pts.length - 1].runningLength;
  const taperS = taperLength(start.taper, size, total), taperE = taperLength(end.taper, size, total);
  const minDistance = (size * smoothing) ** 2;
  const left: V[] = [], right: V[] = [];
  const rad = (p: number) => size * easing(0.5 - thinning * (0.5 - p));
  let prevPressure = initialPressure(pts, simulatePressure, size);
  let radius = rad(pts[pts.length - 1].pressure) * factor(pts[pts.length - 1]);
  let firstRadius: number | undefined;
  let prevVector = pts[0].vector as V;
  let pl = pts[0].point as V, pr = pl, tl = pl, tr = pl;
  let sharp = false;
  for (let n = 0; n < pts.length; n++) {
    let pressure = pts[n].pressure;
    const point = pts[n].point as V, vector = pts[n].vector as V, distance = pts[n].distance, runningLength = pts[n].runningLength;
    const isLast = n === pts.length - 1;
    if (!isLast && total - runningLength < 3) continue;
    if (thinning) {
      if (simulatePressure) pressure = rampUp(prevPressure, distance, size);
      radius = rad(pressure);
    } else radius = size / 2;
    radius *= factor(pts[n]);
    if (firstRadius === undefined) firstRadius = radius;
    const ts = runningLength < taperS ? easeStart(runningLength / taperS) : 1;
    const te = total - runningLength < taperE ? easeEnd((total - runningLength) / taperE) : 1;
    radius = Math.max(0.01, radius * Math.min(ts, te));
    const nextVector = (isLast ? pts[n] : pts[n + 1]).vector as V;
    const nextDpr = isLast ? 1 : dot(vector, nextVector);
    const prevDpr = dot(vector, prevVector);
    const isSharp = prevDpr < 0 && !sharp, isSharpNext = nextDpr < 0;
    if (isSharp || isSharpNext) {
      const off = mul(rot90(prevVector), radius);
      for (let t = 0; t <= 1; t += 0.07692307692307693) {
        tl = rotAround(sub(point, off), point, PI * t); left.push(tl);
        tr = rotAround(add(point, off), point, PI * -t); right.push(tr);
      }
      pl = tl; pr = tr;
      if (isSharpNext) sharp = true;
      continue;
    }
    sharp = false;
    if (isLast) {
      const off = mul(rot90(vector), radius);
      left.push(sub(point, off)); right.push(add(point, off));
      continue;
    }
    const off = mul(rot90(lerp(nextVector, vector, nextDpr)), radius);
    tl = sub(point, off);
    if (n <= 1 || dist2(pl, tl) > minDistance) { left.push(tl); pl = tl; }
    tr = add(point, off);
    if (n <= 1 || dist2(pr, tr) > minDistance) { right.push(tr); pr = tr; }
    prevPressure = pressure; prevVector = vector;
  }
  const X = [pts[0].point[0], pts[0].point[1]] as V;
  const Z: V = pts.length > 1 ? [pts[pts.length - 1].point[0], pts[pts.length - 1].point[1]] : add(pts[0].point as V, [1, 1]);
  const startCap: V[] = [], endCap: V[] = [];
  if (pts.length === 1) {
    if (!(taperS || taperE)) {
      const r = firstRadius || radius;
      const c0 = add(X, mul(unit(rot90(sub(X, add(X, [1, 1])))), -r)), dots: V[] = [];
      for (let t = 1 / 13; t <= 1; t += 1 / 13) dots.push(rotAround(c0, X, PI * 2 * t));
      return dots;
    }
  } else {
    if (!(taperS || (taperE && pts.length === 1))) {
      if (capStart) for (let t = 1 / 13; t <= 1; t += 1 / 13) startCap.push(rotAround(right[0], X, PI * t));
      else { const d = sub(left[0], right[0]), a = mul(d, 0.5), b = mul(d, 0.51); startCap.push(sub(X, a), sub(X, b), add(X, b), add(X, a)); }
    }
    const t = rot90(mul(pts[pts.length - 1].vector as V, -1));
    if (taperE || (taperS && pts.length === 1)) endCap.push(Z);
    else if (capEnd) { const s0 = add(Z, mul(t, radius)); for (let k = 1 / 29; k < 1; k += 1 / 29) endCap.push(rotAround(s0, Z, PI * 3 * k)); }
    else endCap.push(add(Z, mul(t, radius)), add(Z, mul(t, radius * 0.99)), sub(Z, mul(t, radius * 0.99)), sub(Z, mul(t, radius)));
  }
  return left.concat(endCap, right.reverse(), startCap);
}

/** Outline of a stroke with a nib: same options as the plain one, radius scaled by the nib factor at each sample. */
export function nibStrokeOutline(points: Array<[number, number, number]>, o: StrokeOptions, nib: Nib): number[][] {
  const angle = nib.nibAngle ?? NIB_DEFAULT_ANGLE, fix = nib.nibFixation ?? 0, min = nib.nibMin ?? NIB_DEFAULT_MIN;
  const sp = getStrokePoints(points, o);
  return nibOutline(sp, o, (p) => nibFactor(angle, fix, min, p.vector[0], p.vector[1]));
}
