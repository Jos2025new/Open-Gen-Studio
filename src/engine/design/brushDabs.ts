import { applyTooth, applyToothV3, hexRgb, profile, segmentBox, smoothNoise, stampSegment, textureAt, type AlphaImage, type BrushTip } from './brushEngine';
import { tipFrame } from './brushTipShape';

/*
 * Dab mode, after MyPaint (libmypaint): a stroke is a row of small stamps laid every `spacing` of the radius, each
 * with its own scatter, size and angle, and they BUILD UP (src-over into a Float32 plane, so a 4H stroke of dabs
 * under 1/255 each is not lost) instead of keeping the strongest coverage.
 *
 * Live, replay and the end-taper repaint fold the same segments through the same walker: the noise is a counter
 * hash of (seed, dab index, channel), never of a position or Math.random, and every position is computed in LAYER
 * pixels (the live buffer's origin only picks which array cell is written), so all three give identical masks.
 * Strokes without tip.dabs never come here.
 */

interface Plane { x: number; y: number; w: number; h: number; data: Float32Array }
interface Lane { next: number; w: number; d: number }
interface Rect { x0: number; y0: number; x1: number; y1: number }
/** What a stroke being walked carries between segments: the coverage plane, the distance to the next dab, the dab count. */
export interface DabState { plane?: Plane; lanes: Lane[]; index: number; count: number }
export const newDabState = (): DabState => ({ lanes: [], index: 0, count: 0 });

const NONE: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A repeatable uniform in [0, 1) for (seed, dab, channel). */
function rnd(seed: number, i: number, ch: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(ch + 1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** About a normal variate (sum of three uniforms), bounded to ±3 so the padding of the dirty boxes is exact. */
const gauss = (seed: number, i: number, ch: number) => (rnd(seed, i, ch) + rnd(seed, i, ch + 1) + rnd(seed, i, ch + 2) - 1.5) * 2;

/** Make the plane cover `r` (kept cells are copied); `slack` extra pixels all round so a growing stroke does not copy at every move. */
function ensure(st: DabState, r: Rect, slack: number): Plane {
  const p = st.plane;
  if (p && r.x0 >= p.x && r.y0 >= p.y && r.x1 <= p.x + p.w && r.y1 <= p.y + p.h) return p;
  const x = Math.min(r.x0, p?.x ?? r.x0) - slack, y = Math.min(r.y0, p?.y ?? r.y0) - slack;
  const w = Math.max(r.x1, p ? p.x + p.w : r.x1) + slack - x, h = Math.max(r.y1, p ? p.y + p.h : r.y1) + slack - y;
  const next: Plane = { x, y, w, h, data: new Float32Array(w * h) };
  if (p) for (let row = 0; row < p.h; row++) next.data.set(p.data.subarray(row * p.w, (row + 1) * p.w), (p.y - y + row) * w + (p.x - x));
  return (st.plane = next);
}

/** One dab: radius R at (cx, cy), `w` its alpha at the core; adds into the plane inside `clip`. */
function dab(p: Plane, tip: BrushTip, cx: number, cy: number, R: number, aj: number, dx: number, dy: number, w: number, clip: Rect): void {
  const fr = tip.roundness !== undefined && tip.roundness < 1 ? tipFrame({ ...tip, angle: (tip.angle ?? 0) + aj }, dx, dy) : null;
  const c = fr?.c ?? 1, s = fr?.s ?? 0, a = fr?.aspect ?? 1, edge = tip.edge ?? 0, reach = R * (1 + edge / 2);
  const hx = reach * Math.sqrt(c * c + (s * s) / (a * a)) + 1.5, hy = reach * Math.sqrt(s * s + (c * c) / (a * a)) + 1.5;
  const x0 = Math.max(clip.x0, p.x, Math.floor(cx - hx)), x1 = Math.min(clip.x1, p.x + p.w, Math.ceil(cx + hx));
  const y0 = Math.max(clip.y0, p.y, Math.floor(cy - hy)), y1 = Math.min(clip.y1, p.y + p.h, Math.ceil(cy + hy));
  const tex = tip.texture, strength = clamp01(tip.textureStrength ?? 0), tooth = tip.tooth === true, data = p.data;
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5 - cx;
      const d = fr ? Math.sqrt((c * px - s * py) ** 2 + ((s * px + c * py) * a) ** 2) : Math.sqrt(px * px + py * py);
      let rt = R;
      if (edge) rt = Math.max(0.5, rt * (1 + edge * (smoothNoise(x, y, 3) - 0.5)));
      if (d > rt + 0.5) continue;
      let k = profile(d, rt, tip.hardness) * w;
      if (tex && strength) {
        // Tooth v2 waits for flush (one subtraction on the built-up coverage). The first tooth scaled each faint dab so a subtraction would not erase it.
        const t = textureAt(tex, x, y);
        if (!tooth) k *= 1 - strength * (1 - t);
        else if (!tip.toothVersion) k *= Math.max(0, 1 - 1.5 * strength * (1 - t));
      }
      const i = (y - p.y) * p.w + (x - p.x), before = data[i];
      data[i] = before + (1 - before) * k;
    }
  }
}

/** Walk one segment: carry the distance, place a dab every spacing × radius, with width and density blended from the previous segment. */
function walk(st: DabState, tip: BrushTip, seg: readonly number[], density: number, clip: Rect): void {
  const D = tip.dabs!, [ax, ay, bx, by, width] = seg, laneAt = tip.mirror ? st.count & 1 : 0;
  st.count++;
  const lane = st.lanes[laneAt], w0 = lane?.w ?? width, d0 = clamp01(lane?.d ?? density), d1 = clamp01(density);
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), hasClip = clip.x1 > clip.x0 && clip.y1 > clip.y0;
  let pos = lane?.next ?? 0;
  while (pos <= len) {
    const t = len ? pos / len : 0, R = Math.max(0.5, (w0 + (width - w0) * t) / 2), i = st.index++;
    if (hasClip) {
      const R2 = R * Math.min(4, Math.max(0.25, Math.exp(D.sizeJitter * gauss(D.seed, i, 6))));
      const aj = (rnd(D.seed, i, 9) * 2 - 1) * 180 * D.angleJitter;
      const cx = ax + dx * t + gauss(D.seed, i, 0) * D.scatter * R, cy = ay + dy * t + gauss(D.seed, i, 3) * D.scatter * R;
      // A dab that grew keeps its total paint: a bigger one is fainter, as MyPaint's radius_by_random does.
      const area = (R / R2) ** 2;
      if (st.plane) dab(st.plane, tip, cx, cy, R2, aj, dx, dy, D.flow * (d0 + (d1 - d0) * t) * (area < 1 ? area : 1), clip);
    }
    pos += Math.max(0.25, D.spacing * R);
  }
  st.lanes[laneAt] = { next: pos - len, w: width, d: d1 };
}

/** Write the plane's coverage inside `r` into an RGBA mask whose top-left is (ix, iy) in layer pixels. */
function flush(p: Plane | undefined, img: AlphaImage, ix: number, iy: number, rgb: [number, number, number], r: Rect, tip: BrushTip): void {
  if (!p) return;
  const strength = clamp01(tip.textureStrength ?? 0), v2 = tip.tooth === true && (tip.toothVersion ?? 0) >= 2 && !!tip.texture && strength > 0;
  const x0 = Math.max(r.x0, p.x, ix), x1 = Math.min(r.x1, p.x + p.w, ix + img.width), y0 = Math.max(r.y0, p.y, iy), y1 = Math.min(r.y1, p.y + p.h, iy + img.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let cov = Math.min(1, p.data[(y - p.y) * p.w + (x - p.x)]);
      if (v2 && cov > 0) {
        const tex = textureAt(tip.texture, x, y);
        // v3: the accumulated coverage already carries each dab's density (flow × pressure), so it is the local density of the valley floor.
        cov = tip.toothVersion === 3 ? applyToothV3(cov, tex, strength, tip.valleyFill ?? 0, cov) : applyTooth(cov, tex, strength);
      }
      const a = Math.round(cov * 255);
      if (!a) continue;
      const i = ((y - iy) * img.width + (x - ix)) * 4;
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = a;
    }
  }
}

/** A saved stroke's mask (replay and the settings preview): the same walk as live, over the whole stroke at once. */
export function stampDabStroke(img: AlphaImage, ox: number, oy: number, segments: readonly (readonly number[])[], densities: readonly number[] | undefined, tip: BrushTip, rgb: [number, number, number]): void {
  const st = newDabState(), r = { x0: ox, y0: oy, x1: ox + img.width, y1: oy + img.height };
  ensure(st, r, 0);
  segments.forEach((seg, i) => walk(st, tip, seg, densities?.[i] ?? 1, r));
  flush(st.plane, img, ox, oy, rgb, r, tip);
}

/**
 * The live hook: lay one segment (layer pixels) into `img`, whose top-left is (ox, oy) in the live buffer, g its
 * origin in the layer. Without dabs this is stampSegment as before.
 */
export function stampTip(live: { tip?: BrushTip; color: string; last?: { width: number; density: number }; dabs?: DabState }, img: AlphaImage, ox: number, oy: number, g: { x0: number; y0: number }, seg: readonly number[], density: number): void {
  const tip = live.tip!, rgb = hexRgb(live.color);
  if (!tip.dabs) return stampSegment(img, ox, oy, [seg[0] - g.x0, seg[1] - g.y0, seg[2] - g.x0, seg[3] - g.y0, seg[4]], density, tip, rgb, live.last);
  const st = (live.dabs ??= newDabState()), ix = g.x0 + ox, iy = g.y0 + oy;
  // The box this segment can touch (its dabs start at the previous width), inside the image.
  const b = segmentBox([seg[0], seg[1], seg[2], seg[3], Math.max(seg[4], st.lanes[tip.mirror ? st.count & 1 : 0]?.w ?? 0)], tip);
  const r = { x0: Math.max(b.x, ix), y0: Math.max(b.y, iy), x1: Math.min(b.x + b.w, ix + img.width), y1: Math.min(b.y + b.h, iy + img.height) };
  if (r.x1 > r.x0 && r.y1 > r.y0) ensure(st, r, 48);
  walk(st, tip, seg, density, r.x1 > r.x0 && r.y1 > r.y0 ? r : NONE);
  flush(st.plane, img, ix, iy, rgb, r, tip);
}

/** A segment the live stroke did not paint (off the page): the walker still crosses it, so later dabs stay where replay puts them. */
export function skipDabs(live: { tip?: BrushTip; dabs?: DabState }, seg: readonly number[], density: number): void {
  if (live.tip?.dabs) walk((live.dabs ??= newDabState()), live.tip, seg, density, NONE);
}

/** The end taper: fold all the segments again from the first, painting only inside the image (top-left (ox, oy) in the buffer, g its layer origin). */
export function repaintDabs(live: { tip?: BrushTip; color: string; dabs?: DabState }, img: AlphaImage, ox: number, oy: number, g: { x0: number; y0: number }, segments: readonly (readonly number[])[], densities: readonly number[] | undefined): void {
  const tip = live.tip!, ix = g.x0 + ox, iy = g.y0 + oy, r = { x0: ix, y0: iy, x1: ix + img.width, y1: iy + img.height };
  const st = (live.dabs ??= newDabState()), p = ensure(st, r, 0);
  // The region starts empty and the walker at the stroke's start; the dabs of the whole stroke refill it.
  for (let y = r.y0; y < r.y1; y++) p.data.fill(0, (y - p.y) * p.w + (r.x0 - p.x), (y - p.y) * p.w + (r.x1 - p.x));
  st.lanes = []; st.index = 0; st.count = 0;
  segments.forEach((seg, i) => walk(st, tip, seg, densities?.[i] ?? 1, r));
  flush(p, img, ix, iy, hexRgb(live.color), r, tip);
}
