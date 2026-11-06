/* The Fill's region variants: close gaps in the outline, and every similar pixel. Pure pixel work on RGBA arrays, no canvas. */

/** True where pixel i is within `threshold` of the seed pixel (per channel, premultiplied, alpha too). The test Fill and the wand share. */
export function colorMatcher(pixels: Uint8ClampedArray, seedIndex: number, threshold: number): (i: number) => boolean {
  const seed = seedIndex * 4, alpha = pixels[seed + 3];
  const sr = pixels[seed] * alpha / 255, sg = pixels[seed + 1] * alpha / 255, sb = pixels[seed + 2] * alpha / 255;
  return (i) => {
    const p = i * 4, a = pixels[p + 3];
    return Math.abs(a - alpha) <= threshold && Math.abs(pixels[p] * a / 255 - sr) <= threshold && Math.abs(pixels[p + 1] * a / 255 - sg) <= threshold && Math.abs(pixels[p + 2] * a / 255 - sb) <= threshold;
  };
}

/** Every pixel of the page that matches the seed, connected or not. 1 = in. One linear scan, no queue. */
export function similarMask(pixels: Uint8ClampedArray, w: number, h: number, x: number, y: number, threshold: number, expand: number): Uint8Array {
  const matches = colorMatcher(pixels, y * w + x, threshold);
  const region = new Uint8Array(w * h);
  for (let i = 0; i < region.length; i++) if (matches(i)) region[i] = 1;
  if (expand <= 0) return region;
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let i = 0; i < region.length; i++) if (region[i]) queue[tail++] = i;
  growFrom(region, queue, tail, w, h, expand, null, false);
  return region;
}

/**
 * Grow `region` in whole-pixel waves from the pixels already queued (queue[0..tail) are the region's pixels, any order).
 * `allowed` limits growth to those pixels (null = anywhere); `eight` also takes the diagonals (a square, as the barrier is
 * widened). Every pixel is queued at most once, so the cost does not depend on the number of waves.
 */
function growFrom(region: Uint8Array, queue: Int32Array, tail: number, w: number, h: number, steps: number, allowed: Uint8Array | null, eight: boolean): void {
  let head = 0;
  const last = w * (h - 1);
  const add = (i: number) => {
    if (region[i] || (allowed && !allowed[i])) return;
    region[i] = 1;
    queue[tail++] = i;
  };
  for (let step = 0; step < steps; step++) {
    const end = tail;
    while (head < end) {
      const i = queue[head++], col = i % w, up = i >= w, down = i < last;
      if (col > 0) { add(i - 1); if (eight) { if (up) add(i - w - 1); if (down) add(i + w - 1); } }
      if (col < w - 1) { add(i + 1); if (eight) { if (up) add(i - w + 1); if (down) add(i + w + 1); } }
      if (up) add(i - w);
      if (down) add(i + w);
    }
  }
}

/** 1 where a non-matching pixel lies within `r` (a square window) of the pixel: two sliding-window passes, O(w·h) whatever `r` is. */
function widenBarrier(matching: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const row = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let n = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) n += matching[base + x] ? 0 : 1;
    for (let x = 0; x < w; x++) {
      row[base + x] = n > 0 ? 1 : 0;
      if (x + r + 1 < w) n += matching[base + x + r + 1] ? 0 : 1;
      if (x - r >= 0) n -= matching[base + x - r] ? 0 : 1;
    }
  }
  const col = new Uint16Array(w);
  for (let y = 0; y <= Math.min(r, h - 1); y++) for (let x = 0; x < w; x++) col[x] += row[y * w + x];
  for (let y = 0; y < h; y++) {
    const base = y * w, add = (y + r + 1) * w, drop = (y - r) * w;
    for (let x = 0; x < w; x++) {
      out[base + x] = col[x] > 0 ? 1 : 0;
      if (y + r + 1 < h) col[x] += row[add + x];
      if (y - r >= 0) col[x] -= row[drop + x];
    }
  }
  return out;
}

/**
 * The region contiguous with (x, y) that does not leak through an opening of up to `gap` pixels in the outline.
 * The outline (what does not match the seed) is widened by ceil(gap / 2), the flood runs only on what is left, then the
 * region grows back that same distance onto matching pixels so it reaches the line again. A gap this narrow is sealed;
 * an opening just wider than the gap can let a strip of at most that width show on the far side.
 * Null when the seed itself is inside the widened outline (a click hugging the line): the caller falls back to the plain fill.
 */
export function gapMask(pixels: Uint8ClampedArray, w: number, h: number, x: number, y: number, threshold: number, gap: number, expand: number): Uint8Array | null {
  const n = w * h, seed = y * w + x, r = Math.ceil(gap / 2);
  const matches = colorMatcher(pixels, seed, threshold);
  const matching = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (matches(i)) matching[i] = 1;
  const wide = widenBarrier(matching, w, h, r);
  if (wide[seed]) return null;
  for (let i = 0; i < n; i++) wide[i] = matching[i] && !wide[i] ? 1 : 0; // now: where the flood may go
  const region = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 1;
  queue[0] = seed;
  region[seed] = 1;
  const last = w * (h - 1);
  while (head < tail) {
    const i = queue[head++], col = i % w;
    if (col > 0 && wide[i - 1] && !region[i - 1]) { region[i - 1] = 1; queue[tail++] = i - 1; }
    if (col < w - 1 && wide[i + 1] && !region[i + 1]) { region[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && wide[i - w] && !region[i - w]) { region[i - w] = 1; queue[tail++] = i - w; }
    if (i < last && wide[i + w] && !region[i + w]) { region[i + w] = 1; queue[tail++] = i + w; }
  }
  growFrom(region, queue, tail, w, h, r, matching, true);
  if (expand > 0) {
    // The queue already holds the whole region; the wave that follows reuses it from the start.
    let t = 0;
    for (let i = 0; i < n; i++) if (region[i]) queue[t++] = i;
    growFrom(region, queue, t, w, h, expand, null, false);
  }
  return region;
}
