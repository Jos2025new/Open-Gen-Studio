import type { AlphaImage, BrushTip } from './brushEngine';

/*
 * Graphite as measured on a real 12-grade swatch sheet (docs/decisions/0028-lapiz-grafito.md). A grade is a darkest tone, not
 * an opacity: each pixel's colour is that ceiling (lighter in the paper's valleys) and its alpha is how far this pass goes
 * towards it. Composited with `darken`, that is T -= (T - ceiling) * alpha where T > ceiling, without reading the layer:
 * passes build up to the grade's darkest and stop, a hard lead never lightens a soft one, and masks stay independent of what is underneath.
 */

export type LeadGrade = '2H' | 'HB' | '2B' | '4B' | '6B';

/** Fitted to the sheet: L = darkest L*; dc = how much lighter the valleys stay; k = deposit per fine stroke; v = share that ignores the paper; c, soft, gp, gam = pressure against paper height; jit = per-stroke variation of the contact; edge = where the profile starts falling; w = fine stroke half-width (px); gv = variation between fine strokes; dens = their spacing (px); top = pressure scale. */
interface LeadFit { L: number; dc: number; k: number; v: number; c: number; soft: number; gp: number; gam: number; jit: number; edge: number; w: number; gv: number; dens: number; top: number }
export const LEAD_FITS: Record<LeadGrade, LeadFit> = {
  '2H': { L: 64.3, dc: 0.394, k: 0.18, v: 0.492, c: 1.58, soft: 0.365, gp: 1.377, gam: 1.041, jit: 0.06, edge: 0.189, w: 1.753, gv: 0.242, dens: 1.432, top: 1.187 },
  HB: { L: 47.4, dc: 0.36, k: 0.127, v: 0.178, c: 1.115, soft: 0.16, gp: 1.48, gam: 0.494, jit: 0.04, edge: 0.334, w: 1.533, gv: 0.337, dens: 0.98, top: 1.135 },
  '2B': { L: 29.6, dc: 0.166, k: 0.275, v: 0.384, c: 1.681, soft: 0.157, gp: 0.91, gam: 1.008, jit: 0.081, edge: 0.383, w: 2.4, gv: 0.226, dens: 0.923, top: 0.529 },
  '4B': { L: 17.4, dc: 0.223, k: 0.198, v: 0.353, c: 0.594, soft: 0.206, gp: 2.468, gam: 1.205, jit: 0.069, edge: 0.8, w: 2.4, gv: 0.385, dens: 1.22, top: 1.441 },
  '6B': { L: 20.6, dc: 0.239, k: 0.206, v: 0.269, c: 1.044, soft: 0.316, gp: 1.359, gam: 0.666, jit: 0.017, edge: 0.408, w: 1.37, gv: 0.307, dens: 0.9, top: 1.314 },
};

const SIZE = 256, MASK = SIZE - 1;

function mix(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Maps values to an even 0–1 spread by rank. */
function ranked(raw: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const BINS = 4096, count = new Uint32Array(BINS), scale = (BINS - 1) / Math.max(1e-6, hi - lo);
  for (const v of raw) count[((v - lo) * scale) | 0]++;
  const rank = new Float32Array(BINS);
  for (let i = 0, sum = 0; i < BINS; i++) { rank[i] = (sum + count[i] / 2) / raw.length; sum += count[i]; }
  return raw.map((v) => rank[((v - lo) * scale) | 0]);
}

/** Tileable value noise: the sum of `octaves` [cells across the tile, weight], ranked to an even 0–1 spread. */
function tile(octaves: Array<[number, number]>, salt: number): Float32Array {
  const raw = new Float32Array(SIZE * SIZE);
  octaves.forEach(([n, weight], o) => {
    for (let y = 0; y < SIZE; y++) {
      const gy = (y * n) / SIZE, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < SIZE; x++) {
        const gx = (x * n) / SIZE, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
        const at = (i: number, j: number) => mix((i % n) + salt * 1009 + o * 7919, (j % n) + o * 104729);
        const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        raw[y * SIZE + x] += weight * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  });
  return ranked(raw);
}

/** In-place radix-2 FFT of `re`/`im`, `n` samples starting at `start`, `step` apart. */
function fft(re: Float32Array, im: Float32Array, start: number, step: number, n: number, invert: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = start + i * step, b = start + j * step, r = re[a], m = im[a];
      re[a] = re[b]; im[a] = im[b]; re[b] = r; im[b] = m;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + (i + k) * step, b = a + (len / 2) * step, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Tileable noise with a given amplitude per spatial frequency (white noise filtered in frequency), ranked to an even 0–1 spread. */
function spectralTile(amplitude: (fx: number, fy: number) => number, salt: number): Float32Array {
  const re = new Float32Array(SIZE * SIZE), im = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < re.length; i++) re[i] = mix(i, salt) + mix(i, salt + 31) + mix(i, salt + 57) - 1.5;
  const pass = (invert: boolean) => {
    for (let y = 0; y < SIZE; y++) fft(re, im, y * SIZE, 1, SIZE, invert);
    for (let x = 0; x < SIZE; x++) fft(re, im, x, SIZE, SIZE, invert);
  };
  pass(false);
  const freq = (i: number) => (i < SIZE / 2 ? i : i - SIZE) / SIZE;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const g = amplitude(freq(x), freq(y)), i = y * SIZE + x; re[i] *= g; im[i] *= g; }
  pass(true);
  return ranked(re);
}

/** Amplitude spectrum of the paper in the sheet's 2B swatch, at PAPER_Q cycles per pixel. */
const PAPER_Q = [0.01, 0.02, 0.03, 0.045, 0.06, 0.075, 0.09, 0.11, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const PAPER_AMP = [0.382, 0.478, 0.57, 0.723, 0.876, 0.99, 0.999, 0.906, 0.781, 0.702, 0.667, 0.606, 0.547, 0.513, 0.413, 0.332, 0.28];
function paperAmplitude(fx: number, fy: number): number {
  const q = Math.hypot(fx, fy);
  if (q <= PAPER_Q[0]) return PAPER_AMP[0];
  for (let i = 1; i < PAPER_Q.length; i++) if (q <= PAPER_Q[i]) return PAPER_AMP[i - 1] + ((PAPER_AMP[i] - PAPER_AMP[i - 1]) * (q - PAPER_Q[i - 1])) / (PAPER_Q[i] - PAPER_Q[i - 1]);
  return 0;
}

interface Paper { height: Float32Array; valley: Float32Array; fine: Float32Array; drift: Float32Array; hair: Float32Array }
let paper: Paper | undefined;
/** Made once, while the app is idle (or on the first graphite stroke, if that comes first): it takes longer than a frame. */
function paperTiles(): Paper {
  if (paper) return paper;
  const height = spectralTile(paperAmplitude, 1), fine = spectralTile((fx, fy) => (fx || fy ? Math.hypot(fx, fy * 1.15) ** -1.25 : 0), 2), drift = tile([[8, 0.6], [36, 0.4]], 3);
  const hair = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) hair[i] = (mix(i, 4242) + mix(i, 77) + mix(i, 991) - 1.5) * 2; // Sum of three: close to a normal with sd 1.
  paper = { height, valley: height.map((h) => (1 - h) ** 1.4), fine, drift, hair };
  return paper;
}

(globalThis as { requestIdleCallback?: (run: () => void) => unknown }).requestIdleCallback?.(() => paperTiles());

const lstarToGrey = (L: number) => {
  const y = L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3;
  return y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
};

interface LeadTables { deposit: number; grey: number; thresh: Float32Array; gate: Float32Array; pen: Float32Array }
const tables = new Map<LeadGrade, LeadTables>();
const AL_STEPS = 512, AL_MAX = 2;
function tablesFor(grade: LeadGrade): LeadTables {
  const found = tables.get(grade);
  if (found) return found;
  const f = LEAD_FITS[grade], thresh = new Float32Array(AL_STEPS + 1), gate = new Float32Array(AL_STEPS + 1), pen = new Float32Array(257);
  for (let i = 0; i <= AL_STEPS; i++) {
    const al = (i / AL_STEPS) * AL_MAX;
    thresh[i] = 1 - Math.min(1.2, f.c * al ** 0.7);
    gate[i] = 0.2 + 0.8 * al ** f.gam;
  }
  for (let i = 0; i <= 256; i++) pen[i] = f.v + (1 - f.v) * (i / 256) ** f.gp;
  // The fit laid about 2w/dens fine strokes per layer on each pixel; a person hatches about 1.25, so one pass carries the difference.
  const made = { deposit: 1 - (1 - f.k) ** ((2 * f.w) / (f.dens * 1.25)), grey: lstarToGrey(f.L), thresh, gate, pen };
  tables.set(grade, made);
  return made;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a))); return t * t * (3 - 2 * t); };

/** Lays one segment of a graphite stroke into the mask, keeping each pixel's strongest pass (see stampSegment). */
export function stampLeadSegment(img: AlphaImage, ox: number, oy: number, seg: readonly number[], density: number, tip: BrushTip, rgb: [number, number, number], from?: { width: number; density: number }): void {
  const lead = tip.lead!, f = LEAD_FITS[lead.grade], T = tablesFor(lead.grade), P = paperTiles();
  const [ax, ay, bx, by, width] = seg;
  const w0 = from?.width ?? width, d0 = Math.min(1, Math.max(0, from?.density ?? density)), d1 = Math.min(1, Math.max(0, density));
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2), rMax = Math.max(0.5, Math.max(w0, width) / 2), reach = rMax + 0.15 * Math.min(rMax, f.w);
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach - 1 - ox)), y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach - 1 - oy));
  const x1 = Math.min(img.width, Math.ceil(Math.max(ax, bx) + reach + 1 - ox)), y1 = Math.min(img.height, Math.ceil(Math.max(ay, by) + reach + 1 - oy));
  const seed = lead.seed | 0, sx = seed & MASK, sy = (seed >>> 8) & MASK, hairCell = Math.max(1, f.dens * 1.5), hairShift = (seed >>> 16) & MASK;
  const data = img.data, gMul = (1 - T.grey), R = 255 - rgb[0], G = 255 - rgb[1], B = 255 - rgb[2], softDiv = 256 / (2 * f.soft), alScale = AL_STEPS / AL_MAX;
  for (let y = y0; y < y1; y++) {
    const ly = y + oy, py = ly + 0.5 - ay, row = (ly & MASK) * SIZE, row2 = ((ly + sy) & MASK) * SIZE;
    for (let x = x0; x < x1; x++) {
      const lx = x + ox, px = lx + 0.5 - ax;
      const t = len2 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0, qx = px - t * dx, qy = py - t * dy, d2 = qx * qx + qy * qy;
      const rt = Math.max(0.5, (w0 + (width - w0) * t) / 2), hw = Math.min(rt, f.w), outer = rt + 0.15 * hw;
      if (d2 >= outer * outer) continue;
      const d = Math.sqrt(d2), inner = outer - (1.15 - f.edge) * hw, edge = 1 - smooth(inner, outer, d);
      // Fine strokes run along the stroke: a wide tip is a bundle of them, each with its own gain.
      const across = (len ? (dx * py - dy * px) / len : 0) / hairCell + 128 + hairShift, h0 = Math.floor(across), hf = across - h0;
      const hair = P.hair[h0 & MASK] + (P.hair[(h0 + 1) & MASK] - P.hair[h0 & MASK]) * hf;
      const i0 = row | (lx & MASK), i2 = row2 | ((lx + sx) & MASK);
      const al = (d0 + (d1 - d0) * t) * f.top * Math.exp(f.gv * hair) * (0.7 + 0.6 * P.drift[i2]);
      const ai = Math.min(AL_STEPS, (al * alScale) | 0);
      const level = 0.8 * P.height[i0] + 0.2 * P.fine[i0] + f.jit * (2 * P.fine[i2] - 1);
      const pi = (level - T.thresh[ai] + f.soft) * softDiv;
      const m = edge * T.deposit * T.gate[ai] * T.pen[pi <= 0 ? 0 : pi >= 256 ? 256 : pi | 0];
      const a = Math.round(Math.min(1, m) * 255), i = (y * img.width + x) * 4;
      if (a > data[i + 3]) {
        const depth = gMul * (1 - f.dc * P.valley[i0]);
        data[i] = 255 - R * depth; data[i + 1] = 255 - G * depth; data[i + 2] = 255 - B * depth; data[i + 3] = a;
      }
    }
  }
}
